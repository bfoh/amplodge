/**
 * Canonical room availability computation — single implementation replacing
 * the four near-duplicate `isOverlap`/`getAvailableRoomCount` copies that had
 * drifted apart across OnsiteBookingPage, BookingPage, BookingsPage, and
 * CalendarPage.
 *
 * Two things this version gets right that not all the old copies did:
 *  - Dates are normalized to `yyyy-MM-dd` strings before comparing, so a
 *    stray time-of-day/timezone component in a stored ISO string can't shift
 *    the overlap result by a day (BookingsPage/CalendarPage compared raw
 *    `Date.getTime()` without day-boundary normalization).
 *  - Bookings are matched to rooms by `roomId` (a stable DB foreign key),
 *    never by comparing `roomNumber` strings across two different tables —
 *    two independently-blank room numbers used to false-match as "the same
 *    room."
 */

import { format } from 'date-fns'

export type RoomAvailabilityStatus = 'available' | 'booked' | 'maintenance'

export interface RoomAvailability {
  property: any
  status: RoomAvailabilityStatus
  conflictingBooking?: any
}

export interface RoomTypeAvailabilitySummary {
  roomTypeId: string
  total: number
  available: number
  booked: number
  maintenance: number
}

/** Bookings in these statuses occupy a room; cancelled/checked-out never block. */
const ACTIVE_STATUSES = new Set(['reserved', 'confirmed', 'checked-in'])

function toDateKey(d: string | Date | undefined | null): string {
  if (!d) return ''
  if (typeof d === 'string') return d.split('T')[0]
  if (d instanceof Date && !isNaN(d.getTime())) return format(d, 'yyyy-MM-dd')
  return ''
}

/** Half-open interval overlap: [startA, endA) intersects [startB, endB). */
export function isDateRangeOverlap(
  startA: string | Date | undefined,
  endA: string | Date | undefined,
  startB: string | Date | undefined,
  endB: string | Date | undefined
): boolean {
  const s1 = toDateKey(startA)
  const e1 = toDateKey(endA)
  const s2 = toDateKey(startB)
  const e2 = toDateKey(endB)
  if (!s1 || !e1 || !s2 || !e2) return false
  return s1 < e2 && s2 < e1
}

function resolveRoomTypeId(property: any): string {
  return property.propertyTypeId || property.property_type_id || property.roomTypeId || ''
}

export interface GetRoomAvailabilityOptions {
  /** Only include rooms of this room type. Omit to return every room. */
  roomTypeId?: string
  checkIn?: Date | string
  checkOut?: Date | string
  /** Exclude a specific booking from the conflict check (e.g. editing that booking's own dates). */
  excludeBookingId?: string
  /** Rooms already picked in an in-progress cart, held as unavailable to prevent double-adding. */
  cartHolds?: Array<{ propertyId: string; checkIn: Date | string; checkOut: Date | string }>
}

/**
 * Per-room-instance availability for a date range — not an aggregate count.
 * `properties` should be the full canonical room list (from `db.properties`);
 * `bookings` should carry `roomId`/`checkIn`/`checkOut`/`status` (raw DB rows
 * or `LocalBooking`-shaped objects with `dates.checkIn`/`dates.checkOut` are
 * both accepted).
 */
export function getRoomAvailability(
  properties: any[],
  bookings: any[],
  opts: GetRoomAvailabilityOptions = {}
): RoomAvailability[] {
  const { roomTypeId, checkIn, checkOut, excludeBookingId, cartHolds = [] } = opts

  const scoped = roomTypeId
    ? properties.filter((p) => resolveRoomTypeId(p) === roomTypeId)
    : properties

  return scoped.map((property): RoomAvailability => {
    if (property.status === 'maintenance') {
      return { property, status: 'maintenance' }
    }

    if (!checkIn || !checkOut) {
      // No date range selected yet — nothing to check against, so the room
      // is browsable/selectable (dates are required before it can actually
      // be added to a cart).
      return { property, status: 'available' }
    }

    const conflict = bookings.find((b) => {
      const bookingId = b.id || b.remoteId || b._id
      if (excludeBookingId && bookingId === excludeBookingId) return false
      if (!ACTIVE_STATUSES.has(b.status)) return false
      const roomId = b.roomId || b.room_id
      if (roomId !== property.id) return false
      const bCheckIn = b.checkIn || b.check_in || b.dates?.checkIn
      const bCheckOut = b.checkOut || b.check_out || b.dates?.checkOut
      // A room's checkout day is a normal turnover day — a new booking
      // starting the same day the current guest checks out is allowed,
      // regardless of whether that checkout has been processed yet.
      return isDateRangeOverlap(checkIn, checkOut, bCheckIn, bCheckOut)
    })

    if (conflict) {
      return { property, status: 'booked', conflictingBooking: conflict }
    }

    const heldInCart = cartHolds.some(
      (h) => h.propertyId === property.id && isDateRangeOverlap(checkIn, checkOut, h.checkIn, h.checkOut)
    )
    if (heldInCart) {
      return { property, status: 'booked' }
    }

    return { property, status: 'available' }
  })
}

/** Roll a per-room availability list up into per-room-type counts. */
export function summarizeByRoomType(availability: RoomAvailability[]): RoomTypeAvailabilitySummary[] {
  const byType = new Map<string, RoomTypeAvailabilitySummary>()
  for (const a of availability) {
    const roomTypeId = resolveRoomTypeId(a.property)
    let entry = byType.get(roomTypeId)
    if (!entry) {
      entry = { roomTypeId, total: 0, available: 0, booked: 0, maintenance: 0 }
      byType.set(roomTypeId, entry)
    }
    entry.total += 1
    entry[a.status] += 1
  }
  return [...byType.values()]
}
