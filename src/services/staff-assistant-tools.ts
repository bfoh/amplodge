/**
 * Client-side tool executor for the staff AI assistant.
 *
 * The Netlify function (staff-assistant.js) only ever PROPOSES a tool call —
 * it never executes anything. Execution happens here, in the browser, using
 * the staff member's own authenticated Supabase session, calling exactly the
 * same services the rest of the staff portal already uses (booking-engine,
 * stay-extension-service, booking-groups, booking-charges-service). This
 * means RLS + rbac.ts are the real security boundary, same as everywhere
 * else in the app — nothing new is trusted here.
 *
 * checkInGuest / checkOutGuest are the two exceptions: useCheckIn/useCheckOut
 * are React hooks and can't be called from a plain module function, so this
 * file only exports *resolvers* for those two (resolveCheckInTarget /
 * resolveCheckOutTarget) — the ActionCard component calls the hooks directly
 * with the resolved {booking, room, guest} data.
 */
import { differenceInCalendarDays, parseISO, format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, subDays } from 'date-fns'
import { db } from '@/lib/db'
import { bookingEngine } from '@/services/booking-engine'
import { stayExtensionService } from '@/services/stay-extension-service'
import { bookingChargesService } from '@/services/booking-charges-service'
import {
  createBookingGroup,
  addGroupMember,
  removeGroupMember,
  cancelGroup as cancelGroupService,
  getGroupMembers,
} from '@/lib/booking-groups'
import { getRoomAvailability, summarizeByRoomType } from '@/lib/availability'
import { buildBookingPaymentEvent, appendPaymentEvent, parsePaymentEvents, formatMethodsLabel } from '@/lib/payment-events'
import { fetchBookingsForStaffWeek, calculateStaffWeekResultInternal, type StaffRevenueSharedData } from '@/services/revenue-service'
import { standaloneSalesService } from '@/services/standalone-sales-service'
import { analyticsService } from '@/services/analytics-service'
import { activityLogService } from '@/services/activity-log-service'
import type { ChargeCategory } from '@/types'

/**
 * `id`/`name` are the auth user id — used for bookings.createdBy/checkInBy/etc,
 * which all reference auth.users.id. `staffId` is the `staff` table's own row
 * id — a DIFFERENT uuid, required specifically for booking_charges.created_by
 * (FK'd to staff.id, not auth.users.id — see 20251222_create_booking_charges.sql).
 * Passing the wrong one for charges violates the FK; this mismatch already
 * exists in stay-extension-service.ts's callers (ExtendStayDialog passes
 * user.id, not staff.id), so extendStay's charge-attribution has the same
 * latent bug — out of scope to fix there, but this module uses staffId
 * correctly for its own addCharge/applyDiscount/extendStay calls.
 */
export interface StaffCtx {
  id?: string
  name?: string
  staffId?: string
}

export type ToolResult =
  | { ok: true; data?: any; humanSummary: string }
  | { ok: false; error: string }
  | { ok: false; disambiguation: { question: string; options: Array<{ id: string; label: string }> } }

// ---------------------------------------------------------------------------
// Permission map — which {resource, action} (per src/lib/rbac.ts) a tool
// requires. Covers BOTH write tools (gate before showing the confirmation
// card) and admin/manager-only read tools (gate before executing at all —
// no card needed, but staff must still be blocked from seeing hotel-wide/
// other-staff figures). Tools with no entry here need no permission — either
// a write tool ungated by design, or a read-only tool anyone can run (RLS is
// still the real boundary underneath either way).
// ---------------------------------------------------------------------------

export const TOOL_PERMISSIONS: Record<string, { resource: string; action: 'create' | 'read' | 'update' | 'delete' }> = {
  createBooking: { resource: 'bookings', action: 'create' },
  checkInGuest: { resource: 'bookings', action: 'update' },
  checkOutGuest: { resource: 'bookings', action: 'update' },
  extendStay: { resource: 'bookings', action: 'update' },
  createGroupBooking: { resource: 'bookings', action: 'create' },
  addRoomToGroup: { resource: 'bookings', action: 'create' },
  removeRoomFromGroup: { resource: 'bookings', action: 'delete' },
  cancelGroup: { resource: 'bookings', action: 'delete' },
  cancelBooking: { resource: 'bookings', action: 'delete' },
  addCharge: { resource: 'bookings', action: 'update' },
  applyDiscount: { resource: 'bookings', action: 'update' },
  // Read-only, but scoped to admin/manager — hotel-wide or other-staff figures.
  getStaffRevenue: { resource: 'analytics', action: 'read' },
  getAllStaffRevenue: { resource: 'analytics', action: 'read' },
  getHotelRevenue: { resource: 'analytics', action: 'read' },
  getHotelStats: { resource: 'analytics', action: 'read' },
  getActivitySummary: { resource: 'analytics', action: 'read' },
  listBookings: { resource: 'analytics', action: 'read' },
}

export const READ_ONLY_TOOLS = new Set([
  'checkAvailability', 'lookupGuest', 'getBookingStatus', 'getTodaysArrivals', 'getTodaysDepartures',
  'getMyRevenue', 'getRoomStatusOverview',
  'getStaffRevenue', 'getAllStaffRevenue', 'getHotelRevenue', 'getHotelStats', 'getActivitySummary', 'listBookings',
])
export const WRITE_TOOLS = new Set([
  'createBooking', 'checkInGuest', 'checkOutGuest', 'extendStay', 'createGroupBooking',
  'addRoomToGroup', 'removeRoomFromGroup', 'cancelGroup', 'cancelBooking', 'addCharge', 'applyDiscount',
])
// These two must be executed via their React hook (useCheckIn/useCheckOut) by
// the component, not via executeTool() below.
export const HOOK_EXECUTED_TOOLS = new Set(['checkInGuest', 'checkOutGuest'])

