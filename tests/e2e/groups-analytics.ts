/** Group bookings, analytics reconciliation, and the invariants that must hold everywhere. */
import { bookingEngine } from '@/services/booking-engine'
import { calculateStaffWeekResultInternal } from '@/services/revenue-service'
import { analyticsService } from '@/services/analytics-service'
import { buildBookingPaymentEvent, appendPaymentEvent } from '@/lib/payment-events'
import { allocateByWeight } from '@/lib/money'
import { db, __reset } from './fake-db'

const WS = '2026-08-17', WE = '2026-08-23'
const A = { id: 'staff-a', email: 'a@amp.com', user_metadata: { full_name: 'Annor Ivy' } }
const B = { id: 'staff-b', email: 'b@amp.com', user_metadata: { full_name: 'Daniella Akesse' } }

let failures = 0
const out: string[] = []
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const money = (n: number) => Math.round(n * 100) / 100

async function seed() {
  __reset()
  ;(globalThis as any).__TEST_USER__ = A
  await db.staff.create({ id: 'sa', userId: A.id, name: 'Annor Ivy', email: A.email, role: 'staff' })
  await db.staff.create({ id: 'sb', userId: B.id, name: 'Daniella Akesse', email: B.email, role: 'staff' })
  for (const [id, num, price] of [['r1', '201', 350], ['r2', '202', 350], ['r3', '203', 900]] as const) {
    await db.properties.create({ id, roomNumber: num, status: 'available', basePrice: price, price })
  }
}
const sharedData = async () => {
  const [bookings, properties, guests, chargesRaw, staffRows, standaloneSales] = await Promise.all([
    db.bookings.list({ limit: 500 }), db.properties.list({ limit: 100 }), db.guests.list({ limit: 100 }),
    db.bookingCharges.list({ limit: 500 }), db.staff.list({ limit: 50 }), db.standaloneSales.list({ limit: 500 }),
  ])
  return { bookings, properties, guests, chargesRaw, staffRows, standaloneSales } as any
}
const revenueFor = async (id: string) => calculateStaffWeekResultInternal(id, WS, WE, await sharedData())

/** Every scenario must satisfy these, whatever the shape of the data. */
async function invariants(label: string, staffIds: string[]) {
  const shared = await sharedData()
  for (const id of staffIds) {
    const r = calculateStaffWeekResultInternal(id, WS, WE, shared)
    for (const b of r.bookings) {
      const byMethod = money(Object.values(b.attributedByMethod || {}).reduce((s, v) => s + v, 0))
      check(`${label}: ${b.id.slice(0, 8)} method totals equal attributed revenue`, byMethod, money(b.staffAttributedRevenue))
      check(`${label}: ${b.id.slice(0, 8)} attribution never exceeds the booking`,
        money(b.staffAttributedRevenue) <= money(b.effectivePrice) + 0.01, true)
      check(`${label}: ${b.id.slice(0, 8)} no negative revenue`, b.staffAttributedRevenue >= 0, true)
    }
    check(`${label}: ${id} grand = rooms + charges + sales`,
      money(r.grandRevenue), money(r.totalRevenue + r.additionalRevenue + r.standaloneSalesRevenue))
  }
}

// ── A group booked by one staff, paid in full with a group discount ──
async function groupWithDiscount() {
  await seed()
  const rooms = [{ n: '201', p: 350 }, { n: '202', p: 350 }, { n: '203', p: 900 }]
  const roomsTotal = 1600
  const discount = 100
  const collected = roomsTotal - discount   // 1500 actually handed over

  const shares = allocateByWeight(rooms.map(r => r.p), collected)
  const items = rooms.map((r, i) => {
    const share = shares[i]
    const event = buildBookingPaymentEvent({
      paymentType: 'full', amount: share, staffId: A.id, staffName: 'Annor Ivy', method: 'cash',
    })
    return {
      guest: { fullName: 'Church Group', email: 'church@x.com', phone: '024' },
      roomType: 'Standard', roomNumber: r.n,
      dates: { checkIn: '2026-08-22T12:00:00', checkOut: '2026-08-23T12:00:00' },
      numGuests: 1, amount: r.p, status: 'confirmed' as const, source: 'reception' as const,
      paymentMethod: 'cash', amountPaid: share, paymentStatus: 'full' as const,
      createdBy: A.id, createdByName: 'Annor Ivy',
      specialRequests: event ? appendPaymentEvent('', event) : '',
      ...(i === 0 ? { subtotal: roomsTotal } : {}),
    }
  })
  await bookingEngine.createGroupBooking(items as any, { name: 'Church', email: 'church@x.com' },
    [], { type: 'fixed', value: discount, amount: discount })

  const a = await revenueFor(A.id)
  check('group deposit counted once, not once per room', money(a.totalRevenue), collected)
  check('one row per room', a.bookings.length, 3)
  const b = await revenueFor(B.id)
  check('nothing lands on a staff member who took none of it', money(b.totalRevenue), 0)
  await invariants('group', [A.id, B.id])
}

