import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js'
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js'
import {
  JONEY_DAI, LIVE_STATUSES, serviceClient, isLive, isLockNo, normalizeLockNo, floorToMinute, hotelToday,
  randomToken, logActivity, parseBody, UUID,
} from './_lib/key-cards.js'

/**
 * Records a guest card made in Joney's own program (LQ015) against a stay, from Read a
 * card at the reception PC. For when the app could not make the card (no internet, the
 * server down): the card is made in LQ015, and recorded here afterwards so the app
 * knows who has it, collects it at check-out and flags it if it is kept.
 *
 * POST { bookingId, lockNo, validUntil }   (staff)
 *   lockNo, validUntil: as read from the card (Read a card). Only a card with DAI 0,
 *   which is what LQ015 writes, is recorded.
 *
 * Such a card has another DAI than this app's cards: once it opens the door, the lock
 * refuses the cards the app made for that door before it. Those are marked
 * 'locked_out' here, as a lock-out card does. Cards the app makes for the stay later
 * replace it in turn (key-card-order).
 */
const MAX_DAYS = 60

export const handler = async (event) => {
  const cors = handleCors(event); if (cors) return cors
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  let ctx
  try { ctx = await requireStaff(event) } catch (e) { return jsonResponse(e.status, e.body) }

  const { allowed } = await checkRateLimit(event, { endpoint: `key-card-record:${ctx.staff?.id}`, limit: 20 })
  if (!allowed) return tooManyRequests()

  const body = parseBody(event)
  if (!body) return jsonResponse(400, { error: 'Invalid JSON body' })
  if (typeof body.bookingId !== 'string' || !UUID.test(body.bookingId)) return jsonResponse(400, { error: 'bookingId is required' })
  const lockNo = normalizeLockNo(body.lockNo)
  if (!isLockNo(lockNo)) return jsonResponse(400, { error: 'lockNo must be the 6-character door code read from the card' })
  const until = new Date(String(body.validUntil ?? ''))
  if (Number.isNaN(until.getTime())) return jsonResponse(400, { error: 'validUntil must be the end time read from the card' })

  try {
    const sb = serviceClient()
    const now = new Date()
    if (until <= now) return jsonResponse(409, { error: 'This card has expired: there is nothing to record.' })
    if (until.getTime() > now.getTime() + MAX_DAYS * 86400000) {
      return jsonResponse(409, { error: `This card works for more than ${MAX_DAYS} days. Check its end time in Joney's program.` })
    }

    const { data: lock, error: lockErr } = await sb.from('room_locks').select('room_id, lock_no').eq('lock_no', lockNo).maybeSingle()
    if (lockErr) throw lockErr
    if (!lock) return jsonResponse(409, { error: `No room has door code ${lockNo}. An admin can add it first (Read a card).` })

    const { data: booking } = await sb.from('bookings').select('*').eq('id', body.bookingId).maybeSingle()
    if (!booking) return jsonResponse(404, { error: 'Booking not found' })
    if (booking.room_id !== lock.room_id) return jsonResponse(409, { error: 'This card opens another room than the booking\'s.' })
    const today = hotelToday(now)
    const arriving = ['reserved', 'confirmed'].includes(booking.status) && String(booking.check_in || '').slice(0, 10) <= today
    if (booking.status !== 'checked-in' && !arriving) {
      return jsonResponse(409, { error: 'A card can only be recorded for a guest who is checked in or arriving today.' })
    }

    const [{ data: room }, { data: guest }, { data: maybeLive, error: liveErr }] = await Promise.all([
      sb.from('rooms').select('id, room_number').eq('id', booking.room_id).maybeSingle(),
      booking.guest_id ? sb.from('guests').select('name').eq('id', booking.guest_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from('key_cards').select('*').in('status', ['pending', ...LIVE_STATUSES]).gt('valid_until', now.toISOString()),
    ])
    if (liveErr) throw liveErr
    const onDoor = (maybeLive || []).filter((c) => isLive(c, now) && (c.lock_nos || []).includes(lockNo))

    // Read twice, recorded once: the same door and end time, a minute either way.
    const same = onDoor.find((c) => c.dai === JONEY_DAI && Math.abs(new Date(c.valid_until).getTime() - until.getTime()) <= 60000)
    if (same) return jsonResponse(409, { error: `This card is recorded already${same.guest_name ? `, for ${same.guest_name}` : ''}.`, cardId: same.id })

    const stopped = onDoor.filter((c) => c.dai !== JONEY_DAI && c.status !== 'pending')
    const stamp = now.toISOString()
    if (stopped.length) {
      const { error: outErr } = await sb.from('key_cards').update({
        status: 'locked_out',
        note: `A card made in Joney's program for this door was recorded at ${stamp.slice(11, 16)}: this card stops once that one is used at the door.`,
        updated_by: ctx.staff?.id ?? null,
        updated_at: stamp,
      }).in('id', stopped.map((c) => c.id))
      if (outErr) throw outErr
    }

    const { data: row, error: insErr } = await sb.from('key_cards').insert({
      kind: 'guest',
      booking_id: booking.id,
      room_id: booking.room_id,
      guest_name: guest?.name ?? null,
      room_number: room?.room_number ?? null,
      lock_nos: [lockNo],
      order_nonce: `lq015-${randomToken(12)}`,
      card_no: 0,
      dai: JONEY_DAI,
      // The card's own start time cannot be read: when it was recorded stands in for it.
      issue_time: floorToMinute(now).toISOString(),
      valid_until: until.toISOString(),
      status: 'issued',
      note: 'Made in Joney\'s program (LQ015), recorded from Read a card.',
      issued_by: ctx.staff?.id ?? null,
      created_at: stamp,
      updated_at: stamp,
    }).select('id').single()
    if (insErr) throw insErr

    await logActivity(sb, {
      action: 'key_card_recorded',
      entityId: row.id,
      userId: ctx.user?.id,
      details: { bookingId: booking.id, room: room?.room_number ?? null, guest: guest?.name ?? null, validUntil: until.toISOString(), stopped: stopped.length },
    })
    return jsonResponse(200, { id: row.id, stopped: stopped.length })
  } catch (e) {
    console.error('[key-card-record]', e)
    return jsonResponse(500, { error: 'Could not record the card' })
  }
}
