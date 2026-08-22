/**
 * Payment Events — per-stage revenue attribution
 *
 * Each time a guest makes a payment (at reservation, check-in, or check-out)
 * a PaymentEvent is appended to the booking's specialRequests field as a
 * machine-readable comment:
 *
 *   <!-- PAYMENT_EVENTS:[{"stage":"booking","amount":200,...},{"stage":"checkin",...}] -->
 *
 * This requires no DB schema change and is backward-compatible with existing
 * bookings (which will fall back to legacy amountPaid-based attribution).
 */

export interface PaymentEvent {
  stage: 'booking' | 'checkin' | 'checkout'
  amount: number                                         // amount collected at this stage
  staffId: string
  staffName: string
  method: string                                         // primary method
  splits?: Array<{ method: string; amount: number }>    // multi-method detail
  paidAt: string                                         // ISO timestamp
}

/** Parse all PaymentEvents from a booking's specialRequests string. */
export function parsePaymentEvents(specialRequests: string | undefined | null): PaymentEvent[] {
  if (!specialRequests) return []
  const match = specialRequests.match(/<!-- PAYMENT_EVENTS:(.*?) -->/)
  if (!match?.[1]) return []
  try {
    const parsed = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Append (or replace) a PaymentEvent for the given stage in a specialRequests string.
 * If an event for that stage already exists it is replaced.
 * Returns the updated specialRequests string.
 */
export function appendPaymentEvent(
  specialRequests: string | undefined | null,
  event: PaymentEvent
): string {
  const existing = parsePaymentEvents(specialRequests)
  // Replace if same stage already recorded (idempotent)
  const updated = [...existing.filter((e) => e.stage !== event.stage), event]
  const comment = `<!-- PAYMENT_EVENTS:${JSON.stringify(updated)} -->`
  // Strip the old PAYMENT_EVENTS comment, then append the new one
  const base = (specialRequests || '').replace(/<!-- PAYMENT_EVENTS:.*? -->/, '').trim()
  return base ? `${base}\n\n${comment}` : comment
}

/**
 * Build a booking-stage PaymentEvent from OnsiteBookingPage values.
 * Returns null when nothing was paid at booking (paymentType === 'pending').
 */
export function buildBookingPaymentEvent(opts: {
  paymentType: 'full' | 'part' | 'pending'
  amount: number
  staffId: string
  staffName: string
  method: string
  splits?: Array<{ method: string; amount: number }>
}): PaymentEvent | null {
  if (opts.paymentType === 'pending' || opts.amount <= 0) return null
  return {
    stage: 'booking',
    amount: opts.amount,
    staffId: opts.staffId,
    staffName: opts.staffName,
    method: opts.method,
    splits: opts.splits,
    paidAt: new Date().toISOString(),
  }
}

/**
 * Build a check-in stage PaymentEvent.
 * Returns null when nothing was collected at check-in.
 */
export function buildCheckInPaymentEvent(opts: {
  amount: number
  staffId: string
  staffName: string
  method: string
  splits?: Array<{ method: string; amount: number }>
}): PaymentEvent | null {
  if (opts.amount <= 0) return null
  return {
    stage: 'checkin',
    amount: opts.amount,
    staffId: opts.staffId,
    staffName: opts.staffName,
    method: opts.method,
    splits: opts.splits,
    paidAt: new Date().toISOString(),
  }
}

/**
 * Build a check-out stage PaymentEvent.
 * Returns null when nothing was collected at check-out.
 */
export function buildCheckOutPaymentEvent(opts: {
  amount: number
  staffId: string
  staffName: string
  method: string
  splits?: Array<{ method: string; amount: number }>
}): PaymentEvent | null {
  if (opts.amount <= 0) return null
  return {
    stage: 'checkout',
    amount: opts.amount,
    staffId: opts.staffId,
    staffName: opts.staffName,
    method: opts.method,
    splits: opts.splits,
    paidAt: new Date().toISOString(),
  }
}

export interface MethodTotal { method: string; amount: number }

/**
 * Aggregate per-method amounts across all recorded payment events.
 * Splits-aware: an event with splits contributes each split separately.
 * Methods are returned in payment order (booking → checkin → checkout),
 * with amounts merged per method.
 */
export function aggregateMethodTotals(events: PaymentEvent[]): MethodTotal[] {
  const stageOrder: Record<string, number> = { booking: 0, checkin: 1, checkout: 2 }
  const totals = new Map<string, number>()
  const sorted = [...events].sort(
    (a, b) => (stageOrder[a.stage] ?? 3) - (stageOrder[b.stage] ?? 3)
  )
  for (const e of sorted) {
    const parts = e.splits && e.splits.length > 0
      ? e.splits
      : [{ method: e.method, amount: e.amount }]
    for (const p of parts) {
      if (!p.method || !(Number(p.amount) > 0)) continue
      totals.set(p.method, (totals.get(p.method) || 0) + Number(p.amount))
    }
  }
  return [...totals.entries()].map(([method, amount]) => ({ method, amount }))
}

/** Short display name for a payment method key. */
export function displayMethodName(method: string): string {
  const s = (method || '').trim().toLowerCase()
  if (!s) return ''
  if (s === 'cash') return 'Cash'
  if (s === 'mobile_money' || s === 'mobile money' || s.includes('momo') || s.includes('mobile')) return 'Momo'
  if (s.includes('card') || s.includes('credit') || s.includes('debit')) return 'Card'
  if (s === 'not_paid' || s === 'not paid') return 'Not Paid'
  return method.charAt(0).toUpperCase() + method.slice(1)
}

/**
 * Human label describing every method the guest actually paid with, in
 * payment order — e.g. "Cash", or "Momo + Cash" when a part payment at
 * booking was completed with a different method at check-in.
 * Returns '' when no payment events are recorded (caller falls back to the
 * booking's paymentMethod column).
 */
export function formatMethodsLabel(events: PaymentEvent[]): string {
  return aggregateMethodTotals(events)
    .map((t) => displayMethodName(t.method))
    .filter(Boolean)
    .join(' + ')
}

/**
 * Given a list of PaymentEvents and an effective price, compute how much
 * revenue is attributed to a specific staff member.
 *
 * Rules:
 * Cash basis: only money that has actually been collected counts. A guest who
 * is still in the room owing part of the bill is not revenue for anybody yet —
 * crediting that balance to the check-in staff inflated what each person looked
 * to have taken. The one exception is a COMPLETED check-out: a guest does not
 * leave owing money, so an uncovered balance on a checked-out stay is treated as
 * settled at the desk and credited to whoever checked them out.
 *
 * - If there are recorded PaymentEvents, sum events where event.staffId === staffId.
 * - If there are NO recorded events (legacy booking), use amountPaidAtBooking and
 *   paymentStatus to attribute only what the creator actually collected:
 *     · 'full'    → effectivePrice to creator
 *     · 'part'    → amountPaidAtBooking to creator
 *     · 'pending' → 0 to creator (nothing collected at booking)
 */
export function computeStaffAttributedRevenue(
  events: PaymentEvent[],
  staffId: string,
  effectivePrice: number,
  createdBy: string,
  checkOutBy?: string,
  checkInBy?: string,
  amountPaidAtBooking?: number,
  paymentStatus?: 'full' | 'part' | 'pending',
  dateRange?: { from: Date; to: Date },
  bookingStatus?: string
): number {
  // A stay that has finished has been settled; one still in progress has not.
  const settled = bookingStatus === 'checked-out'
  if (events.length === 0) {
    // Legacy booking — derive from stored amountPaid / paymentStatus
    const status = paymentStatus || 'pending'
    const paid = amountPaidAtBooking ?? 0

    // 1. Booking creator gets what was collected at booking time
    const creatorAmount = status === 'full'
      ? effectivePrice
      : status === 'part'
        ? paid
        : 0 // pending = nothing collected at booking time

    // 2. Remaining balance counts only once the guest has actually left, when
    // it must have been settled at the desk. It goes to the staff who handled
    // the departure, falling back to the creator so it is never unowned —
    // company-wide totals sum these per-staff figures (HRPage).
    const remainder = settled ? Math.max(0, effectivePrice - creatorAmount) : 0
    const checkInStaff = checkOutBy || checkInBy || createdBy

    let attributed = 0
    
    // For legacy bookings, we don't have event timestamps. 
    // To ensure consistency, if a dateRange is provided, we only attribute if the booking falls in or near the range.
    // However, the safest for reports is to attribute the full amount if no range, 
    // or use the booking's presence in the week as a filter (handled in revenue-service).
    if (createdBy === staffId) attributed += creatorAmount
    if (remainder > 0 && checkInStaff === staffId) attributed += remainder
    
    return attributed
  }

  // Modern booking with recorded PaymentEvents
  let attributed = 0
  const coveredTotal = events.reduce((sum, e) => sum + e.amount, 0)

  // A booking can never earn more than it is worth. When a discount is applied
  // AFTER money was collected — the guest pays GHS 700 up front, reception
  // discounts the stay to GHS 350 at check-in — the events still add up to the
  // pre-discount figure, and crediting them whole reports revenue the hotel
  // does not have. Scale every event down by the same factor so the shares
  // still add up to what the booking is actually worth.
  const overshoot = coveredTotal > effectivePrice && coveredTotal > 0
  const scale = overshoot ? effectivePrice / coveredTotal : 1

  for (const e of events) {
    // If date range is provided, only count events in that range
    if (dateRange) {
      const eventDate = new Date(e.paidAt)
      if (eventDate < dateRange.from || eventDate > dateRange.to) continue
    }

    if (e.stage === 'booking') {
      // Booking stage events go to whoever recorded them (usually creator)
      if (e.staffId === staffId) attributed += e.amount * scale
    } else {
      // checkin or checkout stage events go to the staff member who recorded the event
      // If the event staff is missing, fallback to checkInBy or checkOutBy
      const eventStaff = e.staffId || checkInBy || checkOutBy || ''
      if (eventStaff === staffId) attributed += e.amount * scale
    }
  }

  // An unrecorded balance counts only on a completed check-out, where the guest
  // has left and therefore settled. While the guest is still in the room it is
  // money nobody has collected, and counting it credited staff with revenue the
  // hotel did not hold.
  const gap = settled ? Math.max(0, effectivePrice - coveredTotal) : 0
  if (gap > 0) {
    const gapStaff = checkOutBy || checkInBy || createdBy
    if (gapStaff === staffId) attributed += gap
  }

  return Math.round(attributed * 100) / 100
}

/**
 * Per-payment-method totals of what THIS staff member collected on a booking.
 *
 * Same rules as computeStaffAttributedRevenue — only this staff's events count,
 * and a post-payment discount scales them down — but kept split by method so a
 * payment-method breakdown reports collections rather than raw booking totals.
 * Any unrecorded balance credited to this staff lands under `fallbackMethod`
 * (the booking's own payment method), since no event names a method for it.
 */
export function computeStaffAttributedByMethod(
  events: PaymentEvent[],
  staffId: string,
  effectivePrice: number,
  createdBy: string,
  fallbackMethod: string,
  checkOutBy?: string,
  checkInBy?: string,
  amountPaidAtBooking?: number,
  paymentStatus?: 'full' | 'part' | 'pending',
  bookingStatus?: string
): Record<string, number> {
  const totals: Record<string, number> = {}
  const add = (method: string, amount: number) => {
    if (!(amount > 0)) return
    const key = method || fallbackMethod || ''
    if (!key) return
    totals[key] = Math.round(((totals[key] || 0) + amount) * 100) / 100
  }

  if (events.length === 0) {
    // Legacy booking — one figure, one method.
    add(fallbackMethod, computeStaffAttributedRevenue(
      events, staffId, effectivePrice, createdBy, checkOutBy, checkInBy, amountPaidAtBooking, paymentStatus,
      undefined, bookingStatus
    ))
    return totals
  }

  const coveredTotal = events.reduce((sum, e) => sum + e.amount, 0)
  const scale = coveredTotal > effectivePrice && coveredTotal > 0 ? effectivePrice / coveredTotal : 1

  for (const e of events) {
    const eventStaff = e.stage === 'booking'
      ? e.staffId
      : (e.staffId || checkInBy || checkOutBy || '')
    if (eventStaff !== staffId) continue

    const parts = e.splits && e.splits.length > 0
      ? e.splits
      : [{ method: e.method, amount: e.amount }]
    for (const p of parts) {
      add(p.method, Number(p.amount) * scale)
    }
  }

  const gap = bookingStatus === 'checked-out' ? Math.max(0, effectivePrice - coveredTotal) : 0
  if (gap > 0 && (checkOutBy || checkInBy || createdBy) === staffId) {
    add(fallbackMethod, gap)
  }

  return totals
}
