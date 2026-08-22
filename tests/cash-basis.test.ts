import { computeStaffAttributedRevenue, computeStaffAttributedByMethod } from '@/lib/payment-events'
import { outstandingBalance } from '@/services/booking-payment-service'

const A = 'staff-a', B = 'staff-b'
let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) console.log(`      got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`)
}
const ev = (stage: any, amount: number, staffId: string, method = 'cash') =>
  ({ stage, amount, staffId, staffName: staffId, method, paidAt: '2026-08-22T01:00:00Z' }) as any

// ── Guest still in the room owing money: nobody has earned it ──
{
  const events = [ev('booking', 200, A)]
  check('checked-in: only the 200 collected counts (A)',
    computeStaffAttributedRevenue(events, A, 500, A, undefined, B, undefined, undefined, undefined, 'checked-in'), 200)
  check('checked-in: unpaid balance is NOT revenue for the check-in staff',
    computeStaffAttributedRevenue(events, B, 500, A, undefined, B, undefined, undefined, undefined, 'checked-in'), 0)
}

// ── Confirmed but unpaid: nothing at all ──
check('confirmed and unpaid earns nobody anything',
  computeStaffAttributedRevenue([], A, 500, A, undefined, undefined, 0, 'pending', undefined, 'confirmed'), 0)

// ── Completed stay: the balance was settled at the desk ──
{
  const events = [ev('booking', 200, A)]
  check('checked-out: deposit stays with A',
    computeStaffAttributedRevenue(events, A, 500, A, B, undefined, undefined, undefined, undefined, 'checked-out'), 200)
  check('checked-out: settled balance goes to whoever checked them out',
    computeStaffAttributedRevenue(events, B, 500, A, B, undefined, undefined, undefined, undefined, 'checked-out'), 300)
}

// ── Recorded check-out payment beats the fallback ──
{
  const events = [ev('booking', 200, A), ev('checkout', 300, B, 'mobile_money')]
  check('explicit check-out payment credits the collector',
    computeStaffAttributedRevenue(events, B, 500, A, B, undefined, undefined, undefined, undefined, 'checked-out'), 300)
  check('and lands under the method it came in on',
    computeStaffAttributedByMethod(events, B, 500, A, 'cash', B, undefined, undefined, undefined, 'checked-out'),
    { mobile_money: 300 })
}

// ── Legacy rows ──
check('legacy part payment: only what was taken, stay in progress',
  computeStaffAttributedRevenue([], A, 500, A, undefined, B, 150, 'part', undefined, 'checked-in'), 150)
check('legacy part payment: balance credited once the guest has left',
  computeStaffAttributedRevenue([], B, 500, A, B, undefined, 150, 'part', undefined, 'checked-out'), 350)
check('legacy paid in full is unaffected by status',
  computeStaffAttributedRevenue([], A, 500, A, undefined, undefined, 500, 'full', undefined, 'checked-in'), 500)

// ── Company-wide total still adds up on a finished stay ──
{
  const events = [ev('booking', 200, A)]
  const total = computeStaffAttributedRevenue(events, A, 500, A, B, undefined, undefined, undefined, undefined, 'checked-out')
              + computeStaffAttributedRevenue(events, B, 500, A, B, undefined, undefined, undefined, undefined, 'checked-out')
  check('finished stay still totals the full price across staff', total, 500)
}

// ── outstandingBalance, used to prefill what check-out collects ──
check('balance = room + charges - paid',
  outstandingBalance({ totalPrice: 700, amountPaid: 200 }, 50), 550)
check('balance respects a discount',
  outstandingBalance({ totalPrice: 700, discountAmount: 350, finalAmount: 350, amountPaid: 100 }, 0), 250)
check('balance never goes negative',
  outstandingBalance({ totalPrice: 300, amountPaid: 400 }, 0), 0)
check('balance reads PAYMENT_DATA when amountPaid is not on the row',
  outstandingBalance({ totalPrice: 500, special_requests: '<!-- PAYMENT_DATA:{"amountPaid":120} -->' }, 0), 380)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
