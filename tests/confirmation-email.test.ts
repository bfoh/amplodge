/**
 * The figure in the guest's confirmation and the figure in the app must agree.
 *
 * A guest booking online is signed out and cannot send mail through
 * send-email, so their confirmation is composed by a netlify function instead.
 * That function has to work out what the booking has already collected, and it
 * cannot import `totalCollected` from src — it runs in a different bundle.
 *
 * So the rule is written twice, and the whole point of this suite is that the
 * second copy stays honest. Both are run over the same rows: a deposit the
 * guest is told about must be the deposit the hotel has recorded, or the email
 * asks them for money they have already paid.
 */
import { totalCollected } from '@/lib/payment-events'
// The server's copy, from the function that sends the email.
import { collected } from '../netlify/functions/send-booking-confirmation.js'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const GROUP = 'g-1111-2222'
const group = () => `<!-- GROUP_DATA:${JSON.stringify({ groupId: GROUP, groupReference: 'GRP-2026-TEST' })} -->`
const payData = (amountPaid: number, perRoom: boolean) =>
  `<!-- PAYMENT_DATA:${JSON.stringify({ amountPaid, paymentStatus: 'part', ...(perRoom ? { perRoom: true } : {}) })} -->`
const events = (amount: number) =>
  `<!-- PAYMENT_EVENTS:${JSON.stringify([{ stage: 'booking', amount, staffId: '', staffName: '', method: 'cash', paidAt: '2026-09-01T10:00:00.000Z' }])} -->`

/** The same rows in both shapes: snake_case as the server reads them, camel as the app does. */
const rows = (comments: string[], price = 350) => comments.map((c, i) => ({
  id: `b-${i}`,
  total_price: price,
  totalPrice: price,
  created_at: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  special_requests: c,
  specialRequests: c,
}))

const both = (label: string, comments: string[], want: number) => {
  const r = rows(comments)
  check(`${label} — the app says so`, totalCollected(r), want)
  check(`${label} — and so does the email`, collected(r), want)
}

both('nothing paid', [group(), group(), group()], 0)
both('a deposit on one room', [group() + events(1000), group(), group()], 1000)
both('every room paid in full', [group() + events(350), group() + events(350), group() + events(350)], 1050)
both('per-room figures with no events', [group() + payData(200, true), group() + payData(200, true), group() + payData(100, true)], 500)

// The one that is easy to get wrong in a second implementation: before
// 2026-08-21 a group's single payment was stamped onto every room, unmarked.
// Counting it per room would tell the guest they had paid three times over.
both('one batch stamp shared by three rooms', [group() + payData(600, false), group() + payData(600, false), group() + payData(600, false)], 600)

// Events win over a stored figure on the same row — no double counting.
both('events beside a stored total', [group() + payData(700, true) + '\n' + events(700)], 700)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
