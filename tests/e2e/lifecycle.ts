/**
 * End-to-end money tests: real services, real hooks, in-memory database.
 * Each scenario drives the same code the staff portal runs, then checks what
 * the revenue, analytics and invoice layers report about it.
 */
import { bookingEngine } from '@/services/booking-engine'
import { calculateStaffWeekResultInternal } from '@/services/revenue-service'
import { bookingChargesService } from '@/services/booking-charges-service'
import { standaloneSalesService } from '@/services/standalone-sales-service'
import { stayExtensionService } from '@/services/stay-extension-service'
import { inventoryService } from '@/services/inventory-service'
import { recordBookingPayment, outstandingBalance } from '@/services/booking-payment-service'
import { createInvoiceData } from '@/services/invoice-service'
import { useCheckIn } from '@/hooks/use-check-in'
import { useCheckOut } from '@/hooks/use-check-out'
import { db, __reset } from './fake-db'
import { freezeClock } from './clock'

// The week below is fixed, so the clock the fixtures are stamped with has to
// be too — otherwise every figure reads zero from the following Monday on.
freezeClock()

const WS = '2026-08-17', WE = '2026-08-23'
const STAFF_A = { id: 'staff-a', email: 'annor@amp.com', user_metadata: { full_name: 'Annor Ivy' } }
const STAFF_B = { id: 'staff-b', email: 'daniella@amp.com', user_metadata: { full_name: 'Daniella Akesse' } }

let failures = 0
const results: string[] = []
function check(label: string, got: any, want: any) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const money = (n: number) => Math.round(n * 100) / 100

async function seed() {
  __reset()
  ;(globalThis as any).__TEST_USER__ = STAFF_A
  await db.staff.create({ id: 'sa', userId: STAFF_A.id, name: 'Annor Ivy', email: STAFF_A.email, role: 'staff' })
  await db.staff.create({ id: 'sb', userId: STAFF_B.id, name: 'Daniella Akesse', email: STAFF_B.email, role: 'staff' })
  for (const [id, num, price] of [['r101', '101', 350], ['r102', '102', 450], ['r103', '103', 700]] as const) {
    await db.properties.create({ id, roomNumber: num, status: 'available', basePrice: price, price })
  }
}

async function shared() {
  const [bookings, properties, guests, chargesRaw, staffRows, standaloneSales] = await Promise.all([
    db.bookings.list({ limit: 500 }), db.properties.list({ limit: 100 }), db.guests.list({ limit: 100 }),
    db.bookingCharges.list({ limit: 500 }), db.staff.list({ limit: 50 }), db.standaloneSales.list({ limit: 500 }),
  ])
  return { bookings, properties, guests, chargesRaw, staffRows, standaloneSales } as any
}
const revenueFor = async (staffId: string) =>
  calculateStaffWeekResultInternal(staffId, WS, WE, await shared())

async function makeBooking(opts: {
  room: string, roomId: string, amount: number, paid: number,
  status?: 'full' | 'part' | 'pending', staff?: any, guest?: string,
}) {
  const staff = opts.staff || STAFF_A
  ;(globalThis as any).__TEST_USER__ = staff
  const { buildBookingPaymentEvent, appendPaymentEvent } = await import('@/lib/payment-events')
  const status = opts.status || (opts.paid >= opts.amount ? 'full' : opts.paid > 0 ? 'part' : 'pending')
  const event = buildBookingPaymentEvent({
    paymentType: status, amount: opts.paid, staffId: staff.id,
    staffName: staff.user_metadata.full_name, method: 'cash',
  })
  return bookingEngine.createBooking({
    guest: { fullName: opts.guest || `Guest ${opts.room}`, email: `g${opts.room}@x.com`, phone: '024' },
    roomType: 'Standard', roomNumber: opts.room,
    dates: { checkIn: '2026-08-22T12:00:00', checkOut: '2026-08-23T12:00:00' },
    numGuests: 1, amount: opts.amount, status: 'confirmed', source: 'reception',
    paymentMethod: 'cash', amountPaid: opts.paid, paymentStatus: status,
    createdBy: staff.id, createdByName: staff.user_metadata.full_name,
    specialRequests: event ? appendPaymentEvent('', event) : '',
  } as any)
}

