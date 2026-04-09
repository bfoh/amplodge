/**
 * Weekly Revenue Service
 * Handles per-staff weekly revenue tracking based on bookings they created.
 * Week boundaries: Monday 00:00 → Sunday 23:59 (ISO week, weekStartsOn: 1)
 *
 * Grand revenue = room prices + booking charges + standalone sales.
 */

import { blink } from '@/blink/client'
import { startOfWeek, endOfWeek, format, subWeeks, addDays, parseISO } from 'date-fns'
import { standaloneSalesService, type StandaloneSale } from './standalone-sales-service'
import { CHARGE_CATEGORIES } from './booking-charges-service'
import { parsePaymentEvents, computeStaffAttributedRevenue } from '@/lib/payment-events'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeeklyRevenueReport {
  id: string
  staffId: string       // Supabase auth user ID (matches booking.createdBy)
  staffName: string
  weekStart: string     // YYYY-MM-DD  (always a Monday)
  weekEnd: string       // YYYY-MM-DD  (always a Sunday)
  totalRevenue: number
  bookingCount: number
  bookingIds: string    // JSON-encoded string array of booking IDs
  status: 'draft' | 'submitted' | 'reviewed'
  notes: string         // Staff's own notes on the week
  adminNotes: string    // Admin feedback
  reviewedBy: string    // Admin user ID
  reviewedAt: string
  submittedAt: string
  createdAt: string
  updatedAt: string
}

export interface WeekBounds {
  weekStart: string   // YYYY-MM-DD
  weekEnd: string     // YYYY-MM-DD
  label: string       // e.g. "Mar 17 – Mar 23, 2026"
}

export interface ChargeLineSummary {
  id: string
  description: string
  category: string
  quantity: number
  unitPrice: number
  amount: number
  paymentMethod: string   // 'cash' | 'mobile_money' | 'card' | ''
  createdAt: string
}

export interface BookingSummary {
  id: string
  guestName: string
  roomNumber: string
  checkIn: string
  checkOut: string
  totalPrice: number       // Original room price before any discount
  discountAmount: number   // Discount applied at check-in (0 if none)
  effectivePrice: number   // totalPrice - discountAmount (actual room revenue)
  /**
   * How much of effectivePrice is attributed to this staff member.
   * For legacy bookings (no PaymentEvents), equals effectivePrice for the creator, 0 for others.
   * For new bookings with PaymentEvents, equals the sum of events where event.staffId === this staff's ID.
   */
  staffAttributedRevenue: number
  isDeposit: boolean       // true for confirmed bookings where only deposit was collected
  depositAmount: number    // amount collected at booking time (0 for non-deposit rows)
  status: string
  createdAt: string
  createdBy: string        // staff who created/reserved the booking
  checkInBy: string        // staff who performed the check-in (may differ from creator)
  checkInByName: string
  checkOutBy: string       // staff who performed the check-out
  checkOutByName: string
  paymentMethod: string   // 'cash' | 'mobile_money' | 'card' | 'not_paid'
  paymentSplits?: Array<{ method: string; amount: number }>
  additionalChargesTotal: number
  additionalCharges: ChargeLineSummary[]
  grandTotal: number       // effectivePrice + additionalChargesTotal
}

export interface StaffWeekResult {
  bookings: BookingSummary[]
  totalRevenue: number          // room prices only
  additionalRevenue: number     // booking charges total (in-week bookings + orphan charges)
  standaloneSalesRevenue: number
  grandRevenue: number          // all three combined
  bookingCount: number
  standaloneSales: StandaloneSale[]
  chargesByCategory: Record<string, number>  // category key → total amount
  /**
   * Charges created THIS WEEK but attached to bookings whose check-in date
   * falls in a different/earlier week. These are shown separately so they
   * are not double-counted with any booking row, but ARE included in
   * additionalRevenue and grandRevenue totals.
   */
  orphanCharges: ChargeLineSummary[]
  orphanChargesTotal: number
}

// ─── Week Utilities ───────────────────────────────────────────────────────────

export function getWeekBounds(date: Date = new Date()): WeekBounds {
  const start = startOfWeek(date, { weekStartsOn: 1 })
  const end = endOfWeek(date, { weekStartsOn: 1 })
  return {
    weekStart: format(start, 'yyyy-MM-dd'),
    weekEnd: format(end, 'yyyy-MM-dd'),
    label: `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`,
  }
}

