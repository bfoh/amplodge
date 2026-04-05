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
  paymentStatus?: 'full' | 'part' | 'pending'
): number {
  if (events.length === 0) {
    // Legacy booking — derive from stored amountPaid / paymentStatus
    const status = paymentStatus || 'pending'
    const paid = amountPaidAtBooking ?? 0

    // How much the booking creator collected
    const creatorAmount = status === 'full'
      ? effectivePrice
      : status === 'part'
        ? paid
        : 0 // pending = nothing collected at booking time

    if (createdBy === staffId) return creatorAmount

    // Remaining balance collected by check-in or check-out staff
    const remainder = Math.max(0, effectivePrice - creatorAmount)
    if (remainder > 0) {
      // Prefer checkInBy as the next attributee; fall back to checkOutBy
      const collector = checkInBy || checkOutBy || ''
      if (collector === staffId) return remainder
    }
    return 0
  }

  // Modern booking with recorded PaymentEvents
  const directAmount = events
    .filter((e) => e.staffId === staffId)
    .reduce((sum, e) => sum + e.amount, 0)

  // Gap = effectivePrice not yet covered by any recorded payment event
  const coveredTotal = events.reduce((sum, e) => sum + e.amount, 0)
  const gap = Math.max(0, effectivePrice - coveredTotal)

  // The checkout staff collects any remaining balance at departure
  const gapAmount = gap > 0 && checkOutBy === staffId ? gap : 0

  return directAmount + gapAmount
}
