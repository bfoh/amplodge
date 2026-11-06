import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js'
import {
  serviceClient, pairingCode, normalizePairingCode, sha256Hex, randomToken,
  signingKey, publicKeyBase64, logActivity, parseBody, UUID, ALLOWED_ORIGINS,
} from './_lib/key-cards.js'

const PAIRING_MINUTES = 10

/**
 * Pairs the reception PC's lock bridge with the server.
 *
 *   admin:  { action: 'start', label }    -> a one-time code, valid 10 minutes
 *           { action: 'list' }            -> the encoder PCs
 *           { action: 'revoke', encoderId }
 *   bridge: { action: 'redeem', code, bridgeVersion?, dllVersion? }
 *           -> its device token (shown once, stored here only as sha256) and
 *              the public key it will check every card order against.
 */
export const handler = async (event) => {
  const cors = handleCors(event); if (cors) return cors
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
  const body = parseBody(event)
  if (!body) return jsonResponse(400, { error: 'Invalid JSON body' })

  try {
    if (body.action === 'redeem') return await redeem(event, body)

    let ctx
    try { ctx = await requireAdmin(event) } catch (e) { return jsonResponse(e.status, e.body) }
    const sb = serviceClient()

    if (body.action === 'start') {
      if (!signingKey()) return jsonResponse(503, { error: 'Door locks are not set up on the server yet (LOCK_ORDER_PRIVATE_KEY is missing).' })
      const label = String(body.label || 'Reception PC').trim().slice(0, 60) || 'Reception PC'
      const code = pairingCode()
      const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60000).toISOString()
      const { data: row, error } = await sb.from('lock_encoders').insert({
        label,
        pairing_code_hash: sha256Hex(normalizePairingCode(code)),
        pairing_expires_at: expiresAt,
        created_by: ctx.staff?.id ?? null,
        created_at: new Date().toISOString(),
      }).select().single()
      if (error) throw error
      await logActivity(sb, { action: 'lock_encoder_pairing_started', entityId: row.id, userId: ctx.user?.id, details: { label } })
      return jsonResponse(200, { encoderId: row.id, label, code, expiresAt })
    }

    if (body.action === 'list') {
      const { data, error } = await sb.from('lock_encoders').select('*').order('created_at', { ascending: false })
      if (error) throw error
      const now = new Date()
      return jsonResponse(200, {
        encoders: (data || []).map((e) => ({
          id: e.id,
          label: e.label,
          state: e.revoked_at ? 'revoked' : e.token_hash ? 'paired' : new Date(e.pairing_expires_at) > now ? 'waiting' : 'expired',
          pairedAt: e.paired_at,
          lastSeenAt: e.last_seen_at,
          bridgeVersion: e.bridge_version,
          dllVersion: e.dll_version,
          revokedAt: e.revoked_at,
        })),
      })
    }

    if (body.action === 'revoke') {
      if (typeof body.encoderId !== 'string' || !UUID.test(body.encoderId)) return jsonResponse(400, { error: 'encoderId is required' })
      const { data, error } = await sb.from('lock_encoders')
        .update({ revoked_at: new Date().toISOString(), token_hash: null, pairing_code_hash: null })
        .eq('id', body.encoderId).select()
      if (error) throw error
      if (!data?.length) return jsonResponse(404, { error: 'Encoder not found' })
      await logActivity(sb, { action: 'lock_encoder_revoked', entityId: body.encoderId, userId: ctx.user?.id, details: { label: data[0].label } })
      return jsonResponse(200, { revoked: true })
    }

    return jsonResponse(400, { error: 'Unknown action' })
  } catch (e) {
    console.error('[lock-encoder-pair]', e)
    return jsonResponse(500, { error: 'Pairing failed' })
  }
}

async function redeem(event, body) {
  const { allowed } = await checkRateLimit(event, { endpoint: 'lock-encoder-redeem', limit: 5, windowSeconds: 300 })
  if (!allowed) return tooManyRequests()
  const key = signingKey()
  if (!key) return jsonResponse(503, { error: 'Door locks are not set up on the server yet.' })
  const code = normalizePairingCode(body.code)
  if (code.length !== 20) return jsonResponse(400, { error: 'The pairing code is 20 letters and digits.' })

  const sb = serviceClient()
  const { data: row } = await sb.from('lock_encoders').select('*').eq('pairing_code_hash', sha256Hex(code)).maybeSingle()
  const now = new Date()
  if (!row || row.revoked_at || row.token_hash || !row.pairing_expires_at || new Date(row.pairing_expires_at) <= now) {
    return jsonResponse(404, { error: 'That code is not valid or has expired. Start pairing again in Settings.' })
  }

  const token = randomToken(32)
  // Conditional on the code still being there, so two redeems of one code cannot both win.
  const { data: won, error } = await sb.from('lock_encoders').update({
    token_hash: sha256Hex(token),
    pairing_code_hash: null,
    pairing_expires_at: null,
    paired_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    bridge_version: body.bridgeVersion ? String(body.bridgeVersion).slice(0, 40) : null,
    dll_version: body.dllVersion ? String(body.dllVersion).slice(0, 80) : null,
  }).eq('id', row.id).eq('pairing_code_hash', sha256Hex(code)).select()
  if (error) throw error
  if (!won?.length) return jsonResponse(404, { error: 'That code is not valid or has expired. Start pairing again in Settings.' })
  await logActivity(sb, { action: 'lock_encoder_paired', entityId: row.id, details: { label: row.label, bridgeVersion: body.bridgeVersion ?? null } })
  return jsonResponse(200, {
    encoderId: row.id,
    label: row.label,
    deviceToken: token,
    publicKey: publicKeyBase64(key),
    allowedOrigins: ALLOWED_ORIGINS,
  })
}
