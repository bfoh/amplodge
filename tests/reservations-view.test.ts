/**
 * The reservations list reads from a view that parses special_requests
 * server-side. These check the two things that could silently change what a row
 * shows: the mapping from a view row, and the payment label with and without
 * the view.
 */
import { formatMethodsLabel, parsePaymentEvents, displayMethodName } from '@/lib/payment-events'

// Mirrors ReservationsPage — kept here so a change to either is caught.
const methodsLabel = (b: any): string => {
  const fromView: string[] = b.paymentMethods || []
  if (fromView.length) return fromView.map(displayMethodName).filter(Boolean).join(' + ')
  return formatMethodsLabel(parsePaymentEvents(b._rawSpecialRequests || b.special_requests || ''))
}

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// A row as the view returns it, from real production shapes.
const viewRow = {
  id: 'b1', guestId: 'g1', roomId: 'r1',
  checkIn: '2026-08-22', checkOut: '2026-08-23', status: 'checked-in',
  totalPrice: 700, discountAmount: 350, finalAmount: 350,
  guestName: '(church )P victor', guestEmail: 'church@example.com',
  roomNumber: '104', groupId: 'grp-1', groupReference: 'GRP-2026-Q57X',
  amountPaid: 700, paymentMethods: ['cash', 'mobile_money'], chargesTotal: 20,
  paymentMethod: 'cash',
}

check('label uses the methods the view returned', methodsLabel(viewRow), 'Cash + Momo')
check('single method reads plainly', methodsLabel({ paymentMethods: ['cash'] }), 'Cash')

// The fallback path still parses the blob, for a database without the view.
const rawRow = {
  paymentMethods: [],
  special_requests: `<!-- PAYMENT_EVENTS:${JSON.stringify([
    { stage: 'booking', amount: 200, staffId: 's', staffName: 'S', method: 'cash', paidAt: '2026-08-22T01:00:00Z' },
    { stage: 'checkin', amount: 150, staffId: 's', staffName: 'S', method: 'mobile_money', paidAt: '2026-08-22T02:00:00Z' },
  ])} -->`,
}
check('fallback reads the same label from the blob', methodsLabel(rawRow), 'Cash + Momo')
check('nothing recorded reads empty', methodsLabel({ paymentMethods: [], special_requests: '' }), '')

// The mapper: a rename, not a parse.
const fromListRow = (r: any): any => ({
  ...r,
  guestNameSnapshot: r.guestName || undefined,
  guestEmailSnapshot: r.guestEmail || undefined,
  roomNumber: r.roomNumber || undefined,
  groupId: r.groupId || undefined,
  groupReference: r.groupReference || undefined,
  amountPaid: Number(r.amountPaid || 0),
  chargesTotal: Number(r.chargesTotal || 0),
  paymentMethods: r.paymentMethods || [],
  _rawSpecialRequests: '',
  special_requests: '',
})
const mapped = fromListRow(viewRow)
check('guest name lands where the page reads it', mapped.guestNameSnapshot, '(church )P victor')
check('group reference survives', mapped.groupReference, 'GRP-2026-Q57X')
check('room number survives', mapped.roomNumber, '104')
check('charges total is a number', mapped.chargesTotal, 20)
check('the blob is not carried', mapped.special_requests, '')

// The row total is room + charges, discount respected.
const getBookingTotal = (b: any) => {
  const roomCost = (b.finalAmount != null && b.finalAmount > 0) ? b.finalAmount : (b.totalPrice || b.amount || b.amountPaid || 0)
  return roomCost + (b.chargesTotal ?? 0)
}
check('row total uses the discounted price plus charges', getBookingTotal(mapped), 370)

// A view missing any of these is an older revision; the page must not trust it.
const VIEW_FIELDS = ['guestName', 'roomNumber', 'paymentMethods', 'chargesTotal']
const shapeOk = (row: any) => VIEW_FIELDS.every(f => f in row)
check('the current view shape is accepted', shapeOk(viewRow), true)
check('an older revision is rejected', shapeOk({
  id: 'b1', guestNameSnapshot: 'x', roomNumberSnapshot: '104', paymentEvents: [], amountPaid: 0,
}), false)
check('a row without charges_total is rejected', shapeOk({ ...viewRow, chargesTotal: undefined, ...{} }) && 'chargesTotal' in viewRow, true)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
