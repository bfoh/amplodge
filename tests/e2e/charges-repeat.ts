/** Charge edits and deletes, and operations repeated the way real staff repeat them. */
import { bookingEngine } from '@/services/booking-engine'
import { bookingChargesService } from '@/services/booking-charges-service'
import { calculateStaffWeekResultInternal } from '@/services/revenue-service'
import { inventoryService } from '@/services/inventory-service'
import { standaloneSalesService } from '@/services/standalone-sales-service'
import { useCheckOut } from '@/hooks/use-check-out'
import { buildBookingPaymentEvent, appendPaymentEvent } from '@/lib/payment-events'
import { db, __reset } from './fake-db'

const WS = '2026-08-17', WE = '2026-08-23'
const A = { id: 'staff-a', email: 'a@amp.com', user_metadata: { full_name: 'Annor Ivy' } }
let failures = 0
const out: string[] = []
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(got)}  want ${JSON.stringify(want)}`}`)
}
const money = (n: number) => Math.round(n * 100) / 100

async function seed() {
  __reset()
  ;(globalThis as any).__TEST_USER__ = A
  await db.staff.create({ id: 'sa', userId: A.id, name: 'Annor Ivy', email: A.email, role: 'staff' })
  await db.properties.create({ id: 'r1', roomNumber: '301', status: 'available', basePrice: 350, price: 350 })
  await db.inventory.create({ id: 'inv-1', name: 'Beer', stockQuantity: 50, unitPrice: 15 })
}
const sharedData = async () => {
  const [bookings, properties, guests, chargesRaw, staffRows, standaloneSales] = await Promise.all([
    db.bookings.list({ limit: 500 }), db.properties.list({ limit: 100 }), db.guests.list({ limit: 100 }),
    db.bookingCharges.list({ limit: 500 }), db.staff.list({ limit: 50 }), db.standaloneSales.list({ limit: 500 }),
  ])
  return { bookings, properties, guests, chargesRaw, staffRows, standaloneSales } as any
}
const revenue = async () => calculateStaffWeekResultInternal(A.id, WS, WE, await sharedData())
const stock = async () => Number((await db.inventory.get('inv-1')).stockQuantity)

async function makeStay() {
  const event = buildBookingPaymentEvent({
    paymentType: 'full', amount: 350, staffId: A.id, staffName: 'Annor Ivy', method: 'cash',
  })
  await bookingEngine.createBooking({
    guest: { fullName: 'G', email: 'g@x.com', phone: '024' }, roomType: 'Standard', roomNumber: '301',
    dates: { checkIn: '2026-08-22T12:00:00', checkOut: '2026-08-23T12:00:00' },
    numGuests: 1, amount: 350, status: 'confirmed', source: 'reception',
    paymentMethod: 'cash', amountPaid: 350, paymentStatus: 'full',
    createdBy: A.id, createdByName: 'Annor Ivy',
    specialRequests: event ? appendPaymentEvent('', event) : '',
  } as any)
  const b: any = (await db.bookings.list({}))[0]
  await db.bookings.update(b.id, { status: 'checked-in', checkInBy: A.id })
  return b
}

async function chargeEdits() {
  await seed()
  const b = await makeStay()
  const charge = await bookingChargesService.addCharge({
    bookingId: b.id, description: 'Beer x2', category: 'minibar',
    quantity: 2, unitPrice: 15, inventoryId: 'inv-1', createdBy: A.id,
  } as any)
  check('charge revenue after adding 2', money((await revenue()).additionalRevenue), 30)
  check('stock after selling 2', await stock(), 48)

  // Staff corrects it upward to 5.
  await bookingChargesService.updateCharge(charge!.id, { quantity: 5, unitPrice: 15 } as any)
  check('charge revenue after raising to 5', money((await revenue()).additionalRevenue), 75)
  check('stock after raising to 5', await stock(), 45)

  // Then back down to 1.
  await bookingChargesService.updateCharge(charge!.id, { quantity: 1, unitPrice: 15 } as any)
  check('charge revenue after dropping to 1', money((await revenue()).additionalRevenue), 15)
  check('stock returned when the quantity drops', await stock(), 49)

  // And removes it entirely.
  await bookingChargesService.deleteCharge(charge!.id)
  check('charge revenue after deleting', money((await revenue()).additionalRevenue), 0)
  check('stock fully restored after deleting', await stock(), 50)
}


