import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js'
import { serviceClient, logActivity, parseBody, UUID, adjustCardStock } from './_lib/key-cards.js'

/**
 * Staff record what happened to a card that the bridge cannot see:
 *   returned        the card is back at reception
 *   not_returned    the guest left with it (it opens the door until it expires,
 *                   or until the next stay's card opens the door)
 *   killed_at_door  cancelled at the door with the lock software's own card
 *   issued          only for a card whose writing was cut off ('unknown'): it
 *                   was read at the encoder and is as it should be
 *   erased          the card was written again (an update after an extension, or
 *                   a move to another room), so what this record describes is no
 *                   longer on any card. Only once the stay has a newer card.
 *
 * A card replaced after a loss, or locked out at the door, can only be marked
 * returned (it was found). So can a lock-out card: it belongs to no stay.
 *
 * POST { cardId, status, note? }   (staff)
 */
const MARKS = ['returned', 'not_returned', 'killed_at_door', 'issued', 'erased']
const FROM = ['issued', 'unknown', 'returned', 'not_returned', 'replaced', 'locked_out']
const RETURN_ONLY = ['replaced', 'locked_out']
/** A card that can be written again: one that may still open its door. */
const REWRITABLE = ['issued', 'unknown', 'not_returned']

export const handler = async (event) => {
  const cors = handleCors(event); if (cors) return cors
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  let ctx
  try { ctx = await requireStaff(event) } catch (e) { return jsonResponse(e.status, e.body) }

  const body = parseBody(event)
  if (!body || typeof body.cardId !== 'string' || !UUID.test(body.cardId)) return jsonResponse(400, { error: 'cardId is required' })
  if (!MARKS.includes(body.status)) return jsonResponse(400, { error: `status must be one of ${MARKS.join(', ')}` })

  try {
    const sb = serviceClient()
    const { data: card } = await sb.from('key_cards').select('*').eq('id', body.cardId).maybeSingle()
    if (!card) return jsonResponse(404, { error: 'Card not found' })
    if (!FROM.includes(card.status) || ((RETURN_ONLY.includes(card.status) || card.kind === 'lockout') && body.status !== 'returned')
      || (body.status === 'issued' && card.status !== 'unknown')) {
      return jsonResponse(409, { error: `A ${card.kind === 'lockout' ? 'lock-out' : card.status} card cannot be marked ${body.status}.` })
    }
    if (body.status === 'erased') {
      if (!REWRITABLE.includes(card.status) || !card.booking_id) {
        return jsonResponse(409, { error: `A ${card.kind === 'lockout' ? 'lock-out' : card.status} card cannot be marked written again.` })
      }
      // The card was written again: the stay must have a card made after this one.
      const { data: newer, error: newerErr } = await sb.from('key_cards').select('id')
        .eq('booking_id', card.booking_id).in('status', ['pending', 'issued', 'unknown']).gt('created_at', card.created_at).limit(1)
      if (newerErr) throw newerErr
      if (!newer?.length) return jsonResponse(409, { error: 'This stay has no newer card, so this one was not written again.' })
    }

    const note = body.note ? String(body.note).slice(0, 300) : null
    const was = card.status
    const { error } = await sb.from('key_cards').update({
      status: body.status,
      note,
      updated_by: ctx.staff?.id ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', card.id)
    if (error) throw error
    // Blank card stock: a kept card is one fewer, until it is brought back.
    const room = card.room_number ? `room ${card.room_number}` : 'a room'
    if (body.status === 'not_returned' && was !== 'not_returned') {
      await adjustCardStock(sb, -1, `Key card kept by the guest (${room})`, ctx.staff)
    } else if (body.status === 'returned' && was === 'not_returned') {
      await adjustCardStock(sb, 1, `Kept key card brought back (${room})`, ctx.staff)
    }
    await logActivity(sb, {
      action: `key_card_${body.status}`,
      entityId: card.id,
      userId: ctx.user?.id,
      details: { bookingId: card.booking_id, room: card.room_number, guest: card.guest_name, from: was, note },
    })
    return jsonResponse(200, { id: card.id, status: body.status })
  } catch (e) {
    console.error('[key-card-mark]', e)
    return jsonResponse(500, { error: 'Could not update the card' })
  }
}
