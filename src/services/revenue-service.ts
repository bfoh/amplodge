/**
 * Weekly Revenue Service
 * Handles per-staff weekly revenue tracking based on bookings they created.
 * Week boundaries: Monday 00:00 → Sunday 23:59 (ISO week, weekStartsOn: 1)
 *
 * Grand revenue = room prices + booking charges + standalone sales.
 */

import { db, auth } from '@/lib/db'
import { startOfWeek, endOfWeek, format, subWeeks, addDays, parseISO } from 'date-fns'
import { standaloneSalesService } from './standalone-sales-service'
import type { StandaloneSale, ActivityLog } from '@/types'
import { CHARGE_CATEGORIES } from './booking-charges-service'
import { parsePaymentEvents, computeStaffAttributedRevenue, computeStaffAttributedByMethod, aggregateMethodTotals } from '@/lib/payment-events'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeeklyRevenueReport {
  id: string
  staffId: string       // Supabase auth user ID (matches booking.createdBy)
  staffName: string
  weekStart: string     // YYYY-MM-DD  (always a Monday)
  weekEnd: string       // YYYY-MM-DD  (always a Sunday)
  /** Grand revenue for the week: rooms + booking charges + standalone sales. */
  totalRevenue: number
  bookingCount: number
  bookingIds: string    // JSON-encoded string array of booking IDs
  status: 'draft' | 'submitted' | 'reviewed' | 'init'
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
  /**
   * staffAttributedRevenue broken out by the method it was collected with.
   * Values sum to staffAttributedRevenue. Payment-method breakdowns must use
   * this rather than re-deriving one from paymentSplits/paymentMethod, which
   * carry the booking's whole figure regardless of who collected it or what a
   * later discount reduced it to.
   */
  attributedByMethod: Record<string, number>
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

/** Pre-fetched shared data for staff revenue calculations — avoid redundant DB calls. */
export interface StaffRevenueSharedData {
  bookings: any[]
  properties: any[]
  guests: any[]
  chargesRaw: any[]
  staffRows: any[]
  standaloneSales: any[]
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

/** Parsed GROUP_DATA metadata, or null when the booking is not a group member. */
function parseGroupData(specialRequests: string): { groupId?: string; groupReference?: string; isPrimaryBooking?: boolean } | null {
  const match = (specialRequests || '').match(/<!-- GROUP_DATA:(.*?) -->/)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/** Rooms booked in one sitting land within seconds of each other; days apart means a separate payment. */
const GROUP_BATCH_GAP_MS = 30 * 60 * 1000

/**
 * Find group-member bookings whose stored PAYMENT_DATA.amountPaid is really a
 * whole batch's payment stamped onto every room booked in that sitting.
 *
 * Before 2026-08-21 the booking form wrote the batch-wide figure onto each
 * room, so a 5-room batch that paid GHS 1,000 stored "1000" five times. Rooms
 * added to the same group on a later day are a separate payment and must not
 * be pooled with it — hence batches, not groups, are the unit here.
 *
 * A stored amount that appears on only one room of a group is left alone: it
 * is already that room's own figure. Rows carrying PAYMENT_EVENTS are skipped
 * entirely — those hold a real per-room share and need no reconstruction.
 *
 * Returns bookingId → { amount: what the batch paid, subtotal: batch room total }.
 */
function buildLegacyGroupBatches(
  bookings: any[]
): Map<string, { amount: number; subtotal: number }> {
  // groupId + stored amount → the member rows carrying it
  const candidates = new Map<string, Array<{ id: string; price: number; at: number }>>()

  for (const b of bookings) {
    const specialReq = b.special_requests || b.specialRequests || ''
    const gid = parseGroupData(specialReq)?.groupId
    if (!gid) continue
    if (parsePaymentEvents(specialReq).some((e) => e.stage === 'booking')) continue

    const pdMatch = (specialReq as string).match(/<!-- PAYMENT_DATA:(.*?) -->/)
    if (!pdMatch?.[1]) continue
    let amount = 0
    try {
      const pd = JSON.parse(pdMatch[1])
      // `perRoom` rows state outright that the figure is this room's own —
      // no reconstruction, and no risk of re-splitting an already-correct
      // amount that happens to match its neighbours (equal-priced rooms in
      // one sitting hold equal shares, which is indistinguishable from a
      // duplicated stamp by inspection alone).
      if (pd.perRoom === true) continue
      amount = Number(pd.amountPaid) || 0
    } catch { continue }
    if (amount <= 0) continue

    const key = `${gid}|${amount}`
    if (!candidates.has(key)) candidates.set(key, [])
    candidates.get(key)!.push({
      id: b.id,
      price: Number(b.totalPrice ?? b.total_price ?? 0) || 0,
      at: new Date(b.createdAt || b.created_at || 0).getTime() || 0,
    })
  }

  const batches = new Map<string, { amount: number; subtotal: number }>()

  for (const [key, rows] of candidates.entries()) {
    const amount = Number(key.split('|')[1])
    rows.sort((a, b) => a.at - b.at)

    // Chain rows into sittings: consecutive rows closer than the gap belong together.
    let current: typeof rows = []
    const flush = () => {
      if (current.length > 1) {
        const subtotal = current.reduce((s, r) => s + r.price, 0)
        for (const r of current) batches.set(r.id, { amount, subtotal })
      }
      current = []
    }
    for (const row of rows) {
      const prev = current[current.length - 1]
      if (prev && row.at - prev.at > GROUP_BATCH_GAP_MS) flush()
      current.push(row)
    }
    flush()
  }

  return batches
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
  if (s === 'pay_later' || s === 'pay later') return 'pay_later'  // on folio, not collected until settled at checkout
  return ''                                    // unrecognised format → treat as no data
}

// ─── Booking Data ─────────────────────────────────────────────────────────────

/**
 * Internal calculator that processes pre-fetched data for a specific staff member.
 */
export function calculateStaffWeekResultInternal(
  staffId: string,
  weekStart: string,
  weekEnd: string,
  shared: StaffRevenueSharedData
): StaffWeekResult {
  const staffIdSet = new Set<string>([staffId])
  const staffNameSet = new Set<string>()
  
  for (const s of shared.staffRows) {
    const sid = s.id || ''
    const uid = s.userId || s.user_id || ''
    if (sid === staffId || uid === staffId) {
      if (sid) staffIdSet.add(sid)
      if (uid) staffIdSet.add(uid)
      const email = (s.email || '').trim().toLowerCase()
      const name  = (s.name || s.staffName || s.staff_name || '').trim().toLowerCase()
      if (email) staffNameSet.add(email)
      if (name)  staffNameSet.add(name)
    }
  }

  const roomMap = new Map((shared.properties as any[]).map((r: any) => [r.id, r]))
  const guestMap = new Map((shared.guests as any[]).map((g: any) => [g.id, g]))

  const dedupPriority: Record<string, number> = {
    'checked-out': 5, 'checked-in': 4, 'confirmed': 3, 'reserved': 2, 'cancelled': 1,
  }
  const normDateStr = (d: string) => (d || '').split('T')[0]
  
  // Deduplicate bookings
  let allBookings: any[] = []
  {
    const seen = new Map<string, { idx: number; status: string }>()
    for (const b of (shared.bookings as any[])) {
      const roomId = b.roomId || b.room_id || ''
      const ci = normDateStr(b.checkIn || b.check_in || '')
      const co = normDateStr(b.checkOut || b.check_out || '')
      const guest = guestMap.get(b.guestId || b.guest_id) as any
      const guestKey = (guest?.email || guest?.name || '').trim().toLowerCase()
      const key = `${roomId}|${ci}|${co}|${guestKey}`
      const existing = seen.get(key)
      if (existing) {
        const existingPri = dedupPriority[existing.status] || 0
        const currentPri = dedupPriority[b.status || ''] || 0
        if (currentPri > existingPri) {
          allBookings[existing.idx] = b
          seen.set(key, { idx: existing.idx, status: b.status || '' })
        }
      } else {
        seen.set(key, { idx: allBookings.length, status: b.status || '' })
        allBookings.push(b)
      }
    }
  }

  const legacyGroupBatches = buildLegacyGroupBatches(allBookings)

  /**
   * How much of a legacy group member's stored PAYMENT_DATA.amountPaid really
   * belongs to this one room. Returns null when the row is not part of a
   * duplicated batch, in which case the stored figure is already per-room.
   */
  const proratedLegacyPayment = (bookingId: string, roomPrice: number): number | null => {
    const batch = legacyGroupBatches.get(bookingId)
    if (!batch || batch.subtotal <= 0) return null
    return Math.round((roomPrice / batch.subtotal) * batch.amount * 100) / 100
  }

  const chargesByBookingId = new Map<string, any[]>()
  for (const c of (shared.chargesRaw || [])) {
    const key = c.bookingId || c.booking_id || ''
    if (!key) continue
    if (!chargesByBookingId.has(key)) chargesByBookingId.set(key, [])
    chargesByBookingId.get(key)!.push(c)
  }

  // Week boundaries are anchored to the hotel's clock (Ghana, UTC+0), not the
  // viewer's. Building them from local time made the same payment fall in
  // different weeks depending on where the page was opened — a charge taken at
  // 22:49 in Accra belongs to that day's takings whether the manager reads the
  // report in Kumasi or abroad.
  const from = new Date(weekStart + 'T00:00:00Z')
  const to = new Date(weekEnd + 'T23:59:59.999Z')

  const checkedInOrOutIds = new Set(
    allBookings
      .filter((b: any) => ['checked-in', 'checked-out'].includes(b.status || ''))
      .map((b: any) => b.id)
  )

  const occupiedRoomDates = new Set(
    allBookings
      .filter((b: any) => ['checked-in', 'checked-out'].includes(b.status || ''))
      .map((b: any) => `${b.roomId || b.room_id}|${b.checkIn || b.check_in}`)
  )

  const isThisStaff = (id: string, name: string): boolean => {
    if (id && staffIdSet.has(id)) return true
    if (!id && name && staffNameSet.has(name.trim().toLowerCase())) return true
    return false
  }


  const matched: BookingSummary[] = allBookings
    .filter((b: any) => {
      const creator = b.createdBy || b.created_by || ''
      const creatorName = b.createdByName || b.created_by_name || ''
      const status = b.status || ''

      // Cancelled bookings earn no revenue: deposits are refunded on cancel
      // (per policy), so exclude them entirely — matches the analytics/dashboard
      // view, which already ignores cancelled bookings.
      if (status === 'cancelled') return false

      const specialReq = b.special_requests || b.specialRequests || ''
      const events = parsePaymentEvents(specialReq)

      // 1. Check if a payment event THIS staff member recorded happened in this week.
      //
      // The staff check is essential: this rule short-circuits every ownership
      // check below it, so matching on "any staff's event" put every deposit
      // taken in the week onto every staff member's report.
      // Events with no staff stamped on them (legacy rows) deliberately fall
      // through to rules 2/3, which credit the creator / check-in staff.
      const hasEventInWeek = events.some(e => {
        const d = new Date(e.paidAt)
        return d >= from && d <= to && isThisStaff(e.staffId, e.staffName)
      })
      if (hasEventInWeek) return true

      // 2. Check check-in date only.
      //
      // Revenue is attributed to the week the guest checked in (hotel-night
      // accounting). Previously we also matched when check-out fell in the
      // week, which double-counted bookings spanning a week boundary in both
      // the prior and current weeks.
      if (['checked-in', 'checked-out'].includes(status)) {
        const ciStr = b.checkIn || b.check_in || ''
        const ci = ciStr ? new Date(ciStr) : null
        if (ci && ci >= from && ci <= to) return true
      }

      // 3. Check deposits for confirmed bookings
      if (status === 'confirmed') {
        if (!isThisStaff(creator, creatorName)) return false
        const createdAt = b.createdAt || b.created_at || ''
        if (createdAt) {
          const d = new Date(createdAt)
          if (d >= from && d <= to) {
            const hasPayData = specialReq.includes('PAYMENT_DATA') || specialReq.includes('PAYMENT_EVENTS')
            if (hasPayData) return true
          }
        }
      }

      return false
    })
    .map((b: any) => {
      const room = roomMap.get(b.roomId) as any
      const guest = guestMap.get(b.guestId) as any
      const specialReq = b.special_requests || b.specialRequests || ''
      const snapshotMatch = (specialReq as string).match(/<!-- GUEST_SNAPSHOT:(.*?) -->/)
      let guestName = guest?.name || 'Guest'
      if (snapshotMatch?.[1]) {
        try { guestName = JSON.parse(snapshotMatch[1]).name || guestName } catch { /* ignore */ }
      }
      const rawMethod = b.paymentMethod || b.payment_method || b.payment?.method || ''
      const paymentSplits = parsePaymentSplits(b)
      const primaryMethod = paymentSplits
        ? paymentSplits.reduce((a, s) => s.amount > a.amount ? s : a, paymentSplits[0]).method
        : rawMethod

      const rawCharges = (chargesByBookingId.get(b.id) || [])
        .filter((c: any) => isThisStaff(c.createdBy || c.created_by, ''))

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
      const effectivePrice = (discountAmt > 0 && storedFinal != null && storedFinal !== '')
        ? Math.max(0, Number(storedFinal))
        : discountAmt > 0
          ? Math.max(0, rawPrice - discountAmt)
          : rawPrice

      const creatorIdRaw    = b.createdBy      || b.created_by      || ''
      const creatorNameRaw  = b.createdByName  || b.created_by_name || ''
      const checkInByIdRaw  = b.checkInBy      || b.check_in_by     || ''
      const checkInNameRaw  = b.checkInByName  || b.check_in_by_name  || ''
      const checkOutByIdRaw = b.checkOutBy     || b.check_out_by    || ''
      const checkOutNameRaw = b.checkOutByName || b.check_out_by_name || ''
      const creatorId   = isThisStaff(creatorIdRaw,    creatorNameRaw)  ? staffId : creatorIdRaw
      const checkInById = isThisStaff(checkInByIdRaw,  checkInNameRaw)  ? staffId : checkInByIdRaw
      const checkOutById= isThisStaff(checkOutByIdRaw, checkOutNameRaw) ? staffId : checkOutByIdRaw

      const isConfirmed = b.status === 'confirmed'
      let depositAmount = 0
      let staffDepositAmount = 0
      let depositMethod = rawMethod
      let depositSplits: Array<{ method: string; amount: number }> | undefined
      if (isConfirmed) {
        const isGroupMember = specialReq.includes('GROUP_DATA')
        const groupData = isGroupMember ? parseGroupData(specialReq) : null
        const events = parsePaymentEvents(specialReq)
        if (events.length > 0) {
          // A group's deposit is stored as a per-room share on each member
          // booking, so this row must count ONLY its own share. Summing the
          // whole group here (as this once did) counted the deposit again for
          // every room in the group.
          const bookingEvents = events.filter((e) => e.stage === 'booking')
          depositAmount = bookingEvents.reduce((s, e) => s + e.amount, 0)
          staffDepositAmount = bookingEvents
            .filter((e) => isThisStaff(e.staffId, e.staffName))
            .reduce((s, e) => s + e.amount, 0)
          // An event saved with no staff on it belongs to whoever created the
          // booking — without this the money would belong to nobody and drop
          // out of the company-wide total, which sums these per-staff figures.
          if (creatorId === staffId) {
            staffDepositAmount += bookingEvents
              .filter((e) => !e.staffId && !e.staffName)
              .reduce((s, e) => s + e.amount, 0)
          }
          const bookingEvent = bookingEvents[0]
          if (bookingEvent) {
            depositMethod = bookingEvent.method
            // Multi-method deposit → surface each method with its amount
            const totals = aggregateMethodTotals([bookingEvent])
              .map((t) => ({ method: normalizePaymentMethod(t.method), amount: t.amount }))
              .filter((t) => t.method)
            if (totals.length > 1) depositSplits = totals
          }
        }

        if (depositAmount === 0) {
          const pdMatch = (specialReq as string).match(/<!-- PAYMENT_DATA:(.*?) -->/)
          if (pdMatch?.[1]) {
            try {
              const pd = JSON.parse(pdMatch[1])
              if (pd.paymentMethod) depositMethod = pd.paymentMethod
              if (pd.paymentStatus === 'full') {
                // Paid in full = this room's own price, whatever the rest of
                // the group paid.
                depositAmount = rawPrice
              } else if (pd.amountPaid > 0) {
                // A batch-wide figure stamped on every room booked in one
                // sitting is prorated back down; anything else is already
                // this room's own number.
                depositAmount = proratedLegacyPayment(b.id, rawPrice) ?? Number(pd.amountPaid)
              }
            } catch { /* ignore */ }
          }
          // Legacy rows carry no per-payment staff stamp — the booking's
          // creator is the one who collected the deposit.
          if (creatorId === staffId) staffDepositAmount = depositAmount
        }

        let displayRoomNumber = room?.roomNumber || '—'
        if (groupData?.groupReference) {
          // Keep the room visible alongside the group reference; every member
          // row rendering as just "Group GRP-…" made the duplicate deposits
          // impossible to tell apart.
          displayRoomNumber = `${displayRoomNumber} · ${groupData.groupReference}`
        }

        // A deposit can never be worth more than the booking it sits on — a
        // discount recorded against the booking caps it, same as for a stay.
        depositAmount = Math.min(depositAmount, effectivePrice)
        staffDepositAmount = Math.min(staffDepositAmount, effectivePrice)

        const depositPrimaryMethod = normalizePaymentMethod(depositMethod)
        const splitsForMethods = depositSplits || paymentSplits
        const splitsTotal = (splitsForMethods || []).reduce((s, p) => s + Number(p.amount || 0), 0)
        const attributedByMethod: Record<string, number> = {}
        if (splitsForMethods && splitsTotal > 0) {
          // Share this staff's slice of the deposit across the methods it came in on.
          for (const p of splitsForMethods) {
            const method = normalizePaymentMethod(p.method)
            if (!method) continue
            const part = Math.round((Number(p.amount) / splitsTotal) * staffDepositAmount * 100) / 100
            if (part > 0) attributedByMethod[method] = (attributedByMethod[method] || 0) + part
          }
        } else if (depositPrimaryMethod && staffDepositAmount > 0) {
          attributedByMethod[depositPrimaryMethod] = staffDepositAmount
        }

        return {
          id: b.id, guestName, roomNumber: displayRoomNumber,
          checkIn: b.checkIn, checkOut: b.checkOut, totalPrice: rawPrice,
          discountAmount: discountAmt, effectivePrice,
          staffAttributedRevenue: staffDepositAmount, isDeposit: true, depositAmount,
          status: b.status, createdAt: b.createdAt || b.created_at || '',
          createdBy: creatorId, checkInBy: '', checkInByName: '', checkOutBy: '', checkOutByName: '',
          paymentMethod: depositPrimaryMethod,
          paymentSplits: splitsForMethods,
          attributedByMethod,
          // Charges belong on this row even before the guest checks in. Zeroing
          // them here dropped them from revenue altogether: the orphan-charge
          // sweep below skips any booking that matched, so a drink sold to a
          // guest with a reservation was counted by nobody.
          additionalCharges, additionalChargesTotal,
          grandTotal: depositAmount + additionalChargesTotal,
        }
      }

      const rawPaymentEvents = parsePaymentEvents(specialReq)
      const paymentEvents = rawPaymentEvents.map((e) => ({
        ...e,
        staffId: staffIdSet.has(e.staffId) ? staffId : e.staffId,
      }))

      let legacyAmountPaid: number | undefined
      let legacyPaymentStatus: 'full' | 'part' | 'pending' | undefined
      if (paymentEvents.length === 0) {
        const pdMatch = (specialReq as string).match(/<!-- PAYMENT_DATA:(.*?) -->/)
        if (pdMatch?.[1]) {
          try {
            const pd = JSON.parse(pdMatch[1])
            legacyPaymentStatus = (pd.paymentStatus || 'pending') as 'full' | 'part' | 'pending'
            // A batch-wide figure stamped on every room booked in one sitting
            // is prorated back down to this room; anything else is already
            // this room's own number.
            legacyAmountPaid = proratedLegacyPayment(b.id, effectivePrice) ?? (Number(pd.amountPaid) || 0)
          } catch { /* ignore */ }
        }
        if (!legacyAmountPaid) legacyAmountPaid = Number(b.amountPaid ?? b.amount_paid ?? 0) || 0
        if (!legacyPaymentStatus) legacyPaymentStatus = (b.paymentStatus || b.payment_status || 'pending') as 'full' | 'part' | 'pending'
      }

      // Old rows that record no payment at all, on a stay that has FINISHED:
      // the guest left, so they paid. A stay still in progress gets no such
      // benefit of the doubt — that is money nobody has collected yet.
      if (paymentEvents.length === 0 && legacyPaymentStatus === 'pending' && !legacyAmountPaid && !checkInById && !checkOutById && b.status === 'checked-out') {
        legacyPaymentStatus = 'full'
      }

      const staffAttributedRevenue = computeStaffAttributedRevenue(
        paymentEvents, staffId, effectivePrice, creatorId,
        checkOutById, checkInById, legacyAmountPaid, legacyPaymentStatus,
        { from, to }, b.status
      )

      // Payment methods across ALL stages (booking deposit + check-in balance
      // + check-out). When the guest paid different stages with different
      // methods, surface each method with its collected amount so the revenue
      // tables and per-method totals reflect what was actually taken.
      const methodTotals = aggregateMethodTotals(rawPaymentEvents)
        .map((t) => ({ method: normalizePaymentMethod(t.method), amount: t.amount }))
        .filter((t) => t.method)
      const eventPrimaryMethod = methodTotals.length > 0
        ? methodTotals.reduce((a, s) => (s.amount > a.amount ? s : a)).method
        : ''
      const eventSplits = methodTotals.length > 1 ? methodTotals : undefined

      const attributedByMethod = computeStaffAttributedByMethod(
        paymentEvents, staffId, effectivePrice, creatorId,
        eventPrimaryMethod || normalizePaymentMethod(primaryMethod),
        checkOutById, checkInById, legacyAmountPaid, legacyPaymentStatus, b.status
      )

      return {
        id: b.id, guestName, roomNumber: room?.roomNumber || '—',
        checkIn: b.checkIn, checkOut: b.checkOut, totalPrice: rawPrice,
        discountAmount: discountAmt, effectivePrice, staffAttributedRevenue,
        attributedByMethod,
        isDeposit: false, depositAmount: 0, status: b.status,
        createdAt: b.createdAt || b.created_at || '', createdBy: creatorId,
        checkInBy: checkInById, checkInByName: b.checkInByName || b.check_in_by_name || '',
        checkOutBy: checkOutById, checkOutByName: b.checkOutByName || b.check_out_by_name || '',
        paymentMethod: eventPrimaryMethod || normalizePaymentMethod(primaryMethod),
        paymentSplits: eventSplits || paymentSplits,
        additionalCharges, additionalChargesTotal,
        grandTotal: effectivePrice + additionalChargesTotal,
      }
    })
    // A deposit row only belongs on this staff member's report when they
    // actually collected part of it. Keeping every deposit row regardless of
    // attribution is what put other people's bookings on this report.
    .filter((b) => b.staffAttributedRevenue > 0 || (!b.isDeposit && b.effectivePrice === 0))

  const matchedIds = new Set(matched.map((b) => b.id))
  const orphanCharges: ChargeLineSummary[] = []
  for (const [bookingId, charges] of chargesByBookingId.entries()) {
    if (matchedIds.has(bookingId)) continue
    for (const c of charges) {
      if (!isThisStaff(c.createdBy || c.created_by, '')) continue
      const createdAt = c.createdAt || c.created_at || ''
      if (!createdAt) continue
      const d = new Date(createdAt)
      if (d >= from && d <= to) {
        orphanCharges.push({
          id: c.id, description: c.description || '', category: c.category || 'other',
          quantity: Number(c.quantity || 1), unitPrice: Number(c.unitPrice || c.unit_price || 0),
          amount: Number(c.amount || 0),
          paymentMethod: normalizePaymentMethod(c.paymentMethod || c.payment_method || decodeChargePaymentMethod(c.notes)),
          createdAt,
        })
      }
    }
  }
  const orphanChargesTotal = orphanCharges.reduce((s, c) => s + c.amount, 0)

  const standaloneSales = (shared.standaloneSales || []).filter(s => {
    const sid = s.staffId || (s as any).staffId || (s as any).staff_id || ''
    const sd = s.saleDate || (s as any).sale_date || ''
    return staffIdSet.has(sid) && sd >= weekStart && sd <= weekEnd
  })
  const standaloneSalesRevenue = standaloneSales.reduce((s, sale) => s + sale.amount, 0)

  const totalRevenue = matched.reduce((s, b) => s + b.staffAttributedRevenue, 0)
  const additionalRevenue = matched.reduce((s, b) => s + b.additionalChargesTotal, 0) + orphanChargesTotal
  const grandRevenue = totalRevenue + additionalRevenue + standaloneSalesRevenue

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
    bookings: matched, totalRevenue, additionalRevenue, standaloneSalesRevenue,
    grandRevenue, bookingCount: matched.length, standaloneSales, chargesByCategory,
    orphanCharges, orphanChargesTotal,
  }
}

export interface CompanyBookingRow {
  id: string
  guestName: string
  roomNumber: string
  checkIn: string
  checkOut: string
  status: string
  isDeposit: boolean
  /** Revenue from this booking in the period, across everyone who collected it. */
  amount: number
  /** That amount split by the method it came in on. */
  byMethod: Record<string, number>
  /** Who collected it, in the order they appear. */
  collectedBy: string[]
}

export interface CompanyPeriodRevenue {
  roomRevenue: number
  additionalRevenue: number
  standaloneSalesRevenue: number
  /**
   * Charges and sales that record no staff at all.
   *
   * Per-staff figures cannot show this money — there is nobody to show it
   * against — but it is money the hotel took, so the company total must carry
   * it. Leaving it out meant the analytics page counted it while the revenue
   * reports did not.
   */
  unassignedRevenue: number
  grandRevenue: number
  bookingCount: number
  /** Per-staff detail, keyed by the canonical staff id, so a total can be explained. */
  byStaff: Array<{ staffId: string; staffName: string; grandRevenue: number }>
  /** One row per booking, merged across staff — what the breakdown tables show. */
  bookings: CompanyBookingRow[]
}

/**
 * Every staff identity that could hold revenue in this data, canonicalised.
 *
 * One person can appear as a staff-table id, an auth user id, or just a name on
 * a booking. They are collapsed to a single id so summing per staff cannot
 * count the same money twice under two spellings of the same person.
 */
function collectStaffIdentities(shared: StaffRevenueSharedData): Array<{ id: string; name: string }> {
  const canonicalOf = new Map<string, string>()
  const nameOf = new Map<string, string>()

  for (const s of (shared.staffRows || [])) {
    const rowId = s.id || ''
    const userId = s.userId || s.user_id || ''
    const canonical = userId || rowId
    if (!canonical) continue
    if (rowId) canonicalOf.set(rowId, canonical)
    if (userId) canonicalOf.set(userId, canonical)
    const name = (s.name || s.staffName || s.staff_name || '').trim()
    const email = (s.email || '').trim()
    if (name) canonicalOf.set(name.toLowerCase(), canonical)
    if (email) canonicalOf.set(email.toLowerCase(), canonical)
    nameOf.set(canonical, name || email || canonical)
  }

  const add = (rawId: string, rawName: string) => {
    const id = (rawId || '').trim()
    const name = (rawName || '').trim()
    const canonical = canonicalOf.get(id) || canonicalOf.get(name.toLowerCase()) || id || name
    if (!canonical) return
    if (id) canonicalOf.set(id, canonical)
    if (name) canonicalOf.set(name.toLowerCase(), canonical)
    if (!nameOf.has(canonical)) nameOf.set(canonical, name || canonical)
  }

  for (const b of (shared.bookings || [])) {
    add(b.createdBy || b.created_by || '', b.createdByName || b.created_by_name || '')
    add(b.checkInBy || b.check_in_by || '', b.checkInByName || b.check_in_by_name || '')
    add(b.checkOutBy || b.check_out_by || '', b.checkOutByName || b.check_out_by_name || '')
    for (const e of parsePaymentEvents(b.special_requests || b.specialRequests || '')) {
      add(e.staffId || '', e.staffName || '')
    }
  }
  for (const c of (shared.chargesRaw || [])) add(c.createdBy || c.created_by || '', '')
  for (const sale of (shared.standaloneSales || [])) add((sale as any).staffId || (sale as any).staff_id || '', (sale as any).staffName || '')

  const seen = new Set<string>()
  const out: Array<{ id: string; name: string }> = []
  for (const canonical of new Set(canonicalOf.values())) {
    if (seen.has(canonical)) continue
    seen.add(canonical)
    out.push({ id: canonical, name: nameOf.get(canonical) || canonical })
  }
  return out
}

/**
 * Company-wide revenue for any date range, on exactly the same rules as the
 * per-staff figures — because it IS the per-staff figures, summed.
 *
 * Analytics used to compute its own totals from a different set of rules, so
 * the number on the dashboard could not be reconciled with the number on
 * anyone's revenue report. Deriving both from one calculation removes the
 * question: the company total is what the staff totals add up to.
 */
export function calculateCompanyPeriodRevenue(
  from: string,
  to: string,
  shared: StaffRevenueSharedData
): CompanyPeriodRevenue {
  const totals: CompanyPeriodRevenue = {
    roomRevenue: 0, additionalRevenue: 0, standaloneSalesRevenue: 0,
    unassignedRevenue: 0, grandRevenue: 0, bookingCount: 0, byStaff: [], bookings: [],
  }
  const round = (n: number) => Math.round(n * 100) / 100
  const merged = new Map<string, CompanyBookingRow>()

  for (const staff of collectStaffIdentities(shared)) {
    const r = calculateStaffWeekResultInternal(staff.id, from, to, shared)
    if (r.grandRevenue === 0 && r.bookingCount === 0) continue
    totals.roomRevenue += r.totalRevenue
    totals.additionalRevenue += r.additionalRevenue
    totals.standaloneSalesRevenue += r.standaloneSalesRevenue
    totals.grandRevenue += r.grandRevenue
    totals.bookingCount += r.bookingCount
    totals.byStaff.push({ staffId: staff.id, staffName: staff.name, grandRevenue: round(r.grandRevenue) })

    // A booking two people collected money on appears once, holding both shares.
    for (const b of r.bookings) {
      const row = merged.get(b.id) || {
        id: b.id, guestName: b.guestName, roomNumber: b.roomNumber,
        checkIn: b.checkIn, checkOut: b.checkOut, status: b.status,
        isDeposit: b.isDeposit, amount: 0, byMethod: {}, collectedBy: [],
      }
      row.amount = round(row.amount + b.staffAttributedRevenue)
      for (const [method, amount] of Object.entries(b.attributedByMethod || {})) {
        row.byMethod[method] = round((row.byMethod[method] || 0) + amount)
      }
      if (b.staffAttributedRevenue > 0 && !row.collectedBy.includes(staff.name)) row.collectedBy.push(staff.name)
      merged.set(b.id, row)
    }
  }
  totals.bookings = [...merged.values()].sort((a, b) => b.amount - a.amount)

  // Money with no staff on it. Anything carrying a staff id has already been
  // counted above — collectStaffIdentities picks creators up from the charges
  // and sales themselves — so only the blank ones are still missing.
  const inPeriod = (raw: string) => {
    const day = (raw || '').slice(0, 10)
    return !!day && day >= from && day <= to
  }
  for (const c of (shared.chargesRaw || [])) {
    if (c.createdBy || c.created_by) continue
    if (!inPeriod(c.createdAt || c.created_at)) continue
    totals.unassignedRevenue += Number(c.amount) || 0
  }
  for (const sale of (shared.standaloneSales || [])) {
    if ((sale as any).staffId || (sale as any).staff_id) continue
    if (!inPeriod((sale as any).saleDate || (sale as any).sale_date || '')) continue
    totals.unassignedRevenue += Number((sale as any).amount) || 0
  }
  totals.grandRevenue += totals.unassignedRevenue

  totals.roomRevenue = round(totals.roomRevenue)
  totals.additionalRevenue = round(totals.additionalRevenue)
  totals.standaloneSalesRevenue = round(totals.standaloneSalesRevenue)
  totals.unassignedRevenue = round(totals.unassignedRevenue)
  totals.grandRevenue = round(totals.grandRevenue)
  totals.byStaff.sort((a, b) => b.grandRevenue - a.grandRevenue)
  return totals
}

/**
 * Fetch all confirmed/checked-in/checked-out bookings created by a specific staff member
 * within a given week. Also fetches booking charges and standalone sales.
 */
export async function fetchBookingsForStaffWeek(
  staffId: string,
  weekStart: string,
  weekEnd: string
): Promise<StaffWeekResult> {
  try {
    const [bookings, properties, guests, chargesRaw, staffRows, standaloneSales] = await Promise.all([
      db.bookings.listAll(),
      db.properties.listAll(),
      db.guests.listAll(),
      db.bookingCharges.listAll().catch(() => []),
      db.staff.listAll().catch(() => []),
      standaloneSalesService.getAllSales().catch(() => []),
    ])
    const shared: StaffRevenueSharedData = { bookings, properties, guests, chargesRaw, staffRows, standaloneSales }
    return calculateStaffWeekResultInternal(staffId, weekStart, weekEnd, shared)
  } catch (e) {
    console.warn('[fetchBookingsForStaffWeek] error:', e)
    return {
      bookings: [], totalRevenue: 0, additionalRevenue: 0, standaloneSalesRevenue: 0,
      grandRevenue: 0, bookingCount: 0, standaloneSales: [], chargesByCategory: {},
      orphanCharges: [], orphanChargesTotal: 0,
    }
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
  // Fetch all and filter client-side — wrapper's where-filter is unreliable for custom tables
  let allRows: WeeklyRevenueReport[] = []
  try {
    const rows = await db.hr_weekly_revenue.listAll()
    allRows = (rows || []) as WeeklyRevenueReport[]
  } catch (e) {
    console.warn('[getOrCreateWeekReport] list failed (table may not exist yet):', e)
  }

  // Build a set of all IDs that identify this staff member (auth UUID + staff table row ID)
  // so we match existing reports regardless of which ID variant was used when saving.
  const staffIdSet = new Set<string>([staffId])
  try {
    const staffRows: any[] = await db.staff.listAll().catch(() => [])
    for (const s of staffRows) {
      const sid = s.id || ''
      const uid = s.userId || s.user_id || ''
      if (sid === staffId || uid === staffId) {
        if (sid) staffIdSet.add(sid)
        if (uid) staffIdSet.add(uid)
      }
    }
  } catch { /* ignore */ }

  const existing = allRows.find(
    (r) => {
      const sid = (r as any).staffId || (r as any).staff_id || ''
      const ws  = (r as any).weekStart || (r as any).week_start || ''
      return staffIdSet.has(sid) && ws === week.weekStart && r.status !== 'init'
    }
  )

  // Always recalculate from live bookings so counts/revenue stay accurate.
  // Persist the GRAND figure (rooms + charges + standalone sales): it is what
  // the report shows while it is a draft, and submitting freezes whatever was
  // stored here — storing rooms-only made a week's headline number drop the
  // moment staff submitted it.
  const { bookings, grandRevenue, bookingCount } = await fetchBookingsForStaffWeek(
    staffId,
    week.weekStart,
    week.weekEnd
  )
  const totalRevenue = grandRevenue
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
  await db.hr_weekly_revenue.update(reportId, {
    status: 'reviewed',
    adminNotes,
    reviewedBy: reviewedByName,
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

export interface HRWeekData {
  reports: WeeklyRevenueReport[]
  results: Record<string, StaffWeekResult>
}

/** Get all staff reports for a specific week (admin view). */
export async function getAllStaffReportsForWeek(weekStart: string): Promise<HRWeekData> {
  const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')
  try {
    // Hotel time, as above — the same week wherever the page is opened.
    const from = new Date(weekStart + 'T00:00:00Z')
    const to = new Date(weekEnd + 'T23:59:59.999Z')

    const [rows, bookings, properties, guests, chargesRaw, allStaff, standaloneSales] = await Promise.all([
      db.hr_weekly_revenue.listAll(),
      db.bookings.listAll(), // Increased limit for data parity
      db.properties.listAll(),
      db.guests.list({ limit: 2000 }),
      db.bookingCharges.listAll().catch(() => []),
      db.staff.listAll().catch(() => []),
      standaloneSalesService.getAllSales().catch(() => []),
    ])

    const shared: StaffRevenueSharedData = {
      bookings, properties, guests, chargesRaw, staffRows: allStaff, standaloneSales
    }

    // Map IDs to canonical staff IDs
    const anyIdToCanonical = new Map<string, string>()
    const anyNameToCanonical = new Map<string, string>()
    const canonicalToName = new Map<string, string>()

    for (const s of (allStaff || [])) {
      const canonical = s.id || ''
      if (!canonical) continue
      const rowId = s.id
      const authId = s.userId || s.user_id
      const semail = s.email || ''
      const sname = s.name || s.staffName || s.staff_name || ''

      if (rowId) anyIdToCanonical.set(rowId, canonical)
      if (authId) anyIdToCanonical.set(authId, canonical)
      if (semail) anyNameToCanonical.set(semail.trim().toLowerCase(), canonical)
      if (sname)  anyNameToCanonical.set(sname.trim().toLowerCase(),  canonical)
      if (sname)  canonicalToName.set(canonical, sname)
    }

    // Saved reports for this week
    const rawSavedReports: WeeklyRevenueReport[] = ((rows || []) as WeeklyRevenueReport[]).filter((r) => {
      const ws = (r as any).weekStart || (r as any).week_start || ''
      return ws === weekStart && r.status !== 'init'
    })

    const statusPriority: Record<string, number> = { reviewed: 3, submitted: 2, draft: 1 }
    const savedByCanonical = new Map<string, WeeklyRevenueReport>()
    for (const r of rawSavedReports) {
      const raw = (r as any).staffId || (r as any).staff_id || ''
      const canonical = anyIdToCanonical.get(raw) || raw
      const existing = savedByCanonical.get(canonical)
      if (!existing || (statusPriority[r.status] || 0) > (statusPriority[existing.status] || 0)) {
        savedByCanonical.set(canonical, r)
      }
    }
    const savedStaffIds = new Set(savedByCanonical.keys())

    // Find unsaved staff with activity
    const unsavedStaff = new Map<string, string>() // canonical staffId → staffName
    for (const b of (bookings || []) as any[]) {
      const status = b.status || ''
      const specialReq = b.special_requests || b.specialRequests || ''
      const events = parsePaymentEvents(specialReq)
      let inWeek = false

      // 1. Payment events in week
      if (events.some(e => {
        const d = new Date(e.paidAt)
        return d >= from && d <= to
      })) {
        inWeek = true
      } 
      // 2. Check-in in week (revenue attribution by hotel-night).
      // Mirrors the same rule used in calculateStaffWeekResultInternal — see
      // that function for the rationale (avoid double-counting boundary stays).
      else if (['checked-in', 'checked-out'].includes(status)) {
        const ciStr = b.checkIn || b.check_in || ''
        const ci = ciStr ? new Date(ciStr) : null
        inWeek = !!(ci && ci >= from && ci <= to)
      }
      // 3. Deposits for confirmed bookings
      else if (status === 'confirmed') {
        const createdAt = b.createdAt || b.created_at || ''
        if (createdAt) {
          const d = new Date(createdAt)
          if (d >= from && d <= to && (specialReq.includes('PAYMENT_DATA') || specialReq.includes('PAYMENT_EVENTS'))) {
            inWeek = true
          }
        }
      }

      if (!inWeek) continue

      const staffFields = [
        { id: b.createdBy || b.created_by || '', name: b.createdByName || b.created_by_name || '' },
        { id: b.checkInBy || b.check_in_by || '', name: b.checkInByName || b.check_in_by_name || '' },
        { id: b.checkOutBy || b.check_out_by || '', name: b.checkOutByName || b.check_out_by_name || '' },
      ]
      for (const { id, name } of staffFields) {
        let canonical: string | undefined
        if (id) {
          canonical = anyIdToCanonical.get(id) || id
        } else if (name) {
          canonical = anyNameToCanonical.get(name.trim().toLowerCase())
        }
        if (!canonical) continue
        if (!savedStaffIds.has(canonical) && !unsavedStaff.has(canonical)) {
          unsavedStaff.set(canonical, name || id)
        }
      }
    }

    const now = new Date().toISOString()
    const allFinalReports: WeeklyRevenueReport[] = []
    const results: Record<string, StaffWeekResult> = {}

    // Process SAVED reports
    for (const r of savedByCanonical.values()) {
      const live = calculateStaffWeekResultInternal(r.staffId, weekStart, weekEnd, shared)
      results[r.id] = live
      if (r.status === 'draft') {
        allFinalReports.push({
          ...r,
          totalRevenue: live.grandRevenue,
          bookingCount: live.bookingCount,
        })
      } else {
        allFinalReports.push(r)
      }
    }

    // Process SYNTHETIC reports
    for (const [staffId, staffName] of unsavedStaff) {
      const live = calculateStaffWeekResultInternal(staffId, weekStart, weekEnd, shared)
      const resolvedName = canonicalToName.get(staffId)
        || (staffName !== staffId ? staffName : '')
        || `Staff (${staffId.slice(0, 8)}…)`
      const id = `synthetic_${staffId}_${weekStart}`
      results[id] = live
      allFinalReports.push({
        id,
        staffId,
        staffName: resolvedName,
        weekStart,
        weekEnd,
        totalRevenue: live.grandRevenue,
        bookingCount: live.bookingCount,
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

    return {
      reports: allFinalReports.sort((a, b) => b.totalRevenue - a.totalRevenue),
      results
    }
  } catch (e) {
    console.warn('[getAllStaffReportsForWeek] failed:', e)
    return { reports: [], results: {} }
  }
}

/** Get a staff member's own report history, newest first. */
export async function getStaffAllReports(staffId: string): Promise<WeeklyRevenueReport[]> {
  try {
    const rows = await db.hr_weekly_revenue.listAll()
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