async function chargesAlwaysNameTheirStaff() {
  await seed()
  const b = await makeStay()

  // A caller that forgets to say who is adding the charge — which is how the
  // guest folio dialog behaved, leaving GHS 940 of real money attributed to
  // nobody and dropped from the revenue reports.
  await bookingChargesService.addCharge({
    bookingId: b.id, description: 'Beer', category: 'minibar',
    quantity: 1, unitPrice: 15,
  } as any)

  const rows = await db.bookingCharges.list({})
  check('a charge always records who added it', !!rows[0].createdBy, true)
  // booking_charges.created_by is a foreign key to staff.id. Writing the auth
  // user id there is rejected by the database and the charge is lost — so what
  // gets stamped must be the STAFF ROW id, not the id auth.me() returns.
  const staffRow: any = (await db.staff.list({}))[0]
  check('and it is the staff row id, not the auth user id', rows[0].createdBy, staffRow.id)
  check('so it reaches that staff member\'s revenue', money((await revenue()).additionalRevenue), 15)
}

async function repeatedCheckOut() {
  await seed()
  const b = await makeStay()
  await db.bookings.update(b.id, { totalPrice: 350 })
  await bookingChargesService.addCharge({
    bookingId: b.id, description: 'Beer', category: 'minibar', quantity: 1, unitPrice: 15, createdBy: A.id,
  } as any)

  const { checkOut } = useCheckOut()
  const current: any = await db.bookings.get(b.id)
  const args: any = {
    booking: { ...current, id: b.id }, room: { id: 'r1', roomNumber: '301' },
    guest: { id: current.guestId, name: 'G', email: 'g@x.com' }, user: A,
    payment: { amount: 15, method: 'cash' },
  }
  await checkOut(args)
  const afterFirst = await revenue()
  await checkOut({ ...args, booking: { ...(await db.bookings.get(b.id)), id: b.id } })
  const afterSecond = await revenue()

  check('a repeated check-out does not add revenue',
    money(afterSecond.grandRevenue), money(afterFirst.grandRevenue))
  check('and the stay is still worth its price plus the charge',
    money(afterSecond.grandRevenue), 365)
}

async function repeatedSale() {
  await seed()
  const sale = {
    description: 'Beer', category: 'drinks', quantity: 1, unitPrice: 15, amount: 15,
    staffId: A.id, staffName: 'Annor Ivy', saleDate: '2026-08-22', paymentMethod: 'cash', inventoryId: 'inv-1', notes: '',
  }
  await standaloneSalesService.addSale(sale as any)
  await standaloneSalesService.addSale(sale as any)
  check('two sales are two sales', (await db.standaloneSales.list({})).length, 2)
  check('two sales, two units of stock', await stock(), 48)
  check('two sales, both counted', money((await revenue()).standaloneSalesRevenue), 30)
}

async function stockNeverLost() {
  await seed()
  // Ten sales at once, as two terminals would.
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    inventoryService.reduceStock('inv-1', 1, { id: A.id, name: 'Annor Ivy' }, `sale ${i}`)))
  check('concurrent sales all land', await stock(), 40)
  const txns = await db.inventoryTransactions.list({})
  check('every movement is logged', txns.length, 10)
}

;(async () => {
  for (const [name, fn] of [
    ['charge edits and deletes', chargeEdits],
    ['charges always name their staff', chargesAlwaysNameTheirStaff],
    ['repeated check-out', repeatedCheckOut],
    ['repeated standalone sale', repeatedSale],
    ['concurrent stock movements', stockNeverLost],
  ] as Array<[string, () => Promise<void>]>) {
    out.push(`\n── ${name}`)
    try { await fn() } catch (e: any) { failures++; out.push(`ERROR  ${name}: ${e?.message}`) }
  }
  console.log(out.join('\n'))
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
})()