// ─────────────────────────────────────────────────────────────────────────────
async function scenarioDepositThenBalance() {
  await seed()
  await makeBooking({ room: '101', roomId: 'r101', amount: 350, paid: 100 })
  const booking: any = (await db.bookings.list({}))[0]

  // Guard, not a behaviour test. Revenue is attributed to the period the money
  // was collected in, so a fixture stamped outside the week this suite asserts
  // about reports zero everywhere and every check below fails at once, saying
  // nothing about why. If this one fails, the clock is not frozen — the code
  // under test is probably fine.
  const stampedAt = String(booking.createdAt || booking.created_at || '')
  check('fixtures are stamped inside the week the suite asserts about',
    stampedAt >= WS && stampedAt <= `${WE}T23:59:59.999Z`, true)

  // Mid-stay: only the GHS 100 deposit is anyone's revenue.
  let a = await revenueFor(STAFF_A.id)
  check('deposit only: creator holds 100', money(a.totalRevenue), 100)
  let b = await revenueFor(STAFF_B.id)
  check('deposit only: other staff holds nothing', money(b.totalRevenue), 0)

  // Staff B checks the guest in and takes the GHS 250 balance.
  const { checkIn } = useCheckIn()
  await checkIn({
    booking: { ...booking, id: booking.id, totalPrice: 350, amountPaid: 100 },
    room: { id: 'r101', roomNumber: '101' }, guest: { id: booking.guestId, name: 'Guest 101', email: 'g101@x.com' },
    paymentMethod: 'mobile_money', checkInAmount: 250, user: STAFF_B,
  } as any)

  a = await revenueFor(STAFF_A.id); b = await revenueFor(STAFF_B.id)
  check('after check-in: booker keeps the deposit', money(a.totalRevenue), 100)
  check('after check-in: collector gets the balance', money(b.totalRevenue), 250)
  check('balance lands under the method it came in on',
    b.bookings.map(x => x.attributedByMethod), [{ mobile_money: 250 }])
  check('company total is the room price', money(a.totalRevenue + b.totalRevenue), 350)
}

async function scenarioFullPrepayThenDiscount() {
  await seed()
  await makeBooking({ room: '103', roomId: 'r103', amount: 700, paid: 700 })
  const booking: any = (await db.bookings.list({}))[0]

  const { checkIn } = useCheckIn()
  await checkIn({
    booking: { ...booking, totalPrice: 700, amountPaid: 700 },
    room: { id: 'r103', roomNumber: '103' }, guest: { id: booking.guestId, name: 'G', email: 'g@x.com' },
    paymentMethod: 'cash', checkInAmount: 0, discountAmount: 350, discountReason: 'promo', user: STAFF_A,
  } as any)

  const a = await revenueFor(STAFF_A.id)
  check('700 collected then discounted to 350 reports 350', money(a.totalRevenue), 350)
  check('and the method breakdown agrees',
    money(a.bookings.reduce((s, x) => s + (x.attributedByMethod.cash || 0), 0)), 350)
}

