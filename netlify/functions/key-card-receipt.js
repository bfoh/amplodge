import { jsonResponse, handleCors } from './_lib/auth.js'
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js'
import { serviceClient, deviceToken, sha256Hex, logActivity, parseBody } from './_lib/key-cards.js'

/**
 * The lock bridge reports what happened to each card of an order.
 * Called by the bridge itself, with `Authorization: Device <token>`; no staff login.
 *
 * POST { nonce, cards: [{ cardNo, status: 'issued' | 'failed' | 'unknown', error? }], bridgeVersion?, dllVersion? }
 *
 * Idempotent: the bridge resends until it gets a 200 (it keeps a journal, so a
 * crash or a dropped connection does not lose a result). A card only moves on
 * from 'pending' or 'unknown', so a late or replayed report cannot undo a
 * confirmed one.
 */
const RESULTS = ['issued', 'failed', 'unknown']

export const handler = async (event) => {
  const cors = handleCors(event); if (cors) return cors
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const { allowed } = await checkRateLimit(event, { endpoint: 'key-card-receipt', limit: 120 })
  if (!allowed) return tooManyRequests()

  const token = deviceToken(event)
  if (!token) return jsonResponse(401, { error: 'Device token required' })

  const body = parseBody(event)
  if (!body || typeof body.nonce !== 'string' || !Array.isArray(body.cards)) {
    return jsonResponse(400, { error: 'nonce and cards are required' })
  }

  try {
    const sb = serviceClient()
    const { data: encoder } = await sb.from('lock_encoders').select('*').eq('token_hash', sha256Hex(token)).maybeSingle()
    if (!encoder || encoder.revoked_at) return jsonResponse(401, { error: 'Unknown or unpaired device' })

    const { data: rows, error } = await sb.from('key_cards').select('*').eq('order_nonce', body.nonce)
    if (error) throw error
    if (!rows?.length) return jsonResponse(404, { error: 'No such order' })
    if (rows.some((r) => r.encoder_id !== encoder.id)) return jsonResponse(403, { error: 'This order was made for another encoder PC' })

    const now = new Date().toISOString()
    let updated = 0
    const ignored = []
    for (const result of body.cards) {
      const row = rows.find((r) => r.card_no === result?.cardNo)
      if (!row || !RESULTS.includes(result?.status)) { ignored.push({ cardNo: result?.cardNo, reason: 'unknown card or status' }); continue }
      if (row.status === result.status) continue
      if (!['pending', 'unknown'].includes(row.status)) { ignored.push({ cardNo: row.card_no, reason: `already ${row.status}` }); continue }
      const { error: upErr } = await sb.from('key_cards').update({
        status: result.status,
        error: result.error ? String(result.error).slice(0, 300) : null,
        updated_at: now,
      }).eq('id', row.id)
      if (upErr) throw upErr
      updated++
      await logActivity(sb, {
        action: `key_card_${result.status}`,
        entityId: row.id,
        details: { bookingId: row.booking_id, room: row.room_number, guest: row.guest_name, cardNo: row.card_no, validUntil: row.valid_until, error: result.error ?? null, encoder: encoder.label },
      })
    }

    await sb.from('lock_encoders').update({
      last_seen_at: now,
      ...(body.bridgeVersion ? { bridge_version: String(body.bridgeVersion).slice(0, 40) } : {}),
      ...(body.dllVersion ? { dll_version: String(body.dllVersion).slice(0, 80) } : {}),
    }).eq('id', encoder.id)

    return jsonResponse(200, { updated, ignored })
  } catch (e) {
    console.error('[key-card-receipt]', e)
    return jsonResponse(500, { error: 'Could not record the result' })
  }
}