/** Returns the last `count` week bounds, newest first (index 0 = current week). */
export function getPastWeeksBounds(count: number): WeekBounds[] {
  return Array.from({ length: count }, (_, i) => getWeekBounds(subWeeks(new Date(), i)))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode payment method stored in charge notes as <!-- CHARGE_PAY:method -->.
 * No separate DB column is used (schema-cache-safe pattern).
 */
function decodeChargePaymentMethod(rawNotes: string | undefined | null): string {
  if (!rawNotes) return ''
  const match = rawNotes.match(/<!-- CHARGE_PAY:(.*?) -->/)
  return match?.[1] || ''
}

/**
 * Extract paymentSplits from a raw DB booking's specialRequests field.
 * Splits are stored as <!-- PAYMENT_SPLITS:[...] --> since there is no DB column.
 */
function parsePaymentSplits(rawBooking: any): Array<{ method: string; amount: number }> | undefined {
  const specialReq = rawBooking.special_requests || rawBooking.specialRequests || ''
  if (!specialReq) return undefined
  const match = (specialReq as string).match(/<!-- PAYMENT_SPLITS:(.*?) -->/)
  if (!match?.[1]) return undefined
  try {
    const splits = JSON.parse(match[1])
    return Array.isArray(splits) && splits.length > 1 ? splits : undefined
  } catch {
    return undefined
  }
}

/**
 * Normalise payment method to canonical lowercase/underscore format.
 * Returns '' when no data is stored (so UI can show a dash instead of "Not Paid").
 * Only returns 'not_paid' when explicitly set to that value.
 */
function normalizePaymentMethod(raw: string): string {
  if (!raw || !raw.trim()) return ''           // no data stored → blank
  const s = raw.trim().toLowerCase()
  if (s === 'cash') return 'cash'
  if (s === 'mobile_money' || s === 'mobile money' || s.includes('mobile') || s.includes('momo')) return 'mobile_money'
  if (s === 'card' || s.includes('card') || s.includes('credit') || s.includes('debit')) return 'card'
  if (s === 'not_paid' || s === 'not paid') return 'not_paid'
  return ''                                    // unrecognised format → treat as no data
}

// ─── Booking Data ─────────────────────────────────────────────────────────────

/**
 * Fetch all confirmed/checked-in/checked-out bookings created by a specific staff member
 * within a given week. Also fetches booking charges and standalone sales.
 */
export async function fetchBookingsForStaffWeek(
  staffId: string,
  weekStart: string,
  weekEnd: string
): Promise<StaffWeekResult> {
  const db = blink.db as any

  let allBookings: any = null, allRooms: any = null, allGuests: any = null, allChargesRaw: any = null
  try {
    ;[allBookings, allRooms, allGuests, allChargesRaw] = await Promise.all([
      db.bookings.list({ limit: 2000 }),
      db.rooms.list({ limit: 500 }),
      db.guests.list({ limit: 1000 }),
      db.bookingCharges.list({ limit: 5000 }).catch(() => []),
    ])
  } catch (e) {
    console.warn('[fetchBookingsForStaffWeek] DB error:', e)
    return {
      bookings: [], totalRevenue: 0, additionalRevenue: 0,
      standaloneSalesRevenue: 0, grandRevenue: 0, bookingCount: 0,
      standaloneSales: [], chargesByCategory: {},
      orphanCharges: [], orphanChargesTotal: 0,
    }
  }

  // Build lookup maps
  const roomMap = new Map(((allRooms || []) as any[]).map((r: any) => [r.id, r]))
  const guestMap = new Map(((allGuests || []) as any[]).map((g: any) => [g.id, g]))

  // Group booking charges by booking ID
  const chargesByBookingId = new Map<string, any[]>()
  for (const c of (allChargesRaw || [])) {
    const key = c.bookingId || c.booking_id || ''
    if (!key) continue
    if (!chargesByBookingId.has(key)) chargesByBookingId.set(key, [])
    chargesByBookingId.get(key)!.push(c)
  }

  const from = new Date(weekStart + 'T00:00:00')
  const to = new Date(weekEnd + 'T23:59:59')

  // Build a set of booking IDs that have already progressed past 'confirmed' —
  // used to exclude deposit rows for bookings that are now checked-in/out (avoid double-count)
  const checkedInOrOutIds = new Set(
    ((allBookings || []) as any[])
      .filter((b: any) => ['checked-in', 'checked-out'].includes(b.status || ''))
      .map((b: any) => b.id)
  )

  // Build a set of "roomId|checkIn" keys for checked-in/out bookings.
  // Used to exclude confirmed duplicate bookings for the same room+dates.
  const occupiedRoomDates = new Set(
    ((allBookings || []) as any[])
      .filter((b: any) => ['checked-in', 'checked-out'].includes(b.status || ''))
      .map((b: any) => `${b.roomId || b.room_id}|${b.checkIn || b.check_in}`)
  )

  // Build a set of groupIds that already have their deposit accounted for.
  // Group deposits are shown ONCE on the primary booking (isPrimaryBooking=true)
  // with the full deposit amount — non-primary rooms are skipped for deposit rows.
  // This prevents splitting GHS 600 into 4 × GHS 100 and showing partial amounts.
  const groupDepositAccountedFor = new Set<string>()

  const matched: BookingSummary[] = ((allBookings || []) as any[])
    .filter((b: any) => {
      const creator = b.createdBy || b.created_by || ''
      const checker = b.checkInBy || b.check_in_by || ''
      const checkOuter = b.checkOutBy || b.check_out_by || ''
      if (creator !== staffId && checker !== staffId && checkOuter !== staffId) return false

      const status = b.status || ''

      if (['checked-in', 'checked-out'].includes(status)) {
        const checkIn = b.checkIn || b.check_in || ''
        if (!checkIn) return false
        const d = new Date(checkIn)
        return d >= from && d <= to
      }

      if (status === 'confirmed') {
        if (creator !== staffId) return false
        // Never show a deposit row for a booking that has since been checked-in/out
        if (checkedInOrOutIds.has(b.id)) return false
        // Exclude confirmed bookings where the same room+checkIn already has a checked-in/out booking
        const roomDateKey = `${b.roomId || b.room_id}|${b.checkIn || b.check_in}`
        if (occupiedRoomDates.has(roomDateKey)) return false
        // Payment data is stored ONLY in specialRequests comments — not as direct DB columns
        const specialReq = b.special_requests || b.specialRequests || ''
        const hasPayEvent = specialReq.includes('PAYMENT_EVENTS')
        const hasPayData = specialReq.includes('PAYMENT_DATA')
        let paidFromComment = 0
        let pStatusFromComment = 'pending'
        if (hasPayData) {
          const pdMatch = specialReq.match(/<!-- PAYMENT_DATA:(.*?) -->/)
          if (pdMatch?.[1]) {
            try {
              const pd = JSON.parse(pdMatch[1])
              paidFromComment = pd.amountPaid || 0
              pStatusFromComment = pd.paymentStatus || 'pending'
            } catch { /* ignore */ }
          }
        }
        const hasAnyPayment = hasPayEvent || paidFromComment > 0 || pStatusFromComment !== 'pending'
        if (!hasAnyPayment) return false

        // For GROUP bookings: only let the PRIMARY booking through.
        // The full group deposit is shown once on the primary booking — non-primary rooms are skipped.
        const isGroupMember = specialReq.includes('GROUP_DATA')
        if (isGroupMember) {
          const gdMatch = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
          if (gdMatch?.[1]) {
            try {
              const gd = JSON.parse(gdMatch[1])
              const gid = gd.groupId
              if (gid) {
                if (!gd.isPrimaryBooking) return false  // skip non-primary rooms
                if (groupDepositAccountedFor.has(gid)) return false  // already handled
                groupDepositAccountedFor.add(gid)
              }
            } catch { /* ignore */ }
          }
        }

        const createdAt = b.createdAt || b.created_at || ''
        if (!createdAt) return false
        const d = new Date(createdAt)
        return d >= from && d <= to
      }

      return false
    })
    .map((b: any) => {
      const room = roomMap.get(b.roomId) as any
      const guest = guestMap.get(b.guestId) as any
      // Parse guest name from snapshot (authoritative) then fall back to joined guest table
      const specialReq = b.special_requests || b.specialRequests || ''
      const snapshotMatch = (specialReq as string).match(/<!-- GUEST_SNAPSHOT:(.*?) -->/)
      let guestName = guest?.name || 'Guest'
      if (snapshotMatch?.[1]) {
        try { guestName = JSON.parse(snapshotMatch[1]).name || guestName } catch { /* ignore */ }
      }
      const rawMethod = b.paymentMethod || b.payment_method || b.payment?.method || ''
      const paymentSplits = parsePaymentSplits(b)
      // If splits exist, derive the primary method from the largest split
      const primaryMethod = paymentSplits
        ? paymentSplits.reduce((a, s) => s.amount > a.amount ? s : a, paymentSplits[0]).method
        : rawMethod

      // Additional charges for this booking
      const rawCharges = chargesByBookingId.get(b.id) || []
      const additionalCharges: ChargeLineSummary[] = rawCharges.map((c: any) => ({
        id: c.id,
        description: c.description || '',
        category: c.category || 'other',
        quantity: Number(c.quantity || 1),
        unitPrice: Number(c.unitPrice || c.unit_price || 0),
        amount: Number(c.amount || 0),
        paymentMethod: normalizePaymentMethod(c.paymentMethod || c.payment_method || decodeChargePaymentMethod(c.notes)),
        createdAt: c.createdAt || c.created_at || '',
      }))
      const additionalChargesTotal = additionalCharges.reduce((s, c) => s + c.amount, 0)

      const rawPrice = Number(b.totalPrice || 0)
      const discountAmt = Number(b.discountAmount || b.discount_amount || 0)
      const storedFinal = b.finalAmount ?? b.final_amount
      const effectivePrice = (storedFinal != null && storedFinal !== '')
        ? Math.max(0, Number(storedFinal))
        : discountAmt > 0
          ? Math.max(0, rawPrice - discountAmt)
          : rawPrice

      if (discountAmt > 0 || (storedFinal != null && storedFinal !== '')) {
        console.log('[revenue-service] discount booking', b.id, {
          rawPrice, discountAmt, storedFinal, effectivePrice,
        })
      }

      const creatorId = b.createdBy || b.created_by || ''
      const checkInById = b.checkInBy || b.check_in_by || ''
      const checkOutById = b.checkOutBy || b.check_out_by || ''

      // --- For CONFIRMED bookings: only count what was actually collected as deposit ---
      const isConfirmed = b.status === 'confirmed'
      let depositAmount = 0
      let depositMethod = rawMethod
      if (isConfirmed) {
        // Detect group booking — GROUP_DATA comment is present on group members
        const isGroupMember = specialReq.includes('GROUP_DATA')

        // For group primary booking: show the FULL group deposit (not per-room split).
        // The deposit was paid once by the group owner for all rooms.
        // For single-room bookings: show the actual amount paid.

        // 1. PAYMENT_EVENTS: sum all booking-stage events (covers both single and group)
        const events = parsePaymentEvents(specialReq)
        if (events.length > 0) {
          depositAmount = events
            .filter((e) => e.stage === 'booking')
            .reduce((s, e) => s + e.amount, 0)
          const bookingEvent = events.find((e) => e.stage === 'booking')
          if (bookingEvent) depositMethod = bookingEvent.method

          // For group primary: PAYMENT_EVENTS only stored this room's proportional share.
          // Multiply back up to get full group deposit by summing all rooms in the group.
          if (isGroupMember && depositAmount > 0) {
            const gdMatch = (specialReq as string).match(/<!-- GROUP_DATA:(.*?) -->/)
            if (gdMatch?.[1]) {
              try {
                const gd = JSON.parse(gdMatch[1])
                const gid = gd.groupId
                if (gid) {
                  // Sum all booking-stage PAYMENT_EVENTS across all group members
                  let groupDepositTotal = 0
                  for (const gb of (allBookings || []) as any[]) {
                    const gsr = gb.special_requests || gb.specialRequests || ''
                    if (!gsr.includes(gid)) continue
                    const gevents = parsePaymentEvents(gsr)
                    groupDepositTotal += gevents
                      .filter((e) => e.stage === 'booking')
                      .reduce((s, e) => s + e.amount, 0)
                  }
                  if (groupDepositTotal > 0) depositAmount = groupDepositTotal
                }
              } catch { /* ignore */ }
            }
          }
        }

        // 2. PAYMENT_DATA fallback
        if (depositAmount === 0) {
          const pdMatch = (specialReq as string).match(/<!-- PAYMENT_DATA:(.*?) -->/)
          if (pdMatch?.[1]) {
            try {
              const pd = JSON.parse(pdMatch[1])
              if (pd.paymentMethod) depositMethod = pd.paymentMethod
              // amountPaid in PAYMENT_DATA is the full group deposit total — use it directly
              if (pd.paymentStatus === 'full') {
                depositAmount = isGroupMember
                  ? Number(pd.amountPaid || rawPrice)  // full group deposit or room price
                  : rawPrice
              } else if (pd.amountPaid > 0) {
                depositAmount = Number(pd.amountPaid)  // the exact amount collected
              }
            } catch { /* ignore */ }
          }
        }

        // For group primary: show "Group Deposit" with full amount and group reference in room field
        let displayRoomNumber = room?.roomNumber || '—'
        let displayTotalPrice = rawPrice
        if (isGroupMember) {
          const gdMatch2 = (specialReq as string).match(/<!-- GROUP_DATA:(.*?) -->/)
          if (gdMatch2?.[1]) {
            try {
              const gd = JSON.parse(gdMatch2[1])
              if (gd.groupReference) displayRoomNumber = `Group ${gd.groupReference}`
              // Show full group total as the "room rate" context
              const gid = gd.groupId
              if (gid) {
                const groupTotal = ((allBookings || []) as any[])
                  .filter((gb: any) => {
                    const gsr = gb.special_requests || gb.specialRequests || ''
                    if (!gsr.includes(gid)) return false
                    const gdm = gsr.match(/<!-- GROUP_DATA:(.*?) -->/)
                    if (!gdm?.[1]) return false
                    try { return JSON.parse(gdm[1]).groupId === gid } catch { return false }
                  })
                  .reduce((s: number, gb: any) => s + Number(gb.totalPrice || 0), 0)
                if (groupTotal > 0) displayTotalPrice = groupTotal
              }
            } catch { /* ignore */ }
          }
        }

        return {
          id: b.id,
          guestName,
          roomNumber: displayRoomNumber,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          totalPrice: displayTotalPrice,
          discountAmount: 0,
          effectivePrice: displayTotalPrice,
          staffAttributedRevenue: depositAmount,
          isDeposit: true,
          depositAmount,
          status: b.status,
          createdAt: b.createdAt || b.created_at || '',
          createdBy: creatorId,
          checkInBy: '',
          checkInByName: '',
          checkOutBy: '',
          checkOutByName: '',
          paymentMethod: normalizePaymentMethod(depositMethod),
          paymentSplits,
          additionalCharges: [],
          additionalChargesTotal: 0,
          grandTotal: depositAmount,
        }
      }

      // --- Payment event attribution for checked-in / checked-out bookings ---
      const paymentEvents = parsePaymentEvents(specialReq)

      // Read amountPaid / paymentStatus from PAYMENT_DATA comment (amountPaid is NOT a direct DB column).
      // IMPORTANT: for group bookings, PAYMENT_DATA.amountPaid stores the full group total — not the
      // per-room amount. Only use it for single-room bookings; treat group members as 'pending' so
      // the full effectivePrice is attributed to whoever collected it (check-in/out staff).
      let legacyAmountPaid: number | undefined
      let legacyPaymentStatus: 'full' | 'part' | 'pending' | undefined
      if (paymentEvents.length === 0) {
        const isGroupMember = specialReq.includes('GROUP_DATA')
        const pdMatch = (specialReq as string).match(/<!-- PAYMENT_DATA:(.*?) -->/)
        if (pdMatch?.[1]) {
          try {
            const pd = JSON.parse(pdMatch[1])
            legacyPaymentStatus = (pd.paymentStatus || 'pending') as 'full' | 'part' | 'pending'
            if (isGroupMember) {
              // Distribute group deposit proportionally using groupSubtotalMap
              const gdMatch = (specialReq as string).match(/<!-- GROUP_DATA:(.*?) -->/)
              if (gdMatch?.[1]) {
                try {
                  const gd = JSON.parse(gdMatch[1])
                  const gid = gd.groupId
                  const groupSubtotal = gid ? (groupSubtotalMap.get(gid) || 0) : 0
                  const totalDeposit = Number(pd.amountPaid || 0)
                  if (groupSubtotal > 0 && totalDeposit > 0) {
                    legacyAmountPaid = Math.round((effectivePrice / groupSubtotal) * totalDeposit * 100) / 100
                  }
                } catch { /* ignore */ }
              }
            } else {
              legacyAmountPaid = pd.amountPaid || 0
            }
          } catch { /* ignore */ }
        }
        if (!legacyAmountPaid) legacyAmountPaid = Number(b.amountPaid ?? b.amount_paid ?? 0) || 0
        if (!legacyPaymentStatus) legacyPaymentStatus = (b.paymentStatus || b.payment_status || 'pending') as 'full' | 'part' | 'pending'
      }

      // Fallback for completed bookings (checked-in/out) with no payment events,
      // no PAYMENT_DATA, and no collector recorded (checkInBy/checkOutBy both empty).
      // The booking is done — someone received payment. If we have no collector info,
      // attribute the full amount to the creator rather than leaving it unattributed.
      if (
        paymentEvents.length === 0 &&
        legacyPaymentStatus === 'pending' &&
        !legacyAmountPaid &&
        !checkInById &&
        !checkOutById &&
        (b.status === 'checked-out' || b.status === 'checked-in')
      ) {
        legacyPaymentStatus = 'full'
      }

      const staffAttributedRevenue = computeStaffAttributedRevenue(
        paymentEvents, staffId, effectivePrice, creatorId,
        checkOutById, checkInById, legacyAmountPaid, legacyPaymentStatus
      )

      return {
        id: b.id,
        guestName,
        roomNumber: room?.roomNumber || '—',
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        totalPrice: rawPrice,
        discountAmount: discountAmt,
        effectivePrice,
        staffAttributedRevenue,
        isDeposit: false,
        depositAmount: 0,
        status: b.status,
        createdAt: b.createdAt || b.created_at || '',
        createdBy: creatorId,
        checkInBy: checkInById,
        checkInByName: b.checkInByName || b.check_in_by_name || '',
        checkOutBy: checkOutById,
        checkOutByName: b.checkOutByName || b.check_out_by_name || '',
        paymentMethod: normalizePaymentMethod(primaryMethod),
        paymentSplits,
        additionalCharges,
        additionalChargesTotal,
        grandTotal: effectivePrice + additionalChargesTotal,
      }
    })
    // Exclude non-deposit bookings where this staff has zero attributed revenue.
    // Always keep deposit (confirmed) rows — they passed the filter so payment was made.
    .filter((b) => b.isDeposit || b.staffAttributedRevenue > 0 || b.effectivePrice === 0)

  // ── Orphan charges ────────────────────────────────────────────────────────
  // Charges created THIS WEEK on bookings owned by this staff member whose
  // check-in date falls outside this week (not already covered by `matched`).
  const matchedIds = new Set(matched.map((b) => b.id))
  // All booking IDs attributed to this staff member (created, checked-in, or checked-out by them)
  const allStaffBookingIds = new Set(
    ((allBookings || []) as any[])
      .filter((b: any) => {
        const creator = b.createdBy || b.created_by || ''
        const checker = b.checkInBy || b.check_in_by || ''
        const checkOuter = b.checkOutBy || b.check_out_by || ''
        return creator === staffId || checker === staffId || checkOuter === staffId
      })
      .map((b: any) => b.id)
  )

  const orphanCharges: ChargeLineSummary[] = []
  for (const [bookingId, charges] of chargesByBookingId.entries()) {
    if (!allStaffBookingIds.has(bookingId)) continue  // not this staff's booking
    if (matchedIds.has(bookingId)) continue           // already counted in matched
    for (const c of charges) {
      const createdAt = c.createdAt || c.created_at || ''
      if (!createdAt) continue
      const d = new Date(createdAt)
      if (d >= from && d <= to) {
        orphanCharges.push({
          id: c.id,
          description: c.description || '',
          category: c.category || 'other',
          quantity: Number(c.quantity || 1),
          unitPrice: Number(c.unitPrice || c.unit_price || 0),
          amount: Number(c.amount || 0),
          paymentMethod: normalizePaymentMethod(
            c.paymentMethod || c.payment_method || decodeChargePaymentMethod(c.notes)
          ),
          createdAt,
        })
      }
    }
  }
  const orphanChargesTotal = orphanCharges.reduce((s, c) => s + c.amount, 0)

  // Standalone sales for this staff member this week
  const standaloneSales = await standaloneSalesService.getSalesForStaff(staffId, weekStart, weekEnd)
  const standaloneSalesRevenue = standaloneSales.reduce((s, sale) => s + sale.amount, 0)

  const totalRevenue = matched.reduce((s, b) => s + b.staffAttributedRevenue, 0)  // after-discount, per-staff attributed room revenue
  const additionalRevenue = matched.reduce((s, b) => s + b.additionalChargesTotal, 0) + orphanChargesTotal
  const grandRevenue = totalRevenue + additionalRevenue + standaloneSalesRevenue

  // Build charges-by-category summary (includes orphan charges)
  const chargesByCategory: Record<string, number> = {}
  for (const b of matched) {
    for (const c of b.additionalCharges) {
      chargesByCategory[c.category] = (chargesByCategory[c.category] || 0) + c.amount
    }
  }
  for (const c of orphanCharges) {
    chargesByCategory[c.category] = (chargesByCategory[c.category] || 0) + c.amount
  }

  return {
    bookings: matched,
    totalRevenue,
    additionalRevenue,
    standaloneSalesRevenue,
    grandRevenue,
    bookingCount: matched.length,
    standaloneSales,
    chargesByCategory,
    orphanCharges,
    orphanChargesTotal,
  }
}

// ─── Report CRUD ──────────────────────────────────────────────────────────────

/**
 * Get or create a weekly revenue report for a staff member.
 * For draft reports (including the current week), always recalculates from
 * live bookings so the numbers stay up-to-date in real time.
 */
export async function getOrCreateWeekReport(
  staffId: string,
  staffName: string,
  week: WeekBounds
): Promise<WeeklyRevenueReport> {
  const db = blink.db as any

  // Fetch all and filter client-side — blink SDK where-filter is unreliable for custom tables
  let allRows: WeeklyRevenueReport[] = []
  try {
    const rows = await db.hr_weekly_revenue.list({ limit: 500 })
    allRows = (rows || []) as WeeklyRevenueReport[]
  } catch (e) {
    console.warn('[getOrCreateWeekReport] list failed (table may not exist yet):', e)
  }
  const existing = allRows.find(
    (r) => {
      const sid = (r as any).staffId || (r as any).staff_id || ''
      const ws  = (r as any).weekStart || (r as any).week_start || ''
      return sid === staffId && ws === week.weekStart && r.status !== 'init'
    }
  )

  // Always recalculate from live bookings so counts/revenue stay accurate
  const { bookings, totalRevenue, bookingCount } = await fetchBookingsForStaffWeek(
    staffId,
    week.weekStart,
    week.weekEnd
  )
  const bookingIds = JSON.stringify(bookings.map((b) => b.id))
  const now = new Date().toISOString()

  if (existing) {
    const updated: WeeklyRevenueReport = {
      ...existing,
      staffName, // keep name fresh
      totalRevenue,
      bookingCount,
      bookingIds,
      updatedAt: now,
    }
    try {
      await db.hr_weekly_revenue.update(existing.id, updated)
    } catch (e) {
      console.warn('[getOrCreateWeekReport] update failed:', e)
    }
    return updated
  }

  const record: WeeklyRevenueReport = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    staffId,
    staffName,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    totalRevenue,
    bookingCount,
    bookingIds,
    status: 'draft',
    notes: '',
    adminNotes: '',
    reviewedBy: '',
    reviewedAt: '',
    submittedAt: '',
    createdAt: now,
    updatedAt: now,
  }
  try {
    await db.hr_weekly_revenue.create(record)
  } catch (e) {
    console.warn('[getOrCreateWeekReport] create failed (table may not exist yet):', e)
  }
  return record
}

