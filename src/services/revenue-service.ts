/**
 * Weekly Revenue Service
 * Handles per-staff weekly revenue tracking based on bookings they created.
 * Week boundaries: Monday 00:00 → Sunday 23:59 (ISO week, weekStartsOn: 1)
 *
 * Grand revenue = room prices + booking charges + standalone sales.
 */

import { blink } from '@/blink/client'
import { startOfWeek, endOfWeek, format, subWeeks } from 'date-fns'
import { standaloneSalesService, type StandaloneSale } from './standalone-sales-service'
import { CHARGE_CATEGORIES } from './booking-charges-service'

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
  status: string
  createdAt: string
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

  const matched: BookingSummary[] = ((allBookings || []) as any[])
    .filter((b: any) => {
      const creator = b.createdBy || b.created_by || ''
      if (creator !== staffId) return false
      if (!['checked-in', 'checked-out'].includes(b.status)) return false
      const checkIn = b.checkIn || b.check_in || ''
      if (!checkIn) return false
      const d = new Date(checkIn)
      return d >= from && d <= to
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
      // Use finalAmount (post-discount amount stored at check-in) when available,
      // otherwise derive from rawPrice - discountAmt.
      // Note: blink.db converts snake_case columns (final_amount, discount_amount)
      // to camelCase so b.finalAmount / b.discountAmount are the canonical fields.
      const storedFinal = b.finalAmount ?? b.final_amount
      const effectivePrice = (storedFinal != null && storedFinal !== '')
        ? Math.max(0, Number(storedFinal))
        : discountAmt > 0
          ? Math.max(0, rawPrice - discountAmt)
          : rawPrice

      if (discountAmt > 0 || (storedFinal != null && storedFinal !== '')) {
        console.log('[revenue-service] discount booking', b.id, {
          rawPrice, discountAmt, storedFinal, effectivePrice,
          finalAmountKey: b.finalAmount, discountKey: b.discountAmount,
        })
      }

      return {
        id: b.id,
        guestName,
        roomNumber: room?.roomNumber || '—',
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        totalPrice: rawPrice,
        discountAmount: discountAmt,
        effectivePrice,
        status: b.status,
        createdAt: b.createdAt || b.created_at || '',
        paymentMethod: normalizePaymentMethod(primaryMethod),
        paymentSplits,
        additionalCharges,
        additionalChargesTotal,
        grandTotal: effectivePrice + additionalChargesTotal,
      }
    })

  // ── Orphan charges ────────────────────────────────────────────────────────
  // Charges created THIS WEEK on bookings owned by this staff member whose
  // check-in date falls outside this week (not already covered by `matched`).
  const matchedIds = new Set(matched.map((b) => b.id))
  // All booking IDs owned by this staff member (any date)
  const allStaffBookingIds = new Set(
    ((allBookings || []) as any[])
      .filter((b: any) => (b.createdBy || b.created_by || '') === staffId)
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

  const totalRevenue = matched.reduce((s, b) => s + b.effectivePrice, 0)  // after-discount room revenue
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
  try {
    const rows = await db.hr_weekly_revenue.list({ limit: 500 })
    return ((rows || []) as WeeklyRevenueReport[])
      .filter((r) => {
        const ws = (r as any).weekStart || (r as any).week_start || ''
        return ws === weekStart && r.status !== 'init'
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
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