const ACTIVE_STATUSES = new Set(['reserved', 'confirmed', 'checked-in'])

// ---------------------------------------------------------------------------
// Shared context loading + entity resolution
// ---------------------------------------------------------------------------

async function loadContext() {
  const [bookings, guests, properties, roomTypes] = await Promise.all([
    db.bookings.listAll({ orderBy: { createdAt: 'desc' } }),
    db.guests.listAll(),
    db.properties.listAll(),
    db.roomTypes.list({ limit: 200 }),
  ])
  const guestMap = new Map(guests.map((g: any) => [g.id, g]))
  const propertyMap = new Map(properties.map((p: any) => [p.id, p]))
  const roomTypeMap = new Map(roomTypes.map((rt: any) => [rt.id, rt]))
  return { bookings, guests, properties, roomTypes, guestMap, propertyMap, roomTypeMap }
}

function candidateLabel(booking: any, guest: any, room: any): string {
  const name = guest?.name || 'Unknown guest'
  const roomNumber = room?.roomNumber || '?'
  return `${name} — Room ${roomNumber} (${booking.checkIn} → ${booking.checkOut}, ${booking.status})`
}

/**
 * Resolve a staff member's free-text reference ("John Doe", "105", a booking
 * id) to exactly one booking. Matches by exact room number first (most
 * unambiguous), then by guest name substring. Returns a disambiguation
 * result when more than one active booking matches.
 */
async function resolveGuestBooking(
  query: string,
  statusFilter: string[] = Array.from(ACTIVE_STATUSES)
): Promise<{ booking: any; guest: any; room: any } | ToolResult> {
  const q = (query || '').trim().toLowerCase()
  if (!q) return { ok: false, error: 'No guest or room reference was given.' }

  const { bookings, guestMap, propertyMap } = await loadContext()
  const inScope = bookings.filter((b: any) => statusFilter.includes(b.status))

  // 1. Exact booking id
  const byId = inScope.find((b: any) => b.id === query)
  if (byId) {
    return { booking: byId, guest: guestMap.get(byId.guestId), room: propertyMap.get(byId.roomId) }
  }

  // 2. Exact room number match
  const roomMatches = inScope.filter((b: any) => {
    const room = propertyMap.get(b.roomId)
    return room?.roomNumber && String(room.roomNumber).toLowerCase() === q
  })
  if (roomMatches.length === 1) {
    const b = roomMatches[0]
    return { booking: b, guest: guestMap.get(b.guestId), room: propertyMap.get(b.roomId) }
  }
  if (roomMatches.length > 1) {
    return {
      ok: false,
      disambiguation: {
        question: `Room ${query} has more than one matching booking. Which one did you mean?`,
        options: roomMatches.map((b: any) => ({ id: b.id, label: candidateLabel(b, guestMap.get(b.guestId), propertyMap.get(b.roomId)) })),
      },
    }
  }

  // 3. Guest name substring match
  const nameMatches = inScope.filter((b: any) => {
    const guest = guestMap.get(b.guestId)
    return guest?.name && String(guest.name).toLowerCase().includes(q)
  })
  if (nameMatches.length === 1) {
    const b = nameMatches[0]
    return { booking: b, guest: guestMap.get(b.guestId), room: propertyMap.get(b.roomId) }
  }
  if (nameMatches.length > 1) {
    return {
      ok: false,
      disambiguation: {
        question: `More than one active booking matches "${query}". Which one did you mean?`,
        options: nameMatches.map((b: any) => ({ id: b.id, label: candidateLabel(b, guestMap.get(b.guestId), propertyMap.get(b.roomId)) })),
      },
    }
  }

  return { ok: false, error: `No active booking found matching "${query}". Try a room number or the guest's exact name.` }
}

/** Resolve a room-number-or-type reference to one available property for the given dates. */
async function resolveRoom(
  query: string,
  checkIn: string,
  checkOut: string
): Promise<{ property: any; roomTypeName: string } | ToolResult> {
  const q = (query || '').trim().toLowerCase()
  if (!q) return { ok: false, error: 'No room was specified.' }

  const { bookings, properties, roomTypeMap } = await loadContext()

  // Exact room number
  const exact = properties.find((p: any) => p.roomNumber && String(p.roomNumber).toLowerCase() === q)
  if (exact) {
    const roomTypeName = roomTypeMap.get(exact.roomTypeId || exact.propertyTypeId)?.name || 'Standard Room'
    const [avail] = getRoomAvailability([exact], bookings, { checkIn, checkOut })
    if (avail.status !== 'available') {
      return { ok: false, error: `Room ${exact.roomNumber} is not available for ${checkIn} to ${checkOut}.` }
    }
    return { property: exact, roomTypeName }
  }

  // Room type name fuzzy match
  const matchingType = [...roomTypeMap.values()].find((rt: any) => String(rt.name || '').toLowerCase().includes(q))
  if (matchingType) {
    const availability = getRoomAvailability(properties, bookings, { roomTypeId: matchingType.id, checkIn, checkOut })
    const available = availability.find((a) => a.status === 'available')
    if (!available) {
      return { ok: false, error: `No "${matchingType.name}" rooms are available for ${checkIn} to ${checkOut}.` }
    }
    return { property: available.property, roomTypeName: matchingType.name }
  }

  return { ok: false, error: `Couldn't find a room matching "${query}". Try an exact room number or a room type name.` }
}

