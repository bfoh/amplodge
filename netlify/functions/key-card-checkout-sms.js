/**
 * Check-out morning SMS (scheduled, 07:30 Ghana time; see netlify.toml). Guests checked in
 * and leaving today get one SMS: check-out time, when their key card stops (if they have
 * a working one) and to hand the cards in, or to ask about staying longer.
 *
 * Switched on and off in Settings → Door locks (hotel_settings.checkout_morning_sms). Off
 * until 20261109120000_key_cards_stay_rules.sql has been run, and bookings.checkout_sms_sent_on
 * makes it go once per booking.
 * An admin can also run it by hand (POST with their token).
 */
import { requireCron, jsonResponse, handleCors } from './_lib/auth.js'
import { LIVE_STATUSES, POLICY, hotelToday, serviceClient, stayEnd, validityFor } from './_lib/key-cards.js'
import { ghanaNumber, sendSms } from './_lib/sms.js'

const HELP_PHONE = '+233555009697'

const hhmm = (d) => d.toISOString().slice(11, 16)

/** The SMS for one guest leaving today. rooms: [{ roomNumber, leaves, keyUntil | null }] */
export function checkoutMessage(firstName, rooms) {
  const one = rooms.length === 1
  const leaves = [...new Set(rooms.map((r) => r.leaves))]
  const keys = rooms.filter((r) => r.keyUntil)
  const keyUntil = [...new Set(keys.map((r) => r.keyUntil))]
  const lines = [
    `Good morning${firstName ? ` ${firstName}` : ''}. Today is your check-out day at AMP Lodge${one ? '' : ` (rooms ${rooms.map((r) => r.roomNumber).join(', ')})`}: check-out is at ${leaves.length === 1 ? leaves[0] : leaves.join(' / ')}.`,
  ]
  if (keys.length) {
    lines.push(`Your key card stops working at ${keyUntil.length === 1 ? keyUntil[0] : keyUntil.join(' / ')}. Please hand your key card${keys.length > 1 || !one ? 's' : '(s)'} in at reception when you leave.`)
  }
  lines.push(`To stay longer, call ${HELP_PHONE} or ask at reception. Thank you for staying with us!`)
  return lines.join('\n')
}

/** Sends today's SMS. Returns what it did, for the log and for a run by hand. */
export async function runCheckoutSms(sb, now = new Date(), send = sendSms) {
  const { data: settingsRows, error: settingsErr } = await sb.from('hotel_settings').select('*').limit(1)
  if (settingsErr) throw settingsErr
  if (settingsRows?.[0]?.checkout_morning_sms !== true) return { sent: 0, failed: 0, skipped: 0, off: true }

  const today = hotelToday(now)
  const { data: leaving, error: bookErr } = await sb.from('bookings').select('*').eq('status', 'checked-in').eq('check_out', today)
  if (bookErr) throw bookErr
  const due = (leaving ?? []).filter((b) => String(b.checkout_sms_sent_on ?? '').slice(0, 10) !== today && b.guest_id)
  if (!due.length) return { sent: 0, failed: 0, skipped: 0, off: false }

  const [{ data: guests }, { data: rooms }, { data: cards }] = await Promise.all([
    sb.from('guests').select('id, name, phone').in('id', [...new Set(due.map((b) => b.guest_id))]),
    sb.from('rooms').select('id, room_number').in('id', [...new Set(due.map((b) => b.room_id))]),
    sb.from('key_cards').select('*').in('booking_id', due.map((b) => b.id)).gt('valid_until', now.toISOString()),
  ])
  const guestOf = new Map((guests ?? []).map((g) => [g.id, g]))
  const roomOf = new Map((rooms ?? []).map((r) => [r.id, String(r.room_number)]))

  // One SMS per phone number: a guest with two rooms gets one message.
  const byPhone = new Map()
  let skipped = 0
  for (const b of due) {
    const g = guestOf.get(b.guest_id)
    const number = ghanaNumber(g?.phone)
    if (!number) { skipped++; continue }
    const stay = stayEnd(b)
    const working = (cards ?? []).some((c) => c.booking_id === b.id && (c.kind ?? 'guest') === 'guest' && LIVE_STATUSES.includes(c.status) && c.status !== 'not_returned')
    const keyUntil = working ? hhmm(validityFor(stay.day, now, null, stay.time).end) : null
    const entry = byPhone.get(number) ?? { phone: number, name: g?.name ?? '', bookings: [], rooms: [] }
    entry.bookings.push(b.id)
    entry.rooms.push({ roomNumber: roomOf.get(b.room_id) ?? '?', leaves: stay.early ? POLICY.checkOutTime : stay.time, keyUntil })
    byPhone.set(number, entry)
  }

  let sent = 0
  let failed = 0
  for (const entry of byPhone.values()) {
    const first = String(entry.name).trim().split(/\s+/)[0] ?? ''
    const result = await send(entry.phone, checkoutMessage(first, entry.rooms))
    if (!result.ok) {
      failed++
      console.error(`[checkout-sms] not sent to booking(s) ${entry.bookings.join(', ')}: ${result.error}`)
      continue
    }
    sent++
    const { error } = await sb.from('bookings').update({ checkout_sms_sent_on: today }).in('id', entry.bookings)
    if (error) console.error('[checkout-sms] could not record the SMS as sent', error.message)
  }
  return { sent, failed, skipped, off: false }
}

export const handler = async (event) => {
  const cors = handleCors(event)
  if (cors) return cors
  try {
    await requireCron(event)
  } catch (e) {
    return jsonResponse(e.status || 401, e.body || { error: 'Not allowed' })
  }
  try {
    const result = await runCheckoutSms(serviceClient())
    console.log('[checkout-sms]', JSON.stringify(result))
    return jsonResponse(200, result)
  } catch (e) {
    console.error('[checkout-sms] failed', e)
    return jsonResponse(500, { error: 'The check-out SMS could not be sent.' })
  }
}
