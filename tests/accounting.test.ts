import { calculateStaffWeekResultInternal } from '@/services/revenue-service'
import { computeStaffAttributedRevenue, computeStaffAttributedByMethod } from '@/lib/payment-events'

const A = 'staff-akua', B = 'staff-other'
const WS = '2026-08-17', WE = '2026-08-23'
const staffRows = [
  { id: 'sa', userId: A, name: 'akua  sarfowaa', email: 'akua@amplodge.com' },
  { id: 'sb', userId: B, name: 'Other Staff', email: 'other@amplodge.com' },
]
let rid = 0
const props: any[] = []
const room = (num: string) => { const id = `r${++rid}`; props.push({ id, roomNumber: num }); return id }

const bk = (o: any) => {
  const parts: string[] = []
  if (o.events) parts.push(`<!-- PAYMENT_EVENTS:${JSON.stringify(o.events)} -->`)
  if (o.pay) parts.push(`<!-- PAYMENT_DATA:${JSON.stringify(o.pay)} -->`)
  parts.push(`<!-- GUEST_SNAPSHOT:${JSON.stringify({ name: o.guestName || 'Guest' })} -->`)
  return {
    id: o.id, roomId: o.roomId, guestId: 'g1',
    checkIn: o.checkIn || '2026-08-22T12:00:00', checkOut: '2026-08-23T12:00:00',
    status: o.status || 'checked-in', totalPrice: o.totalPrice,
    discountAmount: o.discountAmount || 0, finalAmount: o.finalAmount ?? null,
    createdBy: o.createdBy, createdByName: o.createdByName, createdAt: o.createdAt || '2026-08-22T01:10:08.000Z',
    checkInBy: o.checkInBy, checkOutBy: o.checkOutBy,
    paymentMethod: o.paymentMethod || 'cash',
    special_requests: parts.join('\n\n'),
  }
}
const run = (bookings: any[], staffId: string) =>
  calculateStaffWeekResultInternal(staffId, WS, WE, {
    bookings, properties: props, guests: [{ id: 'g1', name: 'Guest', email: 'g@x.com' }],
    chargesRaw: [], staffRows, standaloneSales: [],
  } as any)

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) console.log(`      got ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
}

// ── The reported card: 700 collected at booking, 350 discount at check-in ──
{
  const ev = (amt: number, m: string) => [{ stage: 'booking', amount: amt, staffId: A, staffName: 'akua  sarfowaa', method: m, splits: [{ method: m, amount: amt }], paidAt: '2026-08-22T01:10:02.745Z' }]
  const bs = [
    bk({ id: 'b1', roomId: room('101'), totalPrice: 350, createdBy: A, createdByName: 'akua  sarfowaa',
         paymentMethod: 'mobile_money', events: ev(350, 'mobile_money'), pay: { amountPaid: 350, paymentStatus: 'full', perRoom: true },
         checkIn: '2026-08-21T12:00:00' }),
    bk({ id: 'b2', roomId: room('108'), totalPrice: 700, discountAmount: 350, finalAmount: 350,
         createdBy: A, createdByName: 'akua  sarfowaa', paymentMethod: 'cash',
         events: ev(700, 'cash'), pay: { amountPaid: 700, paymentStatus: 'full', perRoom: true } }),
  ]
  const r = run(bs, A)
  check('room revenue nets the discount (was 1050)', r.totalRevenue, 700)
  check('cash breakdown nets the discount (was 700)',
    r.bookings.reduce((s, b) => s + (b.attributedByMethod['cash'] || 0), 0), 350)
  check('mobile money unchanged',
    r.bookings.reduce((s, b) => s + (b.attributedByMethod['mobile_money'] || 0), 0), 350)
  check('per-method totals sum to attributed revenue',
    r.bookings.map(b => Math.round(Object.values(b.attributedByMethod).reduce((s, v) => s + v, 0) * 100) / 100),
    r.bookings.map(b => b.staffAttributedRevenue))
}

// ── Attribution can never exceed a booking's worth, split across staff ──
{
  const events = [
    { stage: 'booking', amount: 600, staffId: A, staffName: 'akua', method: 'cash', paidAt: '2026-08-22T01:00:00Z' },
    { stage: 'checkin', amount: 200, staffId: B, staffName: 'other', method: 'mobile_money', paidAt: '2026-08-22T02:00:00Z' },
  ] as any
  // Booking worth 400 after discount; 800 was collected across two staff.
  const a = computeStaffAttributedRevenue(events, A, 400, A, undefined, B)
  const b = computeStaffAttributedRevenue(events, B, 400, A, undefined, B)
  check('overshoot scales proportionally (A)', a, 300)
  check('overshoot scales proportionally (B)', b, 100)
  check('overshoot shares sum to the booking value', Math.round((a + b) * 100) / 100, 400)
}

// ── Undercollection: cash basis — the balance counts only once the guest leaves ──
{
  const events = [{ stage: 'booking', amount: 200, staffId: A, staffName: 'akua', method: 'cash', paidAt: '2026-08-22T01:00:00Z' }] as any
  check('uncollected balance is nobody\'s revenue mid-stay',
    computeStaffAttributedRevenue(events, B, 500, A, undefined, B, undefined, undefined, undefined, 'checked-in'), 0)
  check('balance credited to the departure staff once checked out',
    computeStaffAttributedRevenue(events, B, 500, A, B, undefined, undefined, undefined, undefined, 'checked-out'), 300)
  check('collected part still credited to booker',
    computeStaffAttributedRevenue(events, A, 500, A, undefined, B, undefined, undefined, undefined, 'checked-in'), 200)
}

// ── Method breakdown is staff-scoped ──
{
  const events = [
    { stage: 'booking', amount: 300, staffId: A, staffName: 'akua', method: 'cash', paidAt: '2026-08-22T01:00:00Z' },
    { stage: 'checkin', amount: 200, staffId: B, staffName: 'other', method: 'mobile_money', paidAt: '2026-08-22T02:00:00Z' },
  ] as any
  check('other staff cash not shown on this staff', computeStaffAttributedByMethod(events, A, 500, A, 'cash', undefined, B), { cash: 300 })
  check('each staff sees only their own method', computeStaffAttributedByMethod(events, B, 500, A, 'cash', undefined, B), { mobile_money: 200 })
}

// ── Multi-method single payment splits across methods ──
{
  const events = [{ stage: 'booking', amount: 500, staffId: A, staffName: 'akua', method: 'cash',
                    splits: [{ method: 'cash', amount: 300 }, { method: 'mobile_money', amount: 200 }],
                    paidAt: '2026-08-22T01:00:00Z' }] as any
  check('split payment reported per method', computeStaffAttributedByMethod(events, A, 500, A, 'cash'), { cash: 300, mobile_money: 200 })
}

// ── Deposit row respects a discount too ──
{
  const bs = [bk({ id: 'd1', roomId: room('201'), totalPrice: 800, discountAmount: 300, finalAmount: 500,
    status: 'confirmed', createdBy: A, createdByName: 'akua  sarfowaa',
    events: [{ stage: 'booking', amount: 800, staffId: A, staffName: 'akua  sarfowaa', method: 'cash', paidAt: '2026-08-22T01:10:02Z' }],
    pay: { amountPaid: 800, paymentStatus: 'full', perRoom: true } })]
  const r = run(bs, A)
  check('deposit capped at discounted value', r.totalRevenue, 500)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
