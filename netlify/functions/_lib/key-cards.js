/**
 * Door-lock key cards: the rules and the crypto shared by the key-card functions.
 *
 * Cards are written by the lock bridge, a small Windows app on the reception
 * PC that drives the Joney encoder. The bridge writes a card only when it holds
 * an order signed here (ECDSA P-256), bound to a one-time challenge the bridge
 * made itself, so a page, a script or a replayed request cannot make it write
 * anything the server did not approve. The server decides which doors and until
 * when. The browser only carries the order from here to the bridge.
 */
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const POLICY = Object.freeze({
  // Owner decisions, 2026-11-06: check-out at 11:00, cards work for an hour more.
  checkOutTime: '11:00',
  graceMinutes: 60,
  // The start time written on a card is set back this far, so a lock whose
  // clock runs slow still opens for a card made a minute ago.
  clockSlackMinutes: 60,
  // No card is ever valid for longer than this. A longer stay is re-encoded.
  maxDays: 30,
  maxCardsPerOrder: 4,
  // An order the bridge never wrote stops holding the room after this long.
  pendingMinutes: 15,
  // One card for every door of a room (suite 110+109): waiting on Joney.
  // Until then a two-door room gets one card per door.
  suiteOneCard: false,
  // A lock-out card (a guest card for an empty room with a new DAI, held to the
  // lock once to stop every older card) works this long, then stops by itself.
  lockoutMinutes: 20,
})

/**
 * The bookingId of a lock-out order, which belongs to no stay. The lock bridge
 * needs a UUID there and never uses it, so bridges already installed take it.
 */
export const NO_BOOKING = '00000000-0000-0000-0000-000000000000'

/** "<encoderId>.<random>", the one-time challenge the lock bridge makes for each order. */
export const CHALLENGE = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{16,128})$/i

/** Card states in which the card can open its door (while not expired). */
export const LIVE_STATUSES = Object.freeze(['issued', 'unknown', 'not_returned'])

export const ALLOWED_ORIGINS = Object.freeze(['https://amplodge.org', 'https://www.amplodge.org'])

export function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw Object.assign(new Error('Server configuration error'), { status: 500 })
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ─── Time. Ghana is on GMT all year, so hotel time is UTC. ──────────────────

const pad = (n) => String(n).padStart(2, '0')

/** The card's 10-digit time format, yyMMddHHmm, in hotel time. */
export function cardTime(d) {
  return pad(d.getUTCFullYear() % 100) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes())
}

export function floorToMinute(d) {
  return new Date(Math.floor(d.getTime() / 60000) * 60000)
}

export function ceilToMinute(d) {
  return new Date(Math.ceil(d.getTime() / 60000) * 60000)
}

export function hotelToday(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

/**
 * When a card for a stay starts and ends.
 * begin: given (extra cards reuse their booking's start time) or now minus the clock slack.
 * end:   check-out day at check-out time plus grace, never more than maxDays after begin.
 */
export function validityFor(checkOutDate, now = new Date(), begin = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(checkOutDate || '').slice(0, 10))) throw new Error('Bad check-out date')
  const start = begin ? new Date(begin) : floorToMinute(new Date(now.getTime() - POLICY.clockSlackMinutes * 60000))
  const [h, m] = POLICY.checkOutTime.split(':').map(Number)
  const [y, mo, d] = String(checkOutDate).slice(0, 10).split('-').map(Number)
  let end = new Date(Date.UTC(y, mo - 1, d, h, m) + POLICY.graceMinutes * 60000)
  const cap = new Date(start.getTime() + POLICY.maxDays * 86400000)
  const capped = end > cap
  if (capped) end = cap
  return { begin: start, end, capped }
}

/** Can this card open its door right now, as far as we know? */
export function isLive(card, now = new Date()) {
  if (new Date(card.valid_until) <= now) return false
  if (LIVE_STATUSES.includes(card.status)) return true
  return card.status === 'pending' && now.getTime() - new Date(card.created_at).getTime() < POLICY.pendingMinutes * 60000
}

export const sameLocks = (a, b) => [...a].sort().join(',') === [...b].sort().join(',')
export const sharesLock = (a, b) => a.some((x) => b.includes(x))
/**
 * A card made for this room as it is now: it opens only doors of the room. A
 * two-door room's cards each open one of its doors, so this is not sameLocks.
 */
export const withinLocks = (card, room) => card.length > 0 && card.every((x) => room.includes(x))

/** The cards one order writes: card numbers count up from startCardNo. */
export function planCards({ locks, count, startCardNo = 0 }) {
  const cards = []
  let no = startCardNo
  for (let i = 0; i < count; i++) {
    if (POLICY.suiteOneCard) cards.push({ cardNo: no++, lockNos: [...locks] })
    else for (const lock of locks) cards.push({ cardNo: no++, lockNos: [lock] })
  }
  return cards
}

