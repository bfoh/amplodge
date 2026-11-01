import { scrollToY } from '../motion/scroll-control'

/** In-page anchors shared by the film, the room journey and the booking interface. */

/** The room journey that follows the arrival film. */
export const ROOMS_ANCHOR = 'the-rooms'
/** The room-selection and booking interface the journey hands over to. */
export const BOOKING_ANCHOR = 'choose-your-stay'
/** One room's moment in the room journey. */
export const roomAnchor = (slug: string) => `stay-${slug}`

const pageTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY

/**
 * Scrolls to the start of the room journey: the first room card resting
 * under the room bar, the arrival film just behind it.
 */
export function scrollToRooms() {
  const el = document.getElementById(ROOMS_ANCHOR)
  if (el) scrollToY(pageTop(el))
}

/**
 * Scrolls to one room in the journey, where its card has just come to rest
 * on the deck. A card's anchor is its stretch of scroll (data-room-zone): it
 * rests at the card's sticky offset. Without motion the card itself is the
 * anchor, and its scroll margin clears the header and the room bar.
 */
export function scrollToRoom(slug: string) {
  const anchor = document.getElementById(roomAnchor(slug))
  if (!anchor) {
    scrollToRooms()
    return
  }
  const card = document.querySelector<HTMLElement>(`[data-card][data-slug="${CSS.escape(slug)}"]`)
  const style = card ? getComputedStyle(card) : null
  const offset = style?.position === 'sticky' ? parseFloat(style.top) || 0 : parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0
  scrollToY(Math.max(0, pageTop(anchor) - offset + 1))
}
