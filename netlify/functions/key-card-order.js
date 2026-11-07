import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js'
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js'
import {
  POLICY, LIVE_STATUSES, ORDER_VERSION, serviceClient, signingKey, signOrder, validityFor, isLive, planCards,
  cardTime, hotelToday, sameLocks, sharesLock, nextDai, randomToken, logActivity, parseBody, UUID,
} from './_lib/key-cards.js'

/**
 * Approves and signs an order for guest cards, for the lock bridge to write.
 *
 * POST { bookingId, count, challenge }   (staff)
 *   challenge: "<encoderId>.<random>", made by the bridge on the reception PC.
 *
 * The server decides everything that matters: the doors (room_locks of the
 * booking's room), the start and end times (check-out day at 11:00 plus an
 * hour, never more than 30 days) and the card numbers. It refuses when the
 * guest is not checked in or arriving today, when the room has no lock number,
 * and when another booking still holds a live card for one of its doors.
 *
 * Extra cards for a booking reuse its cards' start time and DAI with the next
 * card numbers, so they work alongside the cards the guest already has. A new
 * stay gets the next DAI for its doors: once its card has opened the door, the
 * previous guest's cards stop working there.
 */
const CHALLENGE = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{16,128})$/i

export const handler = async (event) => {
  const cors = handleCors(event); if (cors) return cors
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  let ctx
  try { ctx = await requireStaff(event) } catch (e) { return jsonResponse(e.status, e.body) }

  const { allowed } = await checkRateLimit(event, { endpoint: `key-card-order:${ctx.staff?.id}`, limit: 20 })
  if (!allowed) return tooManyRequests()

  const body = parseBody(event)
  if (!body) return jsonResponse(400, { error: 'Invalid JSON body' })
  const count = body.count === undefined ? 1 : body.count
  if (!Number.isInteger(count) || count < 1 || count > POLICY.maxCardsPerOrder) {
    return jsonResponse(400, { error: `Between 1 and ${POLICY.maxCardsPerOrder} cards at a time.` })
  }
  if (typeof body.bookingId !== 'string' || !UUID.test(body.bookingId)) return jsonResponse(400, { error: 'bookingId is required' })
  const m = CHALLENGE.exec(String(body.challenge || ''))
  if (!m || !UUID.test(m[1])) return jsonResponse(400, { error: 'The encoder PC sent no valid challenge. Is the lock bridge running?' })
  const encoderId = m[1].toLowerCase()

  const key = signingKey()
  if (!key) return jsonResponse(503, { error: 'Door locks are not set up on the server yet.' })

  try {
    const sb = serviceClient()
    const now = new Date()

    const { data: encoder } = await sb.from('lock_encoders').select('id, label, token_hash, revoked_at').eq('id', encoderId).maybeSingle()
    if (!encoder || !encoder.token_hash || encoder.revoked_at) {
      return jsonResponse(409, { error: 'This PC is not paired as the encoder PC, or it was unpaired. An admin can pair it in Settings.' })
    }

    const { data: booking } = await sb.from('bookings').select('*').eq('id', body.bookingId).maybeSingle()
    if (!booking) return jsonResponse(404, { error: 'Booking not found' })
    const today = hotelToday(now)
    const checkIn = String(booking.check_in || '').slice(0, 10)
    const arriving = ['reserved', 'confirmed'].includes(booking.status) && checkIn <= today
    if (booking.status !== 'checked-in' && !arriving) {
      return jsonResponse(409, { error: 'Key cards are only for guests who are checked in or arriving today.' })
    }

    const [{ data: room }, { data: guest }, { data: lockRows, error: lockErr }] = await Promise.all([
      sb.from('rooms').select('id, room_number').eq('id', booking.room_id).maybeSingle(),
      booking.guest_id ? sb.from('guests').select('name').eq('id', booking.guest_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from('room_locks').select('lock_no').eq('room_id', booking.room_id),
    ])
    if (lockErr) throw lockErr
    const roomNumber = room?.room_number ?? null
    const locks = (lockRows || []).map((r) => r.lock_no).sort()
    if (!locks.length) {
      return jsonResponse(409, { error: `${roomNumber ? `Room ${roomNumber}` : 'This room'} has no lock number yet. An admin can add it on the Rooms page.` })
    }

    // Every card that may still open one of these doors, or belongs to this booking.
    const { data: maybeLive, error: liveErr } = await sb.from('key_cards').select('*')
      .in('status', ['pending', ...LIVE_STATUSES]).gt('valid_until', now.toISOString())
    if (liveErr) throw liveErr
    const live = (maybeLive || []).filter((c) => isLive(c, now))
    const blocking = live.find((c) => c.booking_id !== booking.id && sharesLock(c.lock_nos || [], locks))
    if (blocking) {
      return jsonResponse(409, {
        error: `A card for ${blocking.guest_name || 'another guest'} (room ${blocking.room_number ?? '?'}) still opens this door until ${blocking.valid_until.slice(0, 16).replace('T', ' ')}. Mark it on the Key cards page first.`,
        blockingCardId: blocking.id,
      })
    }
    const mine = live.filter((c) => c.booking_id === booking.id && sameLocks(c.lock_nos || [], locks))

    const begin = mine.length ? new Date(mine[0].issue_time) : null
    const { begin: start, end, capped } = validityFor(booking.check_out, now, begin)
    if (end.getTime() <= now.getTime() + 5 * 60000) {
      return jsonResponse(409, { error: 'This stay has ended. Extend it first, then make the card.' })
    }
    const startCardNo = mine.length ? Math.max(...mine.map((c) => c.card_no)) + 1 : 0
    const dai = await daiFor(sb, locks, mine)
    const cards = planCards({ locks, count, startCardNo })
    if (cards[cards.length - 1].cardNo > 15) {
      return jsonResponse(409, { error: 'This booking already has 16 cards on its start time. Mark the old ones returned and make a fresh set.' })
    }

    const nonce = randomToken(18)
    const stamp = now.toISOString()
    const rows = cards.map((c) => ({
      booking_id: booking.id,
      room_id: booking.room_id,
      guest_name: guest?.name ?? null,
      room_number: roomNumber,
      lock_nos: c.lockNos,
      order_nonce: nonce,
      card_no: c.cardNo,
      dai,
      issue_time: start.toISOString(),
      valid_until: end.toISOString(),
      status: 'pending',
      encoder_id: encoder.id,
      issued_by: ctx.staff?.id ?? null,
      created_at: stamp,
      updated_at: stamp,
    }))
    const { error: insErr } = await sb.from('key_cards').insert(rows)
    if (insErr) throw insErr

    const order = JSON.stringify({
      v: ORDER_VERSION,
      kind: 'guest-cards',
      challenge: body.challenge,
      nonce,
      encoderId: encoder.id,
      bookingId: booking.id,
      guest: guest?.name ?? null,
      room: roomNumber,
      begin: cardTime(start),
      end: cardTime(end),
      validUntil: end.toISOString(),
      dai,
      cards,
    })
    await logActivity(sb, {
      action: 'key_card_ordered',
      entityId: nonce,
      userId: ctx.user?.id,
      details: { bookingId: booking.id, room: roomNumber, guest: guest?.name ?? null, cards: cards.length, validUntil: end.toISOString(), dai, extra: mine.length > 0 },
    })
    return jsonResponse(200, {
      order,
      signature: signOrder(order, key),
      summary: { guest: guest?.name ?? null, room: roomNumber, validUntil: end.toISOString(), cards: cards.length, capped },
    })
  } catch (e) {
    console.error('[key-card-order]', e)
    return jsonResponse(500, { error: 'Could not prepare the key card' })
  }
}

/**
 * The DAI for this order. Extra cards for a stay take the DAI its working cards
 * have. A new stay takes the next one after the newest card ever made for any of
 * its doors, whatever became of that card: two stays in a row must never share one.
 */
async function daiFor(sb, locks, mine) {
  const own = [...mine].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).find((c) => Number.isInteger(c.dai))
  if (own) return own.dai
  const { data, error } = await sb.from('key_cards').select('dai, created_at')
    .overlaps('lock_nos', locks).order('created_at', { ascending: false }).limit(20)
  if (error) throw error
  return nextDai((data || []).find((c) => Number.isInteger(c.dai))?.dai ?? null)
}
