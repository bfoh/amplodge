/** In-page anchors shared by the film, the room journey and the booking interface. */

/** The room journey that follows the arrival film. */
export const ROOMS_ANCHOR = 'the-rooms'
/** The room-selection and booking interface the journey hands over to. */
export const BOOKING_ANCHOR = 'choose-your-stay'
/** One room's moment in the room journey. */
export const roomAnchor = (slug: string) => `stay-${slug}`