/**
 * Staff submits their weekly report (locks it from further auto-recalculation).
 */
export async function submitWeekReport(reportId: string, notes: string): Promise<void> {
  const db = blink.db as any
  await db.hr_weekly_revenue.update(reportId, {
    status: 'submitted',
    notes,
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Admin marks a report as reviewed with optional feedback notes.
 */
export async function reviewWeekReport(
  reportId: string,
  adminNotes: string,
  reviewedByName: string
): Promise<void> {
  const db = blink.db as any
  await db.hr_weekly_revenue.update(reportId, {
    status: 'reviewed',
    adminNotes,
    reviewedBy: reviewedByName,
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

/** Get all staff reports for a specific week (admin view). */
export async function getAllStaffReportsForWeek(weekStart: string): Promise<WeeklyRevenueReport[]> {
  const db = blink.db as any

  // weekEnd = Sunday of that ISO week (weekStart is Monday).
  // Use date-fns addDays + parseISO to avoid timezone-driven off-by-one from toISOString().
  const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')

  const from = new Date(weekStart + 'T00:00:00')
  const to   = new Date(weekEnd   + 'T23:59:59')

  try {
    const [rows, allBookings] = await Promise.all([
      db.hr_weekly_revenue.list({ limit: 500 }),
      db.bookings.list({ limit: 2000 }),
    ])

    // Saved reports for this week
    const savedReports: WeeklyRevenueReport[] = ((rows || []) as WeeklyRevenueReport[]).filter((r) => {
      const ws = (r as any).weekStart || (r as any).week_start || ''
      return ws === weekStart && r.status !== 'init'
    })
    const savedStaffIds = new Set(savedReports.map((r) => (r as any).staffId || (r as any).staff_id || ''))

    // Scan bookings to find staff with activity in this week but no saved report.
    // A booking contributes to a staff member's week if:
    //   - checked-in/out: checkIn date is in the week
    //   - confirmed deposit: createdAt is in the week (and has payment)
    const unsavedStaff = new Map<string, string>() // staffId → staffName
    for (const b of (allBookings || []) as any[]) {
      const status = b.status || ''
      let inWeek = false

      if (['checked-in', 'checked-out'].includes(status)) {
        const ci = new Date(b.checkIn || b.check_in || '')
        inWeek = !isNaN(ci.getTime()) && ci >= from && ci <= to
      } else if (status === 'confirmed') {
        const sr = b.special_requests || b.specialRequests || ''
        const hasPayment = sr.includes('PAYMENT_EVENTS') || sr.includes('PAYMENT_DATA')
        if (hasPayment) {
          const ca = new Date(b.createdAt || b.created_at || '')
          inWeek = !isNaN(ca.getTime()) && ca >= from && ca <= to
        }
      }

      if (!inWeek) continue

      const staffIds = [
        { id: b.createdBy || b.created_by || '', name: b.createdByName || b.created_by_name || '' },
        { id: b.checkInBy || b.check_in_by || '', name: b.checkInByName || b.check_in_by_name || '' },
        { id: b.checkOutBy || b.check_out_by || '', name: b.checkOutByName || b.check_out_by_name || '' },
      ]
      for (const { id, name } of staffIds) {
        if (id && !savedStaffIds.has(id) && !unsavedStaff.has(id)) {
          unsavedStaff.set(id, name || id)
        }
      }
    }

    // Build synthetic (in-memory only) reports for staff with activity but no saved record.
    // bookingCount/totalRevenue start at 0 — StaffWeekCard.loadBks() populates them via liveData.
    const now = new Date().toISOString()
    const syntheticReports: WeeklyRevenueReport[] = []
    for (const [staffId, staffName] of unsavedStaff) {
      syntheticReports.push({
        id: `synthetic_${staffId}_${weekStart}`,
        staffId,
        staffName,
        weekStart,
        weekEnd,
        totalRevenue: 0,
        bookingCount: 0,
        bookingIds: '[]',
        status: 'draft',
        notes: '',
        adminNotes: '',
        reviewedBy: '',
        reviewedAt: '',
        submittedAt: '',
        createdAt: now,
        updatedAt: now,
      })
    }

    return [...savedReports, ...syntheticReports].sort((a, b) => b.totalRevenue - a.totalRevenue)
  } catch (e) {
    console.warn('[getAllStaffReportsForWeek] failed:', e)
    return []
  }
}

/** Get a staff member's own report history, newest first. */
export async function getStaffAllReports(staffId: string): Promise<WeeklyRevenueReport[]> {
  const db = blink.db as any
  try {
    const rows = await db.hr_weekly_revenue.list({ limit: 500 })
    return ((rows || []) as WeeklyRevenueReport[])
      .filter((r) => {
        const sid = (r as any).staffId || (r as any).staff_id || ''
        return sid === staffId && r.status !== 'init'
      })
      .sort((a, b) => {
        const wsA = (a as any).weekStart || (a as any).week_start || ''
        const wsB = (b as any).weekStart || (b as any).week_start || ''
        return wsB > wsA ? 1 : -1
      })
  } catch (e) {
    console.warn('[getStaffAllReports] failed:', e)
    return []
  }
}

// Re-export CHARGE_CATEGORIES for page-level convenience
export { CHARGE_CATEGORIES }
