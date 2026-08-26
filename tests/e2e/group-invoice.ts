/**
 * A group invoice must bill what is still owed, not what the stay cost.
 *
 * Groups pay deposits — rooms are reserved weeks out and part-paid up front —
 * and the group invoice showed the grand total with no sign of the money
 * already taken, so guests were asked twice for the same amount.
 *
 * Counting it is not a sum of a column. A payment is recorded three different
 * ways depending on when the booking was written, and one of them repeats the
 * same figure on every room of a batch.
 */
import { createGroupInvoiceData, generateGroupInvoiceHTML } from '@/services/invoice-service'
import { totalCollected } from '@/lib/payment-events'
import { db, __reset } from './fake-db'

let failures = 0
const out: string[] = []
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

const GROUP = 'g-0001-0001-0001'
const BILLING = { fullName: 'Anne B', email: 'anne@example.com', phone: '0240000000' }

const groupComment = (isPrimary: boolean, extra: Record<string, any> = {}) =>
  `<!-- GROUP_DATA:${JSON.stringify({ groupId: GROUP, groupReference: 'GRP-2026-TEST', isPrimaryBooking: isPrimary, ...extra })} -->`

const paymentData = (amountPaid: number, perRoom: boolean) =>
  `<!-- PAYMENT_DATA:${JSON.stringify({ amountPaid, paymentStatus: 'part', ...(perRoom ? { perRoom: true } : {}) })} -->`

const paymentEvents = (amount: number) =>
  `<!-- PAYMENT_EVENTS:${JSON.stringify([{ stage: 'booking', amount, staffId: 'staff-a', staffName: 'Annor Ivy', method: 'cash', paidAt: '2026-09-01T10:00:00.000Z' }])} -->`

/** Rooms priced 350 each, with whatever payment comments the case needs. */
function rooms(comments: string[], createdAt = '2026-09-01T10:00:00.000Z', price = 350) {
  return comments.map((comment, i) => ({
    id: `booking-${i}`,
    guestId: `guest-${i}`,
    guest: { id: `guest-${i}`, name: `Guest ${i + 1}`, email: `g${i}@example.com` },
    room: { roomNumber: `10${i + 1}`, roomType: 'Executive Suite' },
    roomId: `room-${i}`,
    checkIn: '2026-09-04',
    checkOut: '2026-09-05',
    status: 'confirmed',
    totalPrice: price,
    createdAt,
    specialRequests: comment,
  }))
}

async function seed() {
  __reset()
  await db.hotelSettings.create({
    id: 'h1', name: 'AMP Lodge', address: 'Kumasi', phone: '024', email: 'x@amp.com',
    website: 'amplodge.org', currency: 'GHS', taxRate: 0,
  })
}

async function main() {
  // ── One deposit for the group, recorded as a payment event ────────────────
  await seed()
  const deposit = rooms([
    groupComment(true) + '\n\n' + paymentEvents(1000),
    groupComment(false),
    groupComment(false),
  ])
  let data = await createGroupInvoiceData(deposit as any, BILLING)
  check('the group total is the rooms', data.summary.total, 1050)
  check('the deposit is on the invoice', data.summary.amountPaid, 1000)
  check('and the balance is what is left', data.summary.balanceDue, 50)

  const html = await generateGroupInvoiceHTML(data)
  check('the invoice shows a Paid line', html.includes('>Paid<'), true)
  check('the invoice says it is part paid', html.includes('PART PAID'), true)

  // ── Each room holding its own figure ──────────────────────────────────────
  await seed()
  const perRoom = rooms([
    groupComment(true) + '\n\n' + paymentData(200, true),
    groupComment(false) + '\n\n' + paymentData(200, true),
    groupComment(false) + '\n\n' + paymentData(100, true),
  ])
  data = await createGroupInvoiceData(perRoom as any, BILLING)
  check('per-room figures add up', data.summary.amountPaid, 500)
  check('and the balance follows', data.summary.balanceDue, 550)

  // ── One batch payment, stamped onto every room of the sitting ─────────────
  // Written before 2026-08-21: GHS 600 taken once, recorded three times.
  await seed()
  const batch = rooms([
    groupComment(true) + '\n\n' + paymentData(600, false),
    groupComment(false) + '\n\n' + paymentData(600, false),
    groupComment(false) + '\n\n' + paymentData(600, false),
  ])
  data = await createGroupInvoiceData(batch as any, BILLING)
  check('a batch stamp counts once, not once per room', data.summary.amountPaid, 600)
  check('so the group still owes the rest', data.summary.balanceDue, 450)

  // ── Rooms added to the same group days later are their own payment ────────
  await seed()
  const twoSittings = [
    ...rooms([groupComment(true) + '\n\n' + paymentData(600, false), groupComment(false) + '\n\n' + paymentData(600, false)],
      '2026-09-01T10:00:00.000Z'),
    ...rooms([groupComment(false) + '\n\n' + paymentData(600, false), groupComment(false) + '\n\n' + paymentData(600, false)],
      '2026-09-08T10:00:00.000Z').map((b, i) => ({ ...b, id: `later-${i}`, guestId: `later-guest-${i}` })),
  ]
  data = await createGroupInvoiceData(twoSittings as any, BILLING)
  check('a later sitting is a second payment', data.summary.amountPaid, 1200)

  // ── Paid more than the stay is now worth, after a discount ────────────────
  await seed()
  const discounted = rooms([
    groupComment(true, { discount: { type: 'fixed', value: 400, amount: 400 } }) + '\n\n' + paymentEvents(1050),
    groupComment(false),
    groupComment(false),
  ])
  data = await createGroupInvoiceData(discounted as any, BILLING)
  check('the discount comes off the total', data.summary.total, 650)
  check('an overpayment leaves nothing owing', data.summary.balanceDue, 0)
  check('and the invoice says paid in full', (await generateGroupInvoiceHTML(data)).includes('PAID IN FULL'), true)

  // ── Nothing paid ──────────────────────────────────────────────────────────
  await seed()
  data = await createGroupInvoiceData(rooms([groupComment(true), groupComment(false)]) as any, BILLING)
  check('an unpaid group owes the whole total', [data.summary.amountPaid, data.summary.balanceDue], [0, 700])
  check('and shows no payment status', (await generateGroupInvoiceHTML(data)).includes('PART PAID'), false)

  // ── Rows from the list view, which carry the figure but not the blob ──────
  check('the extracted figure is used when there is no comment',
    totalCollected([{ id: 'a', amountPaid: 250 }, { id: 'b', amountPaid: 100 }]), 350)

  console.log(out.join('\n'))
  console.log(failures === 0 ? 'ALL PASS' : `FAILURE (${failures})`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('ERROR', e); process.exit(1) })
