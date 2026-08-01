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
 * - If there are recorded PaymentEvents, sum events where event.staffId === staffId.
 *   Any gap between effectivePrice and total events is attributed to checkOutBy staff.
 * - If there are NO recorded events (legacy booking), use amountPaidAtBooking and
 *   paymentStatus to attribute only what the creator actually collected:
 *     · 'full'    → effectivePrice to creator
 *     · 'part'    → amountPaidAtBooking to creator
 *     · 'pending' → 0 to creator (nothing collected at booking)
 *   Any unattributed remainder goes to the checkout staff (checkOutBy), who collected
 *   it at departure — or to checkInBy if that field is populated and checkOutBy is not.
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
  dateRange?: { from: Date; to: Date }
): number {
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

    // 2. Remaining balance is credited to the check-in staff.
    // Fall back to the booking creator (not '') when no check-in/out staff is
    // recorded, so the balance is never dropped — company-wide totals sum these
    // per-staff figures (HRPage), and an unowned gap would silently undercount.
    const remainder = Math.max(0, effectivePrice - creatorAmount)
    const checkInStaff = checkInBy || checkOutBy || createdBy

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
  
  for (const e of events) {
    // If date range is provided, only count events in that range
    if (dateRange) {
      const eventDate = new Date(e.paidAt)
      if (eventDate < dateRange.from || eventDate > dateRange.to) continue
    }

    if (e.stage === 'booking') {
      // Booking stage events go to whoever recorded them (usually creator)
      if (e.staffId === staffId) attributed += e.amount
    } else {
      // checkin or checkout stage events go to the staff member who recorded the event
      // If the event staff is missing, fallback to checkInBy or checkOutBy
      const eventStaff = e.staffId || checkInBy || checkOutBy || ''
      if (eventStaff === staffId) attributed += e.amount
    }
  }

  // Any remaining gap (unrecorded balance) is attributed to the check-in staff,
  // falling back to the booking creator (not '') so it is never dropped from
  // company-wide totals that sum these per-staff figures.
  const gap = Math.max(0, effectivePrice - coveredTotal)
  if (gap > 0) {
    const gapStaff = checkInBy || checkOutBy || createdBy
    if (gapStaff === staffId) {
      // If dateRange is provided, we only count the gap if the booking was active this week.
      // Since the gap is unattributed, we include it to avoid "losing" revenue in the grand total.
      attributed += gap
    }
  }

  return attributed
}
