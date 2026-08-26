/**
 * Every way money enters the system, driven end to end, then checked against
 * what the revenue layer reports. If a flow can record revenue, it belongs
 * here — a path nobody exercises is a path that quietly stops working.
 */
import { bookingEngine } from '@/services/booking-engine'
import { bookingChargesService } from '@/services/booking-charges-service'
import { standaloneSalesService } from '@/services/standalone-sales-service'
import { stayExtensionService } from '@/services/stay-extension-service'
import { recordBookingPayment } from '@/services/booking-payment-service'
import { calculateCompanyPeriodRevenue, calculateStaffWeekResultInternal } from '@/services/revenue-service'
import { buildBookingPaymentEvent, appendPaymentEvent } from '@/lib/payment-events'
import { allocateByWeight } from '@/lib/money'
import { useCheckIn } from '@/hooks/use-check-in'
import { useCheckOut } from '@/hooks/use-check-out'
import { db, __reset } from './fake-db'
import { freezeClock } from './clock'

// The week below is fixed, so the clock the fixtures are stamped with has to
// be too — otherwise every figure reads zero from the following Monday on.
freezeClock()

const WS = '2026-08-17', WE = '2026-08-23'
const A = { id: 'auth-a', email: 'a@amp.com', user_metadata: { full_name: 'Staff A' } }
const B = { id: 'auth-b', email: 'b@amp.com', user_metadata: { full_name: 'Staff B' } }

let failures = 0
const out: string[] = []
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const money = (n: number) => Math.round(n * 100) / 100

let roomSeq = 0
async function seed() {
  __reset()
  ;(globalThis as any).__TEST_USER__ = A
  await db.staff.create({ id: 'sa', userId: A.id, name: 'Staff A', email: A.email, role: 'staff' })
  await db.staff.create({ id: 'sb', userId: B.id, name: 'Staff B', email: B.email, role: 'staff' })
  roomSeq = 0
}
/** Creates a room and hands back the number the booking form must use. */
const room = async (price: number) => {
  const n = ++roomSeq
  const id = `room-${n}`
  const roomNumber = String(400 + n)
  await db.properties.create({ id, roomNumber, status: 'available', basePrice: price, price })
  return { id, roomNumber }
}
const shared = async () => {
  const [bookings, properties, guests, chargesRaw, staffRows, standaloneSales] = await Promise.all([
    db.bookings.listAll(), db.properties.listAll(), db.guests.listAll(),
    db.bookingCharges.listAll(), db.staff.listAll(), db.standaloneSales.listAll(),
  ])
  return { bookings, properties, guests, chargesRaw, staffRows, standaloneSales } as any
}
const company = async () => calculateCompanyPeriodRevenue(WS, WE, await shared())
const forStaff = async (id: string) => calculateStaffWeekResultInternal(id, WS, WE, await shared())

/** The payload every booking form builds, however it is triggered. */
async function bookViaForm(opts: {
  roomId: string, roomNumber: string, price: number, paid: number,
  status: 'full' | 'part' | 'pending', staff?: any, method?: string,
}) {
  const staff = opts.staff || A
  ;(globalThis as any).__TEST_USER__ = staff
  const event = buildBookingPaymentEvent({
    paymentType: opts.status, amount: opts.paid, staffId: staff.id,
    staffName: staff.user_metadata.full_name, method: opts.method || 'cash',
  })
  return bookingEngine.createBooking({
    guest: { fullName: `Guest ${opts.roomNumber}`, email: `g${opts.roomNumber}@x.com`, phone: '024' },
    roomType: 'Standard', roomNumber: opts.roomNumber,
    dates: { checkIn: '2026-08-22T12:00:00', checkOut: '2026-08-23T12:00:00' },
    numGuests: 1, amount: opts.price, status: 'confirmed', source: 'reception',
    paymentMethod: opts.method || 'cash', amountPaid: opts.paid, paymentStatus: opts.status,
    createdBy: staff.id, createdByName: staff.user_metadata.full_name,
    specialRequests: event ? appendPaymentEvent('', event) : '',
  } as any)
}

// ── 1. Reception takes a booking and the full payment ──
async function receptionFullPayment() {
  await seed()
  const r = await room(350)
  await bookViaForm({ roomId: r.id, roomNumber: r.roomNumber, price: 350, paid: 350, status: 'full' })
  const c = await company()
  check('full payment at booking is revenue', money(c.grandRevenue), 350)
  check('credited to the staff who took it', money((await forStaff(A.id)).grandRevenue), 350)
}

