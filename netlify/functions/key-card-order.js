import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js'
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js'
import {
  POLICY, LIVE_STATUSES, ORDER_VERSION, serviceClient, signingKey, signOrder, validityFor, stayEnd, isLive, planCards,
  cardTime, hotelToday, sharesLock, withinLocks, nextDai, daiFor, encoderForChallenge, randomToken, logActivity, parseBody, UUID, JONEY_DAI, adjustCardStock,
} from './_lib/key-cards.js'

/**
 * Approves and signs an order for guest cards, for the lock bridge to write.
 *
 * POST { bookingId, count, challenge, replace?, update? }   (staff)
 *   challenge: "<encoderId>.<random>", made by the bridge on the reception PC.
 *   replace:   a card was lost. The stay's cards are marked 'replaced' and the
 *              new ones get a new DAI, so the old ones stop at the door.
 *   update:    { cardId }: one of the stay's cards, read at the encoder, is
 *              written again to work until the stay's end as it is now (after
 *              an extension, or when a long stay's card stops at 30 days). Its
 *              DAI, door and start time stay the same, so it works alongside the
 *              stay's other cards; it takes the next card number. Staff mark the
 *              old record re-written ('erased') once the card is written.
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
  // A lost card: new cards for the stay, with a new DAI, so its current cards stop at the door.
  const replace = body.replace === true
  // An update: one card of the stay written again with the stay's end as it is now.
  const updateId = body.update === undefined ? null : body.update?.cardId
  if (body.update !== undefined && (typeof updateId !== 'string' || !UUID.test(updateId))) {
    return jsonResponse(400, { error: 'update.cardId is required' })
  }
  if (updateId && (replace || count !== 1)) return jsonResponse(400, { error: 'An update writes one card, and is not a replacement.' })

  const key = signingKey()
  if (!key) return jsonResponse(503, { error: 'Door locks are not set up on the server yet.' })

  try {
    const sb = serviceClient()
    const now = new Date()

    const { encoder, status: encStatus, error: encError } = await encoderForChallenge(sb, body.challenge)
    if (!encoder) return jsonResponse(encStatus, { error: encError })

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
    // A card the last guest kept does not hold the door: this stay's new DAI locks it
    // out the first time one of the new cards opens it (tested at a door, 2026-11-07).
    // Nor does a lock-out card: it belongs to no stay, and this stay's cards are newer.
    const blocking = live.find((c) => c.booking_id !== booking.id && c.status !== 'not_returned' && c.kind !== 'lockout' && sharesLock(c.lock_nos || [], locks))
    if (blocking) {
      return jsonResponse(409, {
        error: `A card for ${blocking.guest_name || 'another guest'} (room ${blocking.room_number ?? '?'}) still opens this door until ${blocking.valid_until.slice(0, 16).replace('T', ' ')}. Mark it on the Key cards page first (returned, or the guest kept it).`,
        blockingCardId: blocking.id,
      })
    }
    // This stay's cards for the room as it is now. A two-door room's cards each open one door.
    const current = live.filter((c) => c.booking_id === booking.id && withinLocks(c.lock_nos || [], locks))
    // A card made in Joney's program and recorded against the stay (key-card-record) has
    // another DAI: cards from this app take their own, and replace it (below).
    const joney = current.filter((c) => c.dai === JONEY_DAI)
    if (replace && !current.length) {
      return jsonResponse(409, { error: 'This stay has no working cards to replace. Make cards as usual.' })
    }
    // The card to update may have stopped already: that is often why the guest is at the desk.
    let updating = null
    if (updateId) {
      const { data: u, error: uErr } = await sb.from('key_cards').select('*').eq('id', updateId).maybeSingle()
      if (uErr) throw uErr
      if (u && u.booking_id === booking.id && u.kind !== 'lockout' && LIVE_STATUSES.includes(u.status) && withinLocks(u.lock_nos || [], locks)) updating = u
      if (!updating) {
        return jsonResponse(409, { error: 'That card is not one of this stay\'s cards for its room, so it was not updated. Read the card again.' })
      }
      if (updating.dai === JONEY_DAI) {
        return jsonResponse(409, { error: 'That card was made in Joney\'s program, so this app cannot update it. Make new cards for the stay instead: they replace it.' })
      }
      // Once a card with another DAI has been made for the door, the lock may refuse this DAI.
      const { data: since, error: sinceErr } = await sb.from('key_cards').select('dai, status')
        .overlaps('lock_nos', updating.lock_nos).gt('created_at', updating.created_at).limit(50)
      if (sinceErr) throw sinceErr
      if ((since || []).some((c) => Number.isInteger(c.dai) && c.dai !== updating.dai && !['failed', 'pending'].includes(c.status))) {
        return jsonResponse(409, { error: 'A newer card was made for this door since this one, so the lock may refuse it now. Make new cards for the stay instead (Card lost).' })
      }
    }
    // Replacing: the stay starts over like a new one (new DAI, card numbers from 0).
    const mine = replace ? [] : current.filter((c) => c.dai !== JONEY_DAI)

    // An update keeps its card's start time, but its 30 days count from now: that is
    // how a stay longer than a card may run gets its cards moved on.
    // Check-out day at check-out time, or the late check-out, or the last paid day (stayEnd).
    const stay = stayEnd(booking)
    const { begin: from, end, capped } = validityFor(stay.day, now, updating ? null : mine.length ? new Date(mine[0].issue_time) : null, stay.time)
    const start = updating ? new Date(updating.issue_time) : from
    if (end.getTime() <= now.getTime() + 5 * 60000) {
      return jsonResponse(409, {
        error: stay.early
          ? 'The nights paid for are over. In the booking\'s Key cards, move "Cards work until" to a later day first.'
          : 'This stay has ended. Extend it first, then make the card.',
      })
    }
    if (updating && end.getTime() <= new Date(updating.valid_until).getTime() + 60000) {
      return jsonResponse(409, {
        error: `This card already works until ${updating.valid_until.slice(0, 16).replace('T', ' ')}, the end of the stay: there is nothing to update.`,
        upToDate: true,
      })
    }
    const numbered = updating ? [...mine, updating] : mine
    const startCardNo = numbered.length ? Math.max(...numbered.map((c) => c.card_no)) + 1 : 0
    let dai = updating && Number.isInteger(updating.dai) ? updating.dai : await daiFor(sb, locks, mine)
    while (replace && current.some((c) => c.dai === dai)) dai = nextDai(dai)
    // An update writes the one card again, for its own door.
    const cards = updating ? [{ cardNo: startCardNo, lockNos: [...updating.lock_nos] }] : planCards({ locks, count, startCardNo })
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
      note: updating ? `Card ${updating.card_no + 1} written again: it worked until ${updating.valid_until.slice(0, 16).replace('T', ' ')}.` : null,
      encoder_id: encoder.id,
      issued_by: ctx.staff?.id ?? null,
      created_at: stamp,
      updated_at: stamp,
    }))
    if (replace) {
      const { error: repErr } = await sb.from('key_cards').update({
        status: 'replaced',
        note: 'A card was lost: the stay got new cards. This one stops once a new card opens the door.',
        updated_by: ctx.staff?.id ?? null,
        updated_at: stamp,
      }).in('id', current.map((c) => c.id))
      if (repErr) throw repErr
    } else if (joney.length && !updating) {
      const { error: joneyErr } = await sb.from('key_cards').update({
        status: 'replaced',
        note: 'The stay got cards from this app: this card, made in Joney\'s program, stops once one of them opens the door.',
        updated_by: ctx.staff?.id ?? null,
        updated_at: stamp,
      }).in('id', joney.map((c) => c.id))
      if (joneyErr) throw joneyErr
    }
    const { error: insErr } = await sb.from('key_cards').insert(rows)
    if (insErr) throw insErr
    // Blank card stock: the lost card is one fewer.
    if (replace) await adjustCardStock(sb, -1, `Key card lost (room ${roomNumber ?? '?'})`, ctx.staff)

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
      details: { bookingId: booking.id, room: roomNumber, guest: guest?.name ?? null, cards: cards.length, validUntil: end.toISOString(), dai, extra: mine.length > 0, replaced: replace ? current.length : 0, updated: updating?.id ?? null },
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