async function scenarioUnpaidStay() {
  await seed()
  await makeBooking({ room: '102', roomId: 'r102', amount: 450, paid: 0, status: 'pending' })
  const booking: any = (await db.bookings.list({}))[0]

  const { checkIn } = useCheckIn()
  await checkIn({
    booking: { ...booking, totalPrice: 450, amountPaid: 0 },
    room: { id: 'r102', roomNumber: '102' }, guest: { id: booking.guestId, name: 'G', email: 'g@x.com' },
    paymentMethod: 'cash', checkInAmount: 0, user: STAFF_B,
  } as any)

  let a = await revenueFor(STAFF_A.id), b = await revenueFor(STAFF_B.id)
  check('unpaid in-house stay is nobody\'s revenue', money(a.totalRevenue + b.totalRevenue), 0)

  // Guest settles at the desk on departure.
  const { checkOut } = useCheckOut()
  const current: any = await db.bookings.get(booking.id)
  await checkOut({
    booking: { ...current, id: booking.id, totalPrice: 450 },
    room: { id: 'r102', roomNumber: '102' }, guest: { id: booking.guestId, name: 'G', email: 'g@x.com' },
    user: STAFF_B, payment: { amount: 450, method: 'cash' },
  } as any)

  a = await revenueFor(STAFF_A.id); b = await revenueFor(STAFF_B.id)
  check('settled at check-out: credited to who took it', money(b.totalRevenue), 450)
  check('and not to the booker', money(a.totalRevenue), 0)
  const after: any = await db.bookings.get(booking.id)
  check('check-out payment is recorded on the booking',
    /"stage":"checkout","amount":450/.test(after.special_requests || after.specialRequests), true)
}

async function scenarioChargesAndInventory() {
  await seed()
  await db.inventory.create({ id: 'inv-water', name: 'Water', stockQuantity: 20, unitPrice: 10 })
  await makeBooking({ room: '101', roomId: 'r101', amount: 350, paid: 350 })
  const booking: any = (await db.bookings.list({}))[0]

  await bookingChargesService.addCharge({
    bookingId: booking.id, description: 'Water x2', category: 'minibar',
    quantity: 2, unitPrice: 10, inventoryId: 'inv-water', createdBy: STAFF_A.id,
  } as any)

  const a = await revenueFor(STAFF_A.id)
  check('charge adds to additional revenue', money(a.additionalRevenue), 20)
  check('room revenue is untouched by the charge', money(a.totalRevenue), 350)
  check('grand revenue is rooms + charges', money(a.grandRevenue), 370)
  const item: any = await db.inventory.get('inv-water')
  check('stock reduced once', Number(item.stockQuantity), 18)
}

async function scenarioStayExtension() {
  await seed()
  await makeBooking({ room: '103', roomId: 'r103', amount: 700, paid: 700 })
  const booking: any = (await db.bookings.list({}))[0]
  // Extensions apply to a guest already in the room.
  await db.bookings.update(booking.id, { status: 'checked-in', checkInBy: STAFF_A.id })

  const res = await stayExtensionService.extendStay(
    booking.id, '2026-08-24T12:00:00', undefined, STAFF_A.id, undefined, undefined,
    [{ method: 'cash', amount: 700 }]
  )
  check('extension succeeded', res.success, true)

  const charges = await db.bookingCharges.list({})
  check('extension books exactly one charge', charges.length, 1)
  check('no negative payment row cancels it', charges.every((c: any) => Number(c.amount) > 0), true)
  check('filed under room_extension', charges[0].category, 'room_extension')

  const a = await revenueFor(STAFF_A.id)
  check('extension is revenue', money(a.additionalRevenue), 700)

  const after: any = await db.bookings.get(booking.id)
  const pd = JSON.parse((after.special_requests || '').match(/<!-- PAYMENT_DATA:(.*?) -->/)![1])
  check('extension payment reaches amountPaid', money(pd.amountPaid), 1400)
}

async function scenarioStandaloneSale() {
  await seed()
  await db.inventory.create({ id: 'inv-coke', name: 'Coke', stockQuantity: 10, unitPrice: 5 })
  await standaloneSalesService.addSale({
    description: 'Coke', category: 'drinks', quantity: 2, unitPrice: 5, amount: 10,
    staffId: STAFF_A.id, staffName: 'Annor Ivy', saleDate: '2026-08-22',
    paymentMethod: 'cash', inventoryId: 'inv-coke', notes: '',
  } as any)
  const a = await revenueFor(STAFF_A.id)
  check('sale counts once', money(a.standaloneSalesRevenue), 10)
  check('sale is in grand revenue', money(a.grandRevenue), 10)
  const sales = await db.standaloneSales.list({})
  check('exactly one sale row', sales.length, 1)
  const item: any = await db.inventory.get('inv-coke')
  check('stock reduced by the quantity sold', Number(item.stockQuantity), 8)
}

