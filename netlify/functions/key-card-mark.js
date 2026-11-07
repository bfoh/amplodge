import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js'
import { serviceClient, logActivity, parseBody, UUID } from './_lib/key-cards.js'

/**
 * Staff record what happened to a card that the bridge cannot see:
 *   returned        the card is back at reception
 *   not_returned    the guest left with it (it opens the door until it expires,
 *                   or until the next stay's card opens the door)
 *   killed_at_door  cancelled at the door with the lock software's own card
 *   issued          only for a card whose writing was cut off ('unknown'): it
 *                   was read at the encoder and is as it should be
 *
 * A card replaced after a loss, or locked out at the door, can only be marked
 * returned (it was found). So can a lock-out card: it belongs to no stay.
 *
 * POST { cardId, status, note? }   (staff)
 */
const MARKS = ['returned', 'not_returned', 'killed_at_door', 'issued']
const FROM = ['issued', 'unknown', 'returned', 'not_returned', 'replaced', 'locked_out']
const RETURN_ONLY = ['replaced', 'locked_out']

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

    const note = body.note ? String(body.note).slice(0, 300) : null
    const { error } = await sb.from('key_cards').update({
      status: body.status,
      note,
      updated_by: ctx.staff?.id ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', card.id)
    if (error) throw error
    await logActivity(sb, {
      action: `key_card_${body.status}`,
      entityId: card.id,
      userId: ctx.user?.id,
      details: { bookingId: card.booking_id, room: card.room_number, guest: card.guest_name, from: card.status, note },
    })
    return jsonResponse(200, { id: card.id, status: body.status })
  } catch (e) {
    console.error('[key-card-mark]', e)
    return jsonResponse(500, { error: 'Could not update the card' })
  }
}