// ── 2. Deposit now, balance at check-in, by a different person ──
async function depositThenBalance() {
  await seed()
  const r = await room(500)
  await bookViaForm({ roomId: r.id, roomNumber: r.roomNumber, price: 500, paid: 200, status: 'part' })
  const booking: any = (await db.bookings.listAll())[0]
  const { checkIn } = useCheckIn()
  await checkIn({
    booking: { ...booking, totalPrice: 500, amountPaid: 200 },
    room: { id: r.id, roomNumber: r.roomNumber }, guest: { id: booking.guestId, name: 'G', email: 'g@x.com' },
    paymentMethod: 'mobile_money', checkInAmount: 300, user: B,
  } as any)
  check('deposit stays with the booker', money((await forStaff(A.id)).grandRevenue), 200)
  check('balance goes to whoever took it', money((await forStaff(B.id)).grandRevenue), 300)
  check('company sees the stay once', money((await company()).grandRevenue), 500)
}

// ── 3. Nothing paid until departure ──
async function payAtDeparture() {
  await seed()
  const r = await room(400)
  await bookViaForm({ roomId: r.id, roomNumber: r.roomNumber, price: 400, paid: 0, status: 'pending' })
  const booking: any = (await db.bookings.listAll())[0]
  await db.bookings.update(booking.id, { status: 'checked-in', checkInBy: A.id })
  check('an unpaid stay is nobody\'s revenue yet', money((await company()).grandRevenue), 0)

  const { checkOut } = useCheckOut()
  await checkOut({
    booking: { ...(await db.bookings.get(booking.id)), id: booking.id },
    room: { id: r.id, roomNumber: r.roomNumber }, guest: { id: booking.guestId, name: 'G', email: 'g@x.com' },
    user: B, payment: { amount: 400, method: 'cash' },
  } as any)
  check('settling at the desk records it', money((await company()).grandRevenue), 400)
  check('to the person who took the money', money((await forStaff(B.id)).grandRevenue), 400)
}

// ── 4. A group, paid in full, carrying a discount ──
async function groupWithDiscount() {
  await seed()
  const prices = [350, 350, 900]
  const rooms = []
  for (const p of prices) rooms.push({ ...(await room(p)), price: p })
  const roomsTotal = 1600, discount = 100, collected = 1500
  const shares = allocateByWeight(prices, collected)

  const items = rooms.map((r, i) => {
    const event = buildBookingPaymentEvent({
      paymentType: 'full', amount: shares[i], staffId: A.id, staffName: 'Staff A', method: 'cash',
    })
    return {
      guest: { fullName: 'Group', email: 'grp@x.com', phone: '024' },
      roomType: 'Standard', roomNumber: rooms[i].roomNumber,
      dates: { checkIn: '2026-08-22T12:00:00', checkOut: '2026-08-23T12:00:00' },
      numGuests: 1, amount: r.price, status: 'confirmed' as const, source: 'reception' as const,
      paymentMethod: 'cash', amountPaid: shares[i], paymentStatus: 'full' as const,
      createdBy: A.id, createdByName: 'Staff A',
      specialRequests: event ? appendPaymentEvent('', event) : '',
      ...(i === 0 ? { subtotal: roomsTotal } : {}),
    }
  })
  await bookingEngine.createGroupBooking(items as any, { name: 'Group', email: 'grp@x.com' }, [],
    { type: 'fixed', value: discount, amount: discount })

  check('a discounted group reports what was collected', money((await company()).grandRevenue), collected)
  check('and counts each room once', (await company()).bookings.length, 3)
}

// ── 5. Charges, sales and an extension on top of a stay ──
async function extrasOnAStay() {
  await seed()
  const r = await room(350)
  await db.inventory.create({ id: 'inv', name: 'Water', stockQuantity: 20, unitPrice: 10 })
  await bookViaForm({ roomId: r.id, roomNumber: r.roomNumber, price: 350, paid: 350, status: 'full' })
  const booking: any = (await db.bookings.listAll())[0]
  await db.bookings.update(booking.id, { status: 'checked-in', checkInBy: A.id })

  await bookingChargesService.addCharge({
    bookingId: booking.id, description: 'Water', category: 'minibar',
    quantity: 2, unitPrice: 10, inventoryId: 'inv',
  } as any)
  await standaloneSalesService.addSale({
    description: 'Coke', category: 'drinks', quantity: 1, unitPrice: 15, amount: 15,
    staffId: A.id, staffName: 'Staff A', saleDate: '2026-08-22', paymentMethod: 'cash', notes: '',
  } as any)
  const ext = await stayExtensionService.extendStay(
    booking.id, '2026-08-24T12:00:00', undefined, A.id, undefined, undefined,
    [{ method: 'cash', amount: 350 }]
  )
  check('the extension went through', ext.success, true)

  const c = await company()
  check('room + charge + sale + extension all counted', money(c.grandRevenue), 350 + 20 + 15 + 350)
  check('and none of it is unassigned', money(c.unassignedRevenue), 0)
  const item: any = await db.inventory.get('inv')
  check('stock moved once for the charge', Number(item.stockQuantity), 18)
}