/**
 * A lock number: the 6-character code Joney's Lock Management System shows for
 * a door (0-9 and A-F, e.g. 01020A; the first two are the building). Capitals
 * only: normalizeLockNo first.
 */
export function isLockNo(s) {
  return typeof s === 'string' && /^[0-9A-F]{6}$/.test(s)
}
export const normalizeLockNo = (s) => String(s ?? '').trim().toUpperCase()

/**
 * The DAI for a new stay's cards: one more than the last one used on these
 * doors, 1..255, and 255 is followed by 1. The lock refuses a card whose DAI
 * differs from the newest one it has seen, so only "different" matters.
 */
export function nextDai(last) {
  return Number.isInteger(last) && last >= 1 && last < 255 ? last + 1 : 1
}

/**
 * The DAI for an order. Extra cards for a stay take the DAI its working cards
 * have (`mine`). Anything else (a new stay, a lost card's replacements, a
 * lock-out card) takes the next one after the newest card ever made for any of
 * its doors, whatever became of that card: two stays in a row must never share one.
 */
export async function daiFor(sb, locks, mine = []) {
  const own = [...mine].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).find((c) => Number.isInteger(c.dai))
  if (own) return own.dai
  const { data, error } = await sb.from('key_cards').select('dai, created_at')
    .overlaps('lock_nos', locks).order('created_at', { ascending: false }).limit(20)
  if (error) throw error
  return nextDai((data || []).find((c) => Number.isInteger(c.dai))?.dai ?? null)
}

/**
 * The paired encoder PC a challenge names, or an error response body. A bridge
 * makes the challenge itself; its first part is the PC's encoder ID.
 */
export async function encoderForChallenge(sb, challenge) {
  const m = CHALLENGE.exec(String(challenge || ''))
  if (!m || !UUID.test(m[1])) return { status: 400, error: 'The encoder PC sent no valid challenge. Is the lock bridge running?' }
  const { data: encoder } = await sb.from('lock_encoders').select('id, label, token_hash, revoked_at').eq('id', m[1].toLowerCase()).maybeSingle()
  if (!encoder || !encoder.token_hash || encoder.revoked_at) {
    return { status: 409, error: 'This PC is not paired as the encoder PC, or it was unpaired. An admin can pair it in Settings.' }
  }
  return { encoder }
}

/** The order format the lock bridge accepts (v2: lock codes are 6 hex characters, and orders carry a DAI). */
export const ORDER_VERSION = 2

// ─── Secrets ─────────────────────────────────────────────────────────────────

export const sha256Hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I
/** 20 characters, 100 bits: shown once to the admin, typed into the bridge. */
export function pairingCode() {
  const bytes = crypto.randomBytes(20)
  const raw = [...bytes].map((b) => CODE_ALPHABET[b % 32]).join('')
  return raw.match(/.{5}/g).join('-')
}
export const normalizePairingCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** The device token a bridge sends as `Authorization: Device <token>`. */
export function deviceToken(event) {
  const h = event.headers?.authorization || event.headers?.Authorization || ''
  return h.startsWith('Device ') ? h.slice(7).trim() : ''
}

/** The order-signing key, from LOCK_ORDER_PRIVATE_KEY (PKCS#8 PEM). Null if unset. */
export function signingKey() {
  const pem = process.env.LOCK_ORDER_PRIVATE_KEY
  if (!pem) return null
  return crypto.createPrivateKey(pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem)
}

/** The public half, as base64 SubjectPublicKeyInfo (what .NET ImportSubjectPublicKeyInfo reads). */
export function publicKeyBase64(privateKey) {
  return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64')
}

/** Signs the exact order string. The bridge verifies these bytes, then parses them. */
export function signOrder(payload, privateKey) {
  return crypto.sign('sha256', Buffer.from(payload, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
}

export function verifyOrder(payload, signature, publicKeyB64) {
  const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' })
  return crypto.verify('sha256', Buffer.from(payload, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64'))
}

export async function logActivity(sb, { action, entityId, details, userId }) {
  const { error } = await sb.from('activity_logs').insert({
    action,
    entity_type: 'key_card',
    entity_id: String(entityId ?? ''),
    details: details || {},
    user_id: String(userId || 'lock-bridge'),
    created_at: new Date().toISOString(),
  })
  if (error) console.warn('[key-cards] activity log failed:', error.message)
}

export function parseBody(event) {
  try {
    const body = JSON.parse(event.body || '{}')
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