async function resolveGroupId(groupReference: string): Promise<string | ToolResult> {
  try {
    const rows = await db.bookingGroups.list({ where: { groupReference } })
    if (rows[0]?.id) return rows[0].id
  } catch {
    // booking_groups table/migration may not be present — fall through to legacy scan
  }
  const { bookings } = await loadContext()
  const match = bookings.find((b: any) => b.groupReference === groupReference)
  if (match?.groupId) return match.groupId
  return { ok: false, error: `No group booking found with reference "${groupReference}".` }
}

function nights(checkIn: string, checkOut: string): number {
  try {
    return Math.max(1, differenceInCalendarDays(parseISO(checkOut), parseISO(checkIn)))
  } catch {
    return 1
  }
}

function normalizeCategory(raw?: string): ChargeCategory {
  const valid: ChargeCategory[] = ['food_beverage', 'room_service', 'minibar', 'laundry', 'phone_internet', 'parking', 'room_extension', 'other']
  const s = (raw || '').toLowerCase().replace(/\s+/g, '_')
  return (valid.find((c) => c === s) as ChargeCategory) || 'other'
}

export type ReportPeriod = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear'

/** Resolve a named period to concrete Date + 'yyyy-MM-dd' string bounds, shared by every revenue/stats tool. */
function resolvePeriod(period?: string): { from: Date; to: Date; start: string; end: string; label: string } {
  const now = new Date()
  const mk = (from: Date, to: Date, label: string) => ({
    from, to, start: format(from, 'yyyy-MM-dd'), end: format(to, 'yyyy-MM-dd'), label,
  })
  switch (period) {
    case 'yesterday': { const d = subDays(now, 1); return mk(startOfDay(d), endOfDay(d), 'yesterday') }
    case 'lastWeek': { const d = subDays(now, 7); return mk(startOfWeek(d, { weekStartsOn: 1 }), endOfWeek(d, { weekStartsOn: 1 }), 'last week') }
    case 'lastMonth': { const d = subMonths(now, 1); return mk(startOfMonth(d), endOfMonth(d), 'last month') }
    case 'thisYear': return mk(startOfYear(now), endOfYear(now), 'this year')
    case 'thisMonth': return mk(startOfMonth(now), endOfMonth(now), 'this month')
    case 'thisWeek': return mk(startOfWeek(now, { weekStartsOn: 1 }), endOfWeek(now, { weekStartsOn: 1 }), 'this week')
    case 'today':
    default: return mk(startOfDay(now), endOfDay(now), 'today')
  }
}

// ---------------------------------------------------------------------------
// checkInGuest / checkOutGuest resolvers (hook-executed by ActionCard)
// ---------------------------------------------------------------------------

export async function resolveCheckInTarget(args: any): Promise<
  | { booking: any; room: any; guest: any; paymentMethod: string; checkInAmount: number; discountAmount?: number; discountReason?: string }
  | ToolResult
> {
  const resolved = await resolveGuestBooking(args.guestNameOrBookingRef, ['confirmed', 'reserved'])
  if ('ok' in resolved) return resolved
  const { booking, guest, room } = resolved
  if (booking.status === 'checked-in') {
    return { ok: false, error: `${guest?.name || 'This guest'} is already checked in.` }
  }
  return {
    booking,
    room,
    guest,
    paymentMethod: args.paymentMethod || 'cash',
    checkInAmount: Number(args.amountCollected) || 0,
    discountAmount: args.discountAmount ? Number(args.discountAmount) : undefined,
    discountReason: args.discountReason,
  }
}

export async function resolveCheckOutTarget(args: any): Promise<
  { booking: any; room: any; guest: any; roomTypeName?: string } | ToolResult
> {
  const resolved = await resolveGuestBooking(args.guestNameOrBookingRef, ['checked-in'])
  if ('ok' in resolved) return resolved
  const { booking, guest, room } = resolved
  const { roomTypeMap } = await loadContext()
  const roomTypeName = room ? roomTypeMap.get(room.roomTypeId)?.name : undefined
  return { booking, room, guest, roomTypeName }
}

// ---------------------------------------------------------------------------
// Read-only tools
// ---------------------------------------------------------------------------

async function toolCheckAvailability(args: any): Promise<ToolResult> {
  const { checkIn, checkOut, roomTypeName, guests } = args
  const { bookings, properties, roomTypeMap } = await loadContext()

  let roomTypeId: string | undefined
  if (roomTypeName) {
    const match = [...roomTypeMap.values()].find((rt: any) => String(rt.name || '').toLowerCase().includes(String(roomTypeName).toLowerCase()))
    if (!match) return { ok: false, error: `No room type matching "${roomTypeName}".` }
    roomTypeId = match.id
  }

  const availability = getRoomAvailability(properties, bookings, { roomTypeId, checkIn, checkOut })
  const summary = summarizeByRoomType(availability)
  const available = availability.filter((a) => a.status === 'available')

  const lines = summary
    .filter((s) => s.available > 0)
    .map((s) => `${roomTypeMap.get(s.roomTypeId)?.name || 'Rooms'}: ${s.available} available`)
  const humanSummary = lines.length > 0
    ? `${checkIn} → ${checkOut}: ${lines.join(', ')}`
    : `No rooms available for ${checkIn} → ${checkOut}${roomTypeName ? ` (${roomTypeName})` : ''}.`

  return {
    ok: true,
    humanSummary,
    data: available.map((a) => ({
      roomNumber: a.property.roomNumber,
      roomType: roomTypeMap.get(a.property.roomTypeId || a.property.propertyTypeId)?.name,
    })),
  }
}

