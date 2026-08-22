/**
 * Recording money collected against a booking after it was created.
 *
 * A booking's payments live in two places on the row: PAYMENT_EVENTS (one entry
 * per stage, carrying who collected it and how) and PAYMENT_DATA.amountPaid
 * (the running total check-out subtracts from the bill). Anything that takes
 * money mid-stay has to write both, or the money is invisible: staff revenue
 * reports read the events, and the balance owed reads amountPaid.
 *
 * Check-out used to write neither — it showed the outstanding balance, took the
 * cash, and recorded nothing. Revenue reporting papered over that by crediting
 * any uncovered balance to the check-out staff, which quietly turned unpaid
 * stays into revenue too.
 */

import { db } from '@/lib/db'
import {
  parsePaymentEvents,
  appendPaymentEvent,
  type PaymentEvent,
} from '@/lib/payment-events'

export interface RecordPaymentOptions {
  bookingId: string
  stage: PaymentEvent['stage']
  amount: number
  method: string
  splits?: Array<{ method: string; amount: number }>
  staffId: string
  staffName: string
  /** Pre-fetched booking row, when the caller already has it. */
  booking?: any
}

/** Room price the booking is actually worth, after any discount. */
function effectiveRoomPrice(booking: any): number {
  const gross = Number(booking?.totalPrice ?? booking?.total_price ?? 0) || 0
  const discount = Number(booking?.discountAmount ?? booking?.discount_amount ?? 0) || 0
  if (discount <= 0) return gross
  const stored = booking?.finalAmount ?? booking?.final_amount
  if (stored != null && stored !== '') return Math.max(0, Number(stored))
  return Math.max(0, gross - discount)
}

/**
 * Record money collected against a booking: appends the stage's PaymentEvent
 * and brings PAYMENT_DATA.amountPaid up to match.
 *
 * Re-recording the same stage replaces that stage's event rather than adding a
 * second one, so a retried check-out cannot double-count.
 */
export async function recordBookingPayment(opts: RecordPaymentOptions): Promise<void> {
  const amount = Math.round((Number(opts.amount) || 0) * 100) / 100
  if (amount <= 0) return

  const booking = opts.booking ?? await db.bookings.get(opts.bookingId)
  if (!booking) throw new Error(`recordBookingPayment: booking ${opts.bookingId} not found`)

  const specialReq: string = booking.special_requests || booking.specialRequests || ''
  const priorEvents = parsePaymentEvents(specialReq)

  const event: PaymentEvent = {
    stage: opts.stage,
    amount,
    staffId: opts.staffId || '',
    staffName: opts.staffName || '',
    method: opts.method || '',
    ...(opts.splits && opts.splits.length > 1 ? { splits: opts.splits } : {}),
    paidAt: new Date().toISOString(),
  }

  let updated = appendPaymentEvent(specialReq, event)

  // Keep amountPaid in step with the events.
  //
  // With events already on the row their total IS the amount paid, and using it
  // makes a replayed stage idempotent. Without them the row predates event
  // recording, and its stored figure is the only history there is — so add to
  // it rather than replacing it with this one payment.
  const pdMatch = updated.match(/<!-- PAYMENT_DATA:(.*?) -->/)
  let payment: any = { amountPaid: 0, paymentStatus: 'pending', perRoom: true }
  if (pdMatch?.[1]) {
    try {
      payment = { ...payment, ...JSON.parse(pdMatch[1]) }
    } catch { /* keep defaults */ }
  }

  const eventsTotal = parsePaymentEvents(updated).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const amountPaid = priorEvents.length > 0
    ? Math.round(eventsTotal * 100) / 100
    : Math.round(((Number(payment.amountPaid) || 0) + amount) * 100) / 100

  const roomPrice = effectiveRoomPrice(booking)
  const paymentStatus = roomPrice > 0 && amountPaid >= roomPrice ? 'full' : 'part'

  const comment = `<!-- PAYMENT_DATA:${JSON.stringify({ ...payment, amountPaid, paymentStatus, perRoom: true })} -->`
  updated = pdMatch
    ? updated.replace(/<!-- PAYMENT_DATA:.*? -->/, comment)
    : `${updated}\n\n${comment}`.trim()

  await db.bookings.update(opts.bookingId, { specialRequests: updated })
}

/**
 * What is still owed on a booking: its room price plus charges, less what has
 * already been paid. Used to prefill the amount collected at check-out.
 */
export function outstandingBalance(booking: any, chargesTotal: number = 0): number {
  const specialReq: string = booking?.special_requests || booking?.specialRequests || ''
  let paid = Number(booking?.amountPaid ?? 0) || 0
  if (!paid) {
    const m = specialReq.match(/<!-- PAYMENT_DATA:(.*?) -->/)
    if (m?.[1]) {
      try { paid = Number(JSON.parse(m[1]).amountPaid) || 0 } catch { /* ignore */ }
    }
  }
  const owed = effectiveRoomPrice(booking) + (Number(chargesTotal) || 0) - paid
  return Math.max(0, Math.round(owed * 100) / 100)
}