// ── A group split across two staff, added on different days ──
async function groupTwoStaff() {
  await seed()
  const mk = async (room: string, price: number, staff: any, paid: number) => {
    ;(globalThis as any).__TEST_USER__ = staff
    const event = buildBookingPaymentEvent({
      paymentType: 'full', amount: paid, staffId: staff.id,
      staffName: staff.user_metadata.full_name, method: 'cash',
    })
    return {
      guest: { fullName: 'Group', email: 'grp@x.com', phone: '024' },
      roomType: 'Standard', roomNumber: room,
      dates: { checkIn: '2026-08-22T12:00:00', checkOut: '2026-08-23T12:00:00' },
      numGuests: 1, amount: price, status: 'confirmed' as const, source: 'reception' as const,
      paymentMethod: 'cash', amountPaid: paid, paymentStatus: 'full' as const,
      createdBy: staff.id, createdByName: staff.user_metadata.full_name,
      specialRequests: event ? appendPaymentEvent('', event) : '',
    }
  }
  const first = await bookingEngine.createGroupBooking(
    [await mk('201', 350, A, 350), await mk('202', 350, A, 350)] as any,
    { name: 'Group', email: 'grp@x.com' }, [], undefined
  )
  const groupId = JSON.parse(((first[0] as any).specialRequests || (first[0] as any).notes || '')
    .match(/<!-- GROUP_DATA:(.*?) -->/)?.[1] || '{}').groupId
  await bookingEngine.addToGroup(groupId, await mk('203', 900, B, 900) as any)

  const a = await revenueFor(A.id), b = await revenueFor(B.id)
  check('each staff keeps only the rooms they took money for (A)', money(a.totalRevenue), 700)
  check('each staff keeps only the rooms they took money for (B)', money(b.totalRevenue), 900)
  check('group total across staff', money(a.totalRevenue + b.totalRevenue), 1600)
  await invariants('two-staff group', [A.id, B.id])
}

// ── Analytics agrees with the per-staff figures ──
async function analyticsReconciles() {
  await seed()
  const mk = async (room: string, price: number, paid: number, status: string, staff: any) => {
    ;(globalThis as any).__TEST_USER__ = staff
    const event = buildBookingPaymentEvent({
      paymentType: paid >= price ? 'full' : paid > 0 ? 'part' : 'pending', amount: paid,
      staffId: staff.id, staffName: staff.user_metadata.full_name, method: 'cash',
    })
    const created = await bookingEngine.createBooking({
      guest: { fullName: `G${room}`, email: `g${room}@x.com`, phone: '024' },
      roomType: 'Standard', roomNumber: room,
      dates: { checkIn: '2026-08-22T12:00:00', checkOut: '2026-08-23T12:00:00' },
      numGuests: 1, amount: price, status: 'confirmed', source: 'reception',
      paymentMethod: 'cash', amountPaid: paid, paymentStatus: paid >= price ? 'full' : paid > 0 ? 'part' : 'pending',
      createdBy: staff.id, createdByName: staff.user_metadata.full_name,
      specialRequests: event ? appendPaymentEvent('', event) : '',
    } as any)
    const row: any = (await db.bookings.list({})).find((r: any) => r.roomId && r.totalPrice === price && r.status === 'confirmed')
    if (status !== 'confirmed' && row) await db.bookings.update(row.id, { status, checkInBy: staff.id })
    return created
  }
  await mk('201', 350, 350, 'checked-out', A)
  await mk('202', 350, 100, 'confirmed', B)

  const shared = await sharedData()
  const perStaff = ['staff-a', 'staff-b']
    .map(id => calculateStaffWeekResultInternal(id, WS, WE, shared))
    .reduce((s, r) => s + r.grandRevenue, 0)

  const analytics = await analyticsService.getRevenueAnalytics(undefined, undefined, {
    bookings: await bookingEngine.getAllBookings(),
    roomTypes: [], properties: shared.properties, chargesRaw: shared.chargesRaw,
    standaloneSales: shared.standaloneSales, guests: shared.guests, staff: shared.staffRows,
  } as any)

  check('a completed stay plus a deposit = what the staff figures show', money(perStaff), 450)
  check('analytics reports the same money', money(analytics.totalRevenue), money(perStaff))
}

;(async () => {
  for (const [name, fn] of [
    ['group with a discount', groupWithDiscount],
    ['group split across two staff', groupTwoStaff],
    ['analytics reconciliation', analyticsReconciles],
  ] as Array<[string, () => Promise<void>]>) {
    out.push(`\n── ${name}`)
    try { await fn() } catch (e: any) { failures++; out.push(`ERROR  ${name}: ${e?.message}`) }
  }
  console.log(out.join('\n'))
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
})()