async function toolLookupGuest(args: any): Promise<ToolResult> {
  const q = String(args.query || '').trim().toLowerCase()
  if (!q) return { ok: false, error: 'No search query given.' }
  const { guests, bookings } = await loadContext()
  const matches = guests.filter((g: any) =>
    String(g.name || '').toLowerCase().includes(q) ||
    String(g.email || '').toLowerCase().includes(q) ||
    String(g.phone || '').toLowerCase().includes(q)
  ).slice(0, 10)

  if (matches.length === 0) return { ok: false, error: `No guest found matching "${args.query}".` }

  // Compute revenue/stay count live from bookings (matches GuestsPage's approach)
  // rather than trusting guests.totalRevenue/totalStays, which can go stale.
  const enriched = matches.map((g: any) => {
    const guestBookings = (bookings as any[]).filter((b: any) => b.guestId === g.id && b.status !== 'cancelled')
    const totalRevenue = guestBookings.reduce((s, b) => s + Number(b.totalPrice || 0), 0)
    return { id: g.id, name: g.name, email: g.email, phone: g.phone, totalRevenue, totalStays: guestBookings.length }
  })

  return {
    ok: true,
    humanSummary: enriched.map((g) => `${g.name} (${g.email || g.phone || 'no contact info'}) — ${g.totalStays} stay(s), GH₵${g.totalRevenue.toFixed(2)} lifetime`).join('; '),
    data: enriched,
  }
}

async function toolGetBookingStatus(args: any): Promise<ToolResult> {
  const resolved = await resolveGuestBooking(args.query, ['reserved', 'confirmed', 'checked-in', 'checked-out', 'cancelled'])
  if ('ok' in resolved) return resolved
  const { booking, guest, room } = resolved
  const methods = formatMethodsLabel(parsePaymentEvents(booking.specialRequests || booking.special_requests || ''))
  const humanSummary = `${guest?.name || 'Guest'} — Room ${room?.roomNumber || '?'}, ${booking.checkIn} → ${booking.checkOut}, status: ${booking.status}${methods ? `, paid via ${methods}` : ''}.`
  return { ok: true, humanSummary, data: { id: booking.id, status: booking.status, checkIn: booking.checkIn, checkOut: booking.checkOut, totalPrice: booking.totalPrice, paymentMethods: methods } }
}

async function toolGetTodaysArrivals(): Promise<ToolResult> {
  const today = new Date().toISOString().split('T')[0]
  const { bookings, guestMap, propertyMap } = await loadContext()
  const arrivals = bookings.filter((b: any) => b.checkIn?.split('T')[0] === today && ['confirmed', 'reserved'].includes(b.status))
  if (arrivals.length === 0) return { ok: true, humanSummary: 'No arrivals scheduled for today.', data: [] }
  return {
    ok: true,
    humanSummary: arrivals.map((b: any) => `${guestMap.get(b.guestId)?.name || 'Guest'} — Room ${propertyMap.get(b.roomId)?.roomNumber || '?'}`).join('; '),
    data: arrivals.map((b: any) => ({ id: b.id, guestName: guestMap.get(b.guestId)?.name, roomNumber: propertyMap.get(b.roomId)?.roomNumber })),
  }
}

async function toolGetTodaysDepartures(): Promise<ToolResult> {
  const today = new Date().toISOString().split('T')[0]
  const { bookings, guestMap, propertyMap } = await loadContext()
  const departures = bookings.filter((b: any) => b.checkOut?.split('T')[0] === today && b.status === 'checked-in')
  if (departures.length === 0) return { ok: true, humanSummary: 'No departures scheduled for today.', data: [] }
  return {
    ok: true,
    humanSummary: departures.map((b: any) => `${guestMap.get(b.guestId)?.name || 'Guest'} — Room ${propertyMap.get(b.roomId)?.roomNumber || '?'}`).join('; '),
    data: departures.map((b: any) => ({ id: b.id, guestName: guestMap.get(b.guestId)?.name, roomNumber: propertyMap.get(b.roomId)?.roomNumber })),
  }
}

// ---------------------------------------------------------------------------
// Write tools (plain functions — everything except check-in/check-out)
// ---------------------------------------------------------------------------

/**
 * Guest email is required to create a booking — it's how the confirmation
 * email and, later, the checkout invoice reach the guest. Matches the exact
 * bar BookingsPage.tsx's own form already enforces ("Guest name and email
 * are required"). Without this check the model can (and did, in practice)
 * skip straight to booking without ever asking, and createBooking silently
 * falls back to a fallback-<uuid>@guest.local placeholder that can never
 * receive anything.
 */
function requireGuestEmail(email: string | undefined): ToolResult | null {
  if (!email || !email.trim()) {
    return { ok: false, error: "I still need the guest's email address before I can book this — please ask the staff member for it (a phone number too, if they have one)." }
  }
  return null
}

async function toolCreateBooking(args: any, staffCtx: StaffCtx): Promise<ToolResult> {
  const emailError = requireGuestEmail(args.guestEmail)
  if (emailError) return emailError

  const roomResult = await resolveRoom(args.roomNumberOrType, args.checkIn, args.checkOut)
  if ('ok' in roomResult) return roomResult
  const { property, roomTypeName } = roomResult

  const n = nights(args.checkIn, args.checkOut)
  const pricePerNight = property.basePrice || property.price || 0
  const amount = n * pricePerNight
  const amountCollected = Number(args.amountCollected) || 0
  const paymentStatus: 'full' | 'part' | 'pending' = amountCollected <= 0 ? 'pending' : amountCollected >= amount ? 'full' : 'part'

  const bookingEvent = paymentStatus !== 'pending' && args.paymentMethod
    ? buildBookingPaymentEvent({
      paymentType: paymentStatus === 'full' ? 'full' : 'part',
      amount: amountCollected,
      staffId: staffCtx.id || '',
      staffName: staffCtx.name || 'Staff',
      method: args.paymentMethod,
    })
    : null

  try {
    const created = await bookingEngine.createBooking({
      guest: { fullName: args.guestName, email: args.guestEmail || '', phone: args.guestPhone || '', address: '' },
      roomType: roomTypeName,
      roomNumber: property.roomNumber,
      dates: { checkIn: args.checkIn, checkOut: args.checkOut },
      numGuests: Number(args.guests) || 1,
      amount,
      status: 'confirmed',
      source: 'reception',
      paymentMethod: paymentStatus !== 'pending' ? args.paymentMethod : undefined,
      amountPaid: amountCollected,
      paymentStatus,
      specialRequests: bookingEvent ? appendPaymentEvent('', bookingEvent) : undefined,
      createdBy: staffCtx.id,
      createdByName: staffCtx.name,
    } as any)

    return {
      ok: true,
      humanSummary: `Booked Room ${property.roomNumber} for ${args.guestName}, ${args.checkIn} → ${args.checkOut} (GH₵${amount}).`,
      data: { id: created.remoteId || created._id },
    }
  } catch (err: any) {
    if (err?.code === '23P01' || String(err?.message || '').includes('not available')) {
      return { ok: false, error: `Room ${property.roomNumber} was just booked by someone else. Try another room.` }
    }
    return { ok: false, error: err?.message || 'Failed to create booking.' }
  }
}