// ── 6. A payment recorded against a booking after the fact ──
async function laterPayment() {
  await seed()
  const r = await room(300)
  await bookViaForm({ roomId: r.id, roomNumber: r.roomNumber, price: 300, paid: 100, status: 'part' })
  const booking: any = (await db.bookings.listAll())[0]
  await recordBookingPayment({
    bookingId: booking.id, stage: 'checkout', amount: 200, method: 'mobile_money',
    staffId: B.id, staffName: 'Staff B',
  })
  await db.bookings.update(booking.id, { status: 'checked-out', checkOutBy: B.id })
  check('the later payment belongs to who took it', money((await forStaff(B.id)).grandRevenue), 200)
  check('the deposit still belongs to the booker', money((await forStaff(A.id)).grandRevenue), 100)
  check('and the stay totals its price', money((await company()).grandRevenue), 300)
}

// ── 7. A cancelled booking earns nothing, even with a charge on it ──
async function cancelledEarnsNothing() {
  await seed()
  const r = await room(350)
  await bookViaForm({ roomId: r.id, roomNumber: r.roomNumber, price: 350, paid: 350, status: 'full' })
  const booking: any = (await db.bookings.listAll())[0]
  await bookingChargesService.addCharge({
    bookingId: booking.id, description: 'Water', category: 'minibar', quantity: 1, unitPrice: 10,
  } as any)
  await db.bookings.update(booking.id, { status: 'cancelled' })
  const c = await company()
  check('a cancelled stay earns no room revenue', money(c.roomRevenue), 0)
  // Its charges must go the same way: the booking was refunded, so it earned
  // nothing at all — not nothing and something at once.
  check('and no charge revenue either', money(c.additionalRevenue + c.unassignedRevenue), 0)
  check('so the booking earns nothing, whole', money(c.grandRevenue), 0)
}


// ── 8. One person who both added a charge and made a sale ──
async function onePersonOneRow() {
  await seed()
  const r = await room(350)
  await bookViaForm({ roomId: r.id, roomNumber: r.roomNumber, price: 350, paid: 350, status: 'full' })
  const booking: any = (await db.bookings.listAll())[0]

  // A charge records the staff ROW id; a sale records the AUTH user id. The
  // same person must not appear as two people because of it.
  await bookingChargesService.addCharge({
    bookingId: booking.id, description: 'Water', category: 'minibar', quantity: 1, unitPrice: 20,
  } as any)
  await standaloneSalesService.addSale({
    description: 'Coke', category: 'drinks', quantity: 1, unitPrice: 10, amount: 10,
    staffId: A.id, staffName: 'Staff A', saleDate: '2026-08-22', paymentMethod: 'cash', notes: '',
  } as any)

  const charge: any = (await db.bookingCharges.listAll())[0]
  const sale: any = (await db.standaloneSales.listAll())[0]
  check('the charge and the sale really do use different ids', charge.createdBy !== sale.staffId, true)

  const c = await company()
  const rows = c.byStaff.filter(x => x.grandRevenue > 0)
  check('but the person is listed once', rows.length, 1)
  check('holding both amounts', money(rows[0].grandRevenue), 380)
  check('and their own week agrees', money((await forStaff(A.id)).grandRevenue), 380)
}

;(async () => {
  const scenarios: Array<[string, () => Promise<void>]> = [
    ['reception takes full payment', receptionFullPayment],
    ['deposit then balance at check-in', depositThenBalance],
    ['paid only at departure', payAtDeparture],
    ['group booking with a discount', groupWithDiscount],
    ['charges, sales and an extension', extrasOnAStay],
    ['payment recorded after the fact', laterPayment],
    ['cancelled booking', cancelledEarnsNothing],
    ['one person, one row', onePersonOneRow],
  ]
  for (const [name, fn] of scenarios) {
    out.push(`\n── ${name}`)
    try { await fn() } catch (e: any) { failures++; out.push(`ERROR  ${name}: ${e?.message}`) }
  }
  console.log(out.join('\n'))
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
})()
