import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js'
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js'
import {
  POLICY, LIVE_STATUSES, ORDER_VERSION, NO_BOOKING, serviceClient, signingKey, signOrder, isLive, planCards,
  cardTime, floorToMinute, ceilToMinute, hotelToday, sharesLock, daiFor, encoderForChallenge, randomToken,
  logActivity, parseBody, UUID,
} from './_lib/key-cards.js'

/**
 * Approves and signs an order for a lock-out card, for the lock bridge to write.
 *
 * POST { roomId, challenge }   (staff)
 *
 * A door lock is offline: it only learns from the cards held against it. A guest
 * card that should be dead (an early check-out, a cancelled booking, a guest who
 * moved rooms, a card nobody returned) keeps opening the door until its end time,
 * unless the lock is told otherwise at the door. A lock-out card does that: it is
 * a guest card for the empty room with the next DAI, valid for a few minutes.
 * Held to the lock once, it makes the lock refuse every older card, including
 * cards made in Joney's program (tested at a door, 2026-11-07). Then it stops by
 * itself. The next guest's cards get the DAI after it, as usual.
 *
 * Refused while a guest staying in the room has working cards: those would stop
 * too ("Card lost" on their card is the way to replace a stay's cards). The
 * room's other live cards are marked 'locked_out'.
 */
export const handler = async (event) => {
  const cors = handleCors(event); if (cors) return cors
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  let ctx
  try { ctx = await requireStaff(event) } catch (e) { return jsonResponse(e.status, e.body) }

  const { allowed } = await checkRateLimit(event, { endpoint: `key-card-lockout:${ctx.staff?.id}`, limit: 10 })
  if (!allowed) return tooManyRequests()

  const body = parseBody(event)
  if (!body) return jsonResponse(400, { error: 'Invalid JSON body' })
  if (typeof body.roomId !== 'string' || !UUID.test(body.roomId)) return jsonResponse(400, { error: 'roomId is required' })

  const key = signingKey()
  if (!key) return jsonResponse(503, { error: 'Door locks are not set up on the server yet.' })

  try {
    const sb = serviceClient()
    const now = new Date()

    const { encoder, status: encStatus, error: encError } = await encoderForChallenge(sb, body.challenge)
    if (!encoder) return jsonResponse(encStatus, { error: encError })

    const [{ data: room }, { data: lockRows, error: lockErr }] = await Promise.all([
      sb.from('rooms').select('id, room_number').eq('id', body.roomId).maybeSingle(),
      sb.from('room_locks').select('lock_no').eq('room_id', body.roomId),
    ])
    if (lockErr) throw lockErr
    if (!room) return jsonResponse(404, { error: 'Room not found' })
    const roomNumber = room.room_number ?? null
    const locks = (lockRows || []).map((r) => r.lock_no).sort()
    if (!locks.length) {
      return jsonResponse(409, { error: `Room ${roomNumber ?? '?'} has no lock number yet. An admin can add it on the Rooms page.` })
    }

    // Every card that may still open one of these doors.
    const { data: maybeLive, error: liveErr } = await sb.from('key_cards').select('*')
      .in('status', ['pending', ...LIVE_STATUSES]).gt('valid_until', now.toISOString())
    if (liveErr) throw liveErr
    const live = (maybeLive || []).filter((c) => isLive(c, now) && sharesLock(c.lock_nos || [], locks))

    // A guest staying in this room keeps their cards.
    const bookingIds = [...new Set(live.map((c) => c.booking_id).filter(Boolean))]
    if (bookingIds.length) {
      const { data: stays, error: stayErr } = await sb.from('bookings').select('id, room_id, status, check_in').in('id', bookingIds)
      if (stayErr) throw stayErr
      const today = hotelToday(now)
      const staying = (stays || []).find((b) => b.room_id === body.roomId && (b.status === 'checked-in'
        || (['reserved', 'confirmed'].includes(b.status) && String(b.check_in || '').slice(0, 10) <= today)))
      if (staying) {
        const card = live.find((c) => c.booking_id === staying.id)
        return jsonResponse(409, {
          error: `${card?.guest_name || 'A guest'} is staying in room ${roomNumber ?? '?'} with working cards, and a lock-out card would stop them too. For a lost card, use "Card lost" on the guest's card.`,
        })
      }
    }

    const dai = await daiFor(sb, locks)
    const begin = floorToMinute(new Date(now.getTime() - POLICY.clockSlackMinutes * 60000))
    const end = ceilToMinute(new Date(now.getTime() + POLICY.lockoutMinutes * 60000))
    const cards = planCards({ locks, count: 1 })
    const nonce = randomToken(18)
    const stamp = now.toISOString()

    if (live.length) {
      const { error: outErr } = await sb.from('key_cards').update({
        status: 'locked_out',
        note: `A lock-out card was made at ${stamp.slice(11, 16)}: this card stops once it is used at the door.`,
        updated_by: ctx.staff?.id ?? null,
        updated_at: stamp,
      }).in('id', live.map((c) => c.id))
      if (outErr) throw outErr
    }
    const { error: insErr } = await sb.from('key_cards').insert(cards.map((c) => ({
      kind: 'lockout',
      booking_id: null,
      room_id: room.id,
      guest_name: null,
      room_number: roomNumber,
      lock_nos: c.lockNos,
      order_nonce: nonce,
      card_no: c.cardNo,
      dai,
      issue_time: begin.toISOString(),
      valid_until: end.toISOString(),
      status: 'pending',
      encoder_id: encoder.id,
      issued_by: ctx.staff?.id ?? null,
      note: 'Lock-out card: hold it to the lock once.',
      created_at: stamp,
      updated_at: stamp,
    })))
    if (insErr) throw insErr

    const order = JSON.stringify({
      v: ORDER_VERSION,
      kind: 'guest-cards',
      purpose: 'lockout',
      challenge: body.challenge,
      nonce,
      encoderId: encoder.id,
      bookingId: NO_BOOKING,
      guest: null,
      room: roomNumber,
      begin: cardTime(begin),
      end: cardTime(end),
      validUntil: end.toISOString(),
      dai,
      cards,
    })
    await logActivity(sb, {
      action: 'key_card_lockout',
      entityId: nonce,
      userId: ctx.user?.id,
      details: { roomId: room.id, room: roomNumber, cards: cards.length, validUntil: end.toISOString(), dai, lockedOut: live.length },
    })
    return jsonResponse(200, {
      order,
      signature: signOrder(order, key),
      summary: { room: roomNumber, validUntil: end.toISOString(), cards: cards.length, lockedOut: live.length },
    })
  } catch (e) {
    console.error('[key-card-lockout]', e)
    return jsonResponse(500, { error: 'Could not prepare the lock-out card' })
  }
}