async function toolExtendStay(args: any, staffCtx: StaffCtx): Promise<ToolResult> {
  const resolved = await resolveGuestBooking(args.guestNameOrBookingRef, ['checked-in'])
  if ('ok' in resolved) return resolved
  const { booking, guest } = resolved

  let newRoomId: string | undefined
  if (args.newRoomNumber) {
    const roomResult = await resolveRoom(args.newRoomNumber, booking.checkOut, args.newCheckoutDate)
    if ('ok' in roomResult) return roomResult
    newRoomId = roomResult.property.id
  }

  const result = await stayExtensionService.extendStay(
    booking.id,
    args.newCheckoutDate,
    newRoomId,
    staffCtx.staffId, // booking_charges.created_by FKs to staff.id, not auth user id
    args.discountAmount ? Number(args.discountAmount) : undefined,
    args.discountReason,
  )

  if (!result.success) return { ok: false, error: result.error || 'Failed to extend stay.' }
  return {
    ok: true,
    humanSummary: `Extended ${guest?.name || 'guest'}'s stay to ${args.newCheckoutDate} (additional GH₵${result.extensionCost}).`,
    data: result,
  }
}

async function toolCreateGroupBooking(args: any, staffCtx: StaffCtx): Promise<ToolResult> {
  const billingEmailError = requireGuestEmail(args.billingContactEmail)
  if (billingEmailError) return billingEmailError

  const rooms: any[] = []
  for (const r of args.rooms || []) {
    const roomEmailError = requireGuestEmail(r.guestEmail)
    if (roomEmailError) return roomEmailError

    const roomResult = await resolveRoom(r.roomNumberOrType, r.checkIn, r.checkOut)
    if ('ok' in roomResult) return roomResult
    const n = nights(r.checkIn, r.checkOut)
    const amount = n * (roomResult.property.basePrice || roomResult.property.price || 0)
    rooms.push({
      bookingData: {
        guest: { fullName: r.guestName, email: r.guestEmail, phone: r.guestPhone || '', address: '' },
        roomType: roomResult.roomTypeName,
        roomNumber: roomResult.property.roomNumber,
        dates: { checkIn: r.checkIn, checkOut: r.checkOut },
        numGuests: Number(r.guests) || 1,
        amount,
        status: 'confirmed',
        source: 'reception',
        paymentStatus: 'pending',
        createdBy: staffCtx.id,
        createdByName: staffCtx.name,
      },
    })
  }

  try {
    const created = await createBookingGroup(rooms, {
      fullName: args.billingContactName,
      email: args.billingContactEmail,
      phone: args.billingContactPhone || '',
      address: '',
    })
    return {
      ok: true,
      humanSummary: `Created a group booking with ${created.length} room(s) for ${args.billingContactName}.`,
      data: { count: created.length },
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to create group booking.' }
  }
}

async function toolAddRoomToGroup(args: any, staffCtx: StaffCtx): Promise<ToolResult> {
  const emailError = requireGuestEmail(args.guestEmail)
  if (emailError) return emailError

  const groupId = await resolveGroupId(args.groupReference)
  if (typeof groupId !== 'string') return groupId
  const roomResult = await resolveRoom(args.roomNumberOrType, args.checkIn, args.checkOut)
  if ('ok' in roomResult) return roomResult
  const n = nights(args.checkIn, args.checkOut)
  const amount = n * (roomResult.property.basePrice || roomResult.property.price || 0)

  try {
    await addGroupMember(groupId, {
      guest: { fullName: args.guestName, email: args.guestEmail, phone: args.guestPhone || '', address: '' },
      roomType: roomResult.roomTypeName,
      roomNumber: roomResult.property.roomNumber,
      dates: { checkIn: args.checkIn, checkOut: args.checkOut },
      numGuests: Number(args.guests) || 1,
      amount,
      status: 'confirmed',
      source: 'reception',
      paymentStatus: 'pending',
      createdBy: staffCtx.id,
      createdByName: staffCtx.name,
    } as any)
    return { ok: true, humanSummary: `Added Room ${roomResult.property.roomNumber} for ${args.guestName} to group ${args.groupReference}.` }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to add room to group.' }
  }
}

async function toolRemoveRoomFromGroup(args: any): Promise<ToolResult> {
  const groupId = await resolveGroupId(args.groupReference)
  if (typeof groupId !== 'string') return groupId
  const members = await getGroupMembers(groupId)
  const { guestMap, propertyMap } = await loadContext()
  const q = String(args.roomNumberOrGuestName || '').toLowerCase()
  const target = members.find((m: any) => {
    const room = propertyMap.get(m.roomId)
    const guest = guestMap.get(m.guestId)
    return (room?.roomNumber && String(room.roomNumber).toLowerCase() === q) ||
      (guest?.name && String(guest.name).toLowerCase().includes(q))
  })
  if (!target) return { ok: false, error: `Couldn't find "${args.roomNumberOrGuestName}" in group ${args.groupReference}.` }

  try {
    const result = await removeGroupMember(target.id)
    return {
      ok: true,
      humanSummary: result.groupClosed
        ? `Removed the last room — group ${args.groupReference} is now closed.`
        : `Removed the room from group ${args.groupReference}. ${result.remainingCount} room(s) remain.`,
      data: result,
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to remove room from group.' }
  }
}

async function toolCancelGroup(args: any): Promise<ToolResult> {
  const groupId = await resolveGroupId(args.groupReference)
  if (typeof groupId !== 'string') return groupId
  try {
    await cancelGroupService(groupId)
    return { ok: true, humanSummary: `Cancelled group booking ${args.groupReference}.` }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to cancel group.' }
  }
}

async function toolCancelBooking(args: any): Promise<ToolResult> {
  const resolved = await resolveGuestBooking(args.guestNameOrBookingRef, ['reserved', 'confirmed'])
  if ('ok' in resolved) return resolved
  const { booking, guest } = resolved
  try {
    await bookingEngine.updateBookingStatus(booking.id, 'cancelled')
    return { ok: true, humanSummary: `Cancelled ${guest?.name || 'the'} booking.${args.reason ? ` Reason: ${args.reason}` : ''}` }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to cancel booking.' }
  }
}

async function toolAddCharge(args: any, staffCtx: StaffCtx): Promise<ToolResult> {
  const resolved = await resolveGuestBooking(args.guestNameOrBookingRef)
  if ('ok' in resolved) return resolved
  const { booking, guest } = resolved
  try {
    await bookingChargesService.addCharge({
      bookingId: booking.id,
      description: args.description,
      category: normalizeCategory(args.category),
      quantity: 1,
      unitPrice: Number(args.amount),
      createdBy: staffCtx.staffId, // booking_charges.created_by FKs to staff.id, not auth user id
    })
    return { ok: true, humanSummary: `Added a GH₵${args.amount} charge ("${args.description}") to ${guest?.name || 'the guest'}'s bill.` }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to add charge.' }
  }
}

async function toolApplyDiscount(args: any, staffCtx: StaffCtx): Promise<ToolResult> {
  const resolved = await resolveGuestBooking(args.guestNameOrBookingRef)
  if ('ok' in resolved) return resolved
  const { booking, guest } = resolved
  try {
    await bookingChargesService.addCharge({
      bookingId: booking.id,
      description: `Discount${args.reason ? ` — ${args.reason}` : ''}`,
      category: 'other',
      quantity: 1,
      unitPrice: -Math.abs(Number(args.amount)),
      createdBy: staffCtx.staffId, // booking_charges.created_by FKs to staff.id, not auth user id
    })
    return { ok: true, humanSummary: `Applied a GH₵${args.amount} discount to ${guest?.name || 'the guest'}'s bill.` }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to apply discount.' }
  }
}

// ---------------------------------------------------------------------------
// Revenue, stats & reporting tools
// ---------------------------------------------------------------------------

/** One shared fetch reused across every staff member when computing an all-staff breakdown — avoids N redundant full-table fetches. */
async function loadStaffRevenueSharedData(): Promise<StaffRevenueSharedData> {
  const [bookings, properties, guests, chargesRaw, staffRows, standaloneSales] = await Promise.all([
    db.bookings.list({ limit: 5000 }),
    db.properties.list({ limit: 500 }),
    db.guests.list({ limit: 2000 }),
    db.bookingCharges.list({ limit: 5000 }).catch(() => []),
    db.staff.list({ limit: 200 }).catch(() => []),
    standaloneSalesService.getAllSales().catch(() => []),
  ])
  return { bookings, properties, guests, chargesRaw, staffRows, standaloneSales }
}

async function resolveStaff(query: string): Promise<{ id: string; userId?: string; name: string; role: string } | ToolResult> {
  const q = (query || '').trim().toLowerCase()
  if (!q) return { ok: false, error: 'No staff member specified.' }
  const staffRows = await db.staff.list({ limit: 200 })
  const matches = staffRows.filter((s: any) =>
    String(s.name || '').toLowerCase().includes(q) || String(s.email || '').toLowerCase().includes(q)
  )
  if (matches.length === 0) return { ok: false, error: `No staff member found matching "${query}".` }
  if (matches.length > 1) {
    return {
      ok: false,
      disambiguation: {
        question: `More than one staff member matches "${query}". Which one did you mean?`,
        options: matches.map((s: any) => ({ id: s.id, label: `${s.name} (${s.role || 'staff'}) — ${s.email}` })),
      },
    }
  }
  const s = matches[0]
  return { id: s.id, userId: s.userId || s.user_id, name: s.name, role: s.role || 'staff' }
}

/** A staff member's own revenue — self-scoped, no permission gate (staff can always see their own figures). */
async function toolGetMyRevenue(args: any, staffCtx: StaffCtx): Promise<ToolResult> {
  const staffId = staffCtx.id || staffCtx.staffId
  if (!staffId) return { ok: false, error: "Couldn't identify who's asking — please try again." }
  const { start, end, label } = resolvePeriod(args.period)
  const result = await fetchBookingsForStaffWeek(staffId, start, end)
  const extras: string[] = []
  if (result.additionalRevenue > 0) extras.push(`GH₵${result.additionalRevenue.toFixed(2)} in extra charges`)
  if (result.standaloneSalesRevenue > 0) extras.push(`GH₵${result.standaloneSalesRevenue.toFixed(2)} in standalone sales`)
  const humanSummary = `Your revenue for ${label}: GH₵${result.grandRevenue.toFixed(2)} across ${result.bookingCount} booking(s)`
    + (extras.length ? `, plus ${extras.join(' and ')}` : '') + '.'
  return {
    ok: true,
    humanSummary,
    data: { period: label, totalRevenue: result.totalRevenue, additionalRevenue: result.additionalRevenue, standaloneSalesRevenue: result.standaloneSalesRevenue, grandRevenue: result.grandRevenue, bookingCount: result.bookingCount },
  }
}

/** Current room status counts — everyone can see this, it's routine front-desk info. */
async function toolGetRoomStatusOverview(): Promise<ToolResult> {
  const properties = await db.properties.listAll()
  const counts: Record<string, number> = {}
  for (const p of properties as any[]) {
    const status = p.status || 'unknown'
    counts[status] = (counts[status] || 0) + 1
  }
  const humanSummary = `${properties.length} room(s) total: ` + Object.entries(counts).map(([s, c]) => `${c} ${s}`).join(', ') + '.'
  return { ok: true, humanSummary, data: { total: properties.length, byStatus: counts } }
}

/** admin/manager: one named staff member's revenue for a period. */
async function toolGetStaffRevenue(args: any): Promise<ToolResult> {
  const staff = await resolveStaff(args.staffName)
  if ('ok' in staff) return staff
  const { start, end, label } = resolvePeriod(args.period)
  const result = await fetchBookingsForStaffWeek(staff.userId || staff.id, start, end)
  const humanSummary = `${staff.name}'s revenue for ${label}: GH₵${result.grandRevenue.toFixed(2)} across ${result.bookingCount} booking(s).`
  return {
    ok: true,
    humanSummary,
    data: { staffName: staff.name, role: staff.role, period: label, grandRevenue: result.grandRevenue, bookingCount: result.bookingCount, additionalRevenue: result.additionalRevenue, standaloneSalesRevenue: result.standaloneSalesRevenue },
  }
}

/** admin/manager: every staff member's revenue for a period, ranked highest first. */
async function toolGetAllStaffRevenue(args: any): Promise<ToolResult> {
  const { start, end, label } = resolvePeriod(args.period)
  const shared = await loadStaffRevenueSharedData()
  const ranked = (shared.staffRows as any[])
    .map((s: any) => {
      const result = calculateStaffWeekResultInternal(s.userId || s.user_id || s.id, start, end, shared)
      return { name: s.name, role: s.role || 'staff', grandRevenue: result.grandRevenue, bookingCount: result.bookingCount }
    })
    .filter((r) => r.grandRevenue > 0 || r.bookingCount > 0)
    .sort((a, b) => b.grandRevenue - a.grandRevenue)

  const humanSummary = ranked.length > 0
    ? `Staff revenue for ${label}: ` + ranked.map((r) => `${r.name} GH₵${r.grandRevenue.toFixed(2)} (${r.bookingCount})`).join(', ') + '.'
    : `No staff revenue recorded for ${label}.`
  return { ok: true, humanSummary, data: { period: label, staff: ranked } }
}

/** admin/manager: hotel-wide revenue — total, by room type, by payment method, by source, ADR/RevPAR. */
async function toolGetHotelRevenue(args: any): Promise<ToolResult> {
  // revenueByPeriod is always computed from the full booking history (fixed
  // calendar buckets), but revenueByRoomType/ADR/RevPAR/byPaymentMethod/
  // bySource are scoped to whatever startDate/endDate is passed — pass the
  // resolved period's bounds so those breakdowns match periodValue, instead
  // of silently reporting lifetime totals for a "today"/"thisMonth" question.
  const { from, to } = resolvePeriod(args.period)
  const analytics = await analyticsService.getRevenueAnalytics(from, to)
  const periodKey = (args.period || 'today') as keyof typeof analytics.revenueByPeriod
  const periodValue = analytics.revenueByPeriod[periodKey] ?? analytics.revenueByPeriod.today
  const topRoomTypes = [...analytics.revenueByRoomType].sort((a, b) => b.revenue - a.revenue).slice(0, 5)

  const humanSummary = `Hotel revenue for ${String(args.period || 'today')}: GH₵${periodValue.toFixed(2)}. `
    + `ADR GH₵${analytics.averageDailyRate.toFixed(2)}, RevPAR GH₵${analytics.revenuePerAvailableRoom.toFixed(2)}. `
    + (topRoomTypes.length ? `Top room types: ${topRoomTypes.map((t) => `${t.roomTypeName} GH₵${t.revenue.toFixed(2)}`).join(', ')}.` : '')

  return {
    ok: true,
    humanSummary,
    data: {
      periodRevenue: periodValue,
      revenueByPeriod: analytics.revenueByPeriod,
      averageDailyRate: analytics.averageDailyRate,
      revenuePerAvailableRoom: analytics.revenuePerAvailableRoom,
      revenueByRoomType: analytics.revenueByRoomType,
      revenueByPaymentMethod: analytics.revenueByPaymentMethod,
      revenueBySource: analytics.revenueBySource,
    },
  }
}

/** admin/manager: occupancy + performance snapshot, including trend and forecast. */
async function toolGetHotelStats(): Promise<ToolResult> {
  const shared = await analyticsService.prefetchSharedData()
  const [occupancy, performance] = await Promise.all([
    analyticsService.getOccupancyAnalytics(shared),
    analyticsService.getPerformanceMetrics(shared),
  ])

  const humanSummary = `Occupancy: ${occupancy.currentOccupancyRate.toFixed(1)}% (${occupancy.occupiedRooms}/${occupancy.totalRooms} rooms). `
    + `ADR GH₵${performance.adr.toFixed(2)}, RevPAR GH₵${performance.revPAR.toFixed(2)}. `
    + `Avg stay ${occupancy.averageLengthOfStay.toFixed(1)} night(s), avg booking lead time ${occupancy.bookingLeadTime.toFixed(1)} day(s). `
    + `Cancellation rate ${performance.conversionMetrics.cancellationRate.toFixed(1)}%. `
    + `7-day forecast: ${occupancy.forecast.next7Days} booking(s) expected.`

  return {
    ok: true,
    humanSummary,
    data: {
      currentOccupancyRate: occupancy.currentOccupancyRate,
      occupiedRooms: occupancy.occupiedRooms,
      totalRooms: occupancy.totalRooms,
      averageLengthOfStay: occupancy.averageLengthOfStay,
      bookingLeadTime: occupancy.bookingLeadTime,
      forecast: occupancy.forecast,
      adr: performance.adr,
      revPAR: performance.revPAR,
      occupancyRate: performance.occupancyRate,
      cancellationRate: performance.conversionMetrics.cancellationRate,
      roomStatusDistribution: performance.operationalMetrics.roomStatusDistribution,
    },
  }
}

/** admin/manager: activity/history summary for a period — counts by action, plus recent notable entries. */
async function toolGetActivitySummary(args: any): Promise<ToolResult> {
  const { from, to, label } = resolvePeriod(args.period)
  const stats = await activityLogService.getActivityStats(from, to)
  const topActions = Object.entries(stats.byAction)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 6)
    .map(([action, count]) => `${action}: ${count}`)

  const humanSummary = `${stats.totalActivities} activity event(s) logged for ${label}`
    + (topActions.length ? ` — ${topActions.join(', ')}.` : '.')

  return {
    ok: true,
    humanSummary,
    data: {
      period: label,
      totalActivities: stats.totalActivities,
      byAction: stats.byAction,
      recentActivities: stats.recentActivities.slice(0, 10).map((a: any) => ({
        action: a.action, entityType: a.entityType, details: a.details, createdAt: a.createdAt,
      })),
    },
  }
}

/** admin/manager: bookings/reservations in a period, optionally filtered by status. */
async function toolListBookings(args: any): Promise<ToolResult> {
  const { from, to, start, end, label } = resolvePeriod(args.period)
  const { bookings, guestMap, propertyMap } = await loadContext()
  const status = args.status ? String(args.status).toLowerCase() : undefined

  const inRange = (bookings as any[]).filter((b: any) => {
    if (status && b.status !== status) return false
    const created = b.createdAt ? new Date(b.createdAt) : null
    return created && created >= from && created <= to
  })

  const summary = inRange.slice(0, 20).map((b: any) => ({
    guestName: guestMap.get(b.guestId)?.name || 'Guest',
    roomNumber: propertyMap.get(b.roomId)?.roomNumber,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    status: b.status,
    totalPrice: b.totalPrice,
  }))

  const humanSummary = inRange.length > 0
    ? `${inRange.length} booking(s) created ${label}${status ? ` with status "${status}"` : ''}` +
      ` (${start} to ${end}). ${summary.slice(0, 8).map((s) => `${s.guestName} — Room ${s.roomNumber || '?'} (${s.status})`).join('; ')}` +
      (inRange.length > 8 ? `, and ${inRange.length - 8} more.` : '.')
    : `No bookings created ${label}${status ? ` with status "${status}"` : ''}.`

  return { ok: true, humanSummary, data: { period: label, count: inRange.length, bookings: summary } }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const READ_ONLY_EXECUTORS: Record<string, (args: any, staffCtx: StaffCtx) => Promise<ToolResult>> = {
  checkAvailability: toolCheckAvailability,
  lookupGuest: toolLookupGuest,
  getBookingStatus: toolGetBookingStatus,
  getTodaysArrivals: toolGetTodaysArrivals,
  getTodaysDepartures: toolGetTodaysDepartures,
  getMyRevenue: toolGetMyRevenue,
  getRoomStatusOverview: toolGetRoomStatusOverview,
  getStaffRevenue: toolGetStaffRevenue,
  getAllStaffRevenue: toolGetAllStaffRevenue,
  getHotelRevenue: toolGetHotelRevenue,
  getHotelStats: toolGetHotelStats,
  getActivitySummary: toolGetActivitySummary,
  listBookings: toolListBookings,
}

const WRITE_EXECUTORS: Record<string, (args: any, staffCtx: StaffCtx) => Promise<ToolResult>> = {
  createBooking: toolCreateBooking,
  extendStay: toolExtendStay,
  createGroupBooking: toolCreateGroupBooking,
  addRoomToGroup: toolAddRoomToGroup,
  removeRoomFromGroup: toolRemoveRoomFromGroup,
  cancelGroup: toolCancelGroup,
  cancelBooking: toolCancelBooking,
  addCharge: toolAddCharge,
  applyDiscount: toolApplyDiscount,
}

/**
 * Execute any tool EXCEPT checkInGuest/checkOutGuest (those must go through
 * the resolveCheckInTarget/resolveCheckOutTarget + hook path — see above).
 */
export async function executeTool(name: string, args: any, staffCtx: StaffCtx = {}): Promise<ToolResult> {
  if (HOOK_EXECUTED_TOOLS.has(name)) {
    return { ok: false, error: `${name} must be executed via its hook, not executeTool().` }
  }
  const readOnly = READ_ONLY_EXECUTORS[name]
  if (readOnly) return readOnly(args, staffCtx)
  const write = WRITE_EXECUTORS[name]
  if (write) return write(args, staffCtx)
  return { ok: false, error: `Unknown tool: ${name}` }
}