async function scenarioCancelled() {
  await seed()
  await makeBooking({ room: '101', roomId: 'r101', amount: 350, paid: 350 })
  const booking: any = (await db.bookings.list({}))[0]
  await db.bookings.update(booking.id, { status: 'cancelled' })
  const a = await revenueFor(STAFF_A.id)
  check('cancelled booking earns nothing', money(a.grandRevenue), 0)
}

async function scenarioInvoiceMath() {
  await seed()
  await makeBooking({ room: '103', roomId: 'r103', amount: 700, paid: 700 })
  const booking: any = (await db.bookings.list({}))[0]
  await db.bookings.update(booking.id, { discountAmount: 200, finalAmount: 500 })
  await bookingChargesService.addCharge({
    bookingId: booking.id, description: 'Laundry', category: 'laundry',
    quantity: 1, unitPrice: 50, createdBy: STAFF_A.id,
  } as any)

  const current: any = await db.bookings.get(booking.id)
  const data = await createInvoiceData(
    { ...current, id: booking.id, totalPrice: 700, discountAmount: 200,
      guest: { name: 'G', email: 'g@x.com' }, room: { roomNumber: '103', roomType: 'Standard' } },
    { id: 'r103', roomNumber: '103' } as any
  )
  check('invoice total = room + charges - discount', money(data.charges.total), 550)
  check('discount shown once', money(data.charges.discountTotal), 200)
  const t: any = data.charges
  if (t.taxBreakdown) {
    const sum = money(t.taxBreakdown.salesTotal + t.taxBreakdown.gfNhil + t.taxBreakdown.vat + t.taxBreakdown.tourismLevy)
    check('tax components sum to the total', sum, money(data.charges.total))
  }
}

async function scenarioBalanceHelper() {
  await seed()
  await makeBooking({ room: '101', roomId: 'r101', amount: 350, paid: 100 })
  const booking: any = (await db.bookings.list({}))[0]
  check('balance = room - paid', outstandingBalance(booking, 0), 250)
  check('balance includes charges', outstandingBalance(booking, 40), 290)
  await recordBookingPayment({
    bookingId: booking.id, stage: 'checkout', amount: 250, method: 'cash',
    staffId: STAFF_B.id, staffName: 'Daniella Akesse',
  })
  const after: any = await db.bookings.get(booking.id)
  check('recording a payment clears the balance', outstandingBalance(after, 0), 0)
  // Replaying the same stage must not double count.
  await recordBookingPayment({
    bookingId: booking.id, stage: 'checkout', amount: 250, method: 'cash',
    staffId: STAFF_B.id, staffName: 'Daniella Akesse',
  })
  const twice: any = await db.bookings.get(booking.id)
  const pd = JSON.parse((twice.special_requests || '').match(/<!-- PAYMENT_DATA:(.*?) -->/)![1])
  check('replayed check-out payment does not double count', money(pd.amountPaid), 350)
}

;(async () => {
  const scenarios: Array<[string, () => Promise<void>]> = [
    ['deposit → check-in balance', scenarioDepositThenBalance],
    ['prepaid then discounted', scenarioFullPrepayThenDiscount],
    ['unpaid stay settled at check-out', scenarioUnpaidStay],
    ['booking charges + inventory', scenarioChargesAndInventory],
    ['stay extension', scenarioStayExtension],
    ['standalone sale', scenarioStandaloneSale],
    ['cancelled booking', scenarioCancelled],
    ['invoice math', scenarioInvoiceMath],
    ['balance + payment recording', scenarioBalanceHelper],
  ]
  for (const [name, fn] of scenarios) {
    results.push(`\n── ${name}`)
    try { await fn() } catch (e: any) { failures++; results.push(`ERROR  ${name}: ${e?.message}\n${e?.stack?.split('\n').slice(1,3).join('\n')}`) }
  }
  console.log(results.join('\n'))
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
})()
