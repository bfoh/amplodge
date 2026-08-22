import { calculateStaffWeekResultInternal } from '@/services/revenue-service'

const A = 'staff-annor', B = 'staff-daniella'
const WS = '2026-08-17', WE = '2026-08-23'
const T = '2026-08-21T10:00:00.000Z'

const staffRows = [
  { id: 'sa', userId: A, name: 'Annor Ivy', email: 'annor@amplodge.com' },
  { id: 'sb', userId: B, name: 'Daniella Akesse', email: 'daniella@amplodge.com' },
]

let rid = 0
const props: any[] = []
function room(num: string) { const id = `r${++rid}`; props.push({ id, roomNumber: num }); return id }

function ev(amount: number, staffId: string, staffName: string) {
  return { stage: 'booking', amount, staffId, staffName, method: 'cash', paidAt: T }
}
function bk(o: any) {
  const parts: string[] = []
  if (o.events) parts.push(`<!-- PAYMENT_EVENTS:${JSON.stringify(o.events)} -->`)
  if (o.group) parts.push(`<!-- GROUP_DATA:${JSON.stringify(o.group)} -->`)
  if (o.pay) parts.push(`<!-- PAYMENT_DATA:${JSON.stringify(o.pay)} -->`)
  parts.push(`<!-- GUEST_SNAPSHOT:${JSON.stringify({ name: o.guestName || 'Guest' })} -->`)
  return {
    id: o.id, roomId: o.roomId, guestId: 'g1',
    checkIn: o.checkIn || '2026-08-22T12:00:00', checkOut: o.checkOut || '2026-08-23T12:00:00',
    status: o.status || 'confirmed', totalPrice: o.totalPrice,
    createdBy: o.createdBy, createdByName: o.createdByName, createdAt: T,
    checkInBy: o.checkInBy, checkOutBy: o.checkOutBy,
    paymentMethod: 'cash', amountPaid: o.amountPaid, paymentStatus: o.paymentStatus,
    special_requests: parts.join('\n\n'),
  }
}

function total(bookings: any[], staffId: string) {
  const r = calculateStaffWeekResultInternal(staffId, WS, WE, {
    bookings, properties: props, guests: [{ id: 'g1', name: 'Guest', email: 'g@x.com' }],
    chargesRaw: [], staffRows, standaloneSales: [],
  } as any)
  return { revenue: Math.round(r.totalRevenue * 100) / 100, rows: r.bookings.length }
}

let failures = 0
function check(label: string, got: any, want: any) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`)
}

// ── Case 1: group split between two staff — each keeps only their own share
{
  const g = { groupId: 'g-mixed', groupReference: 'GRP-MIX' }
  const bs = [
    bk({ id: 'm1', roomId: room('201'), totalPrice: 1000, createdBy: A, createdByName: 'Annor Ivy', group: g, events: [ev(500, A, 'Annor Ivy')] }),
    bk({ id: 'm2', roomId: room('202'), totalPrice: 1000, createdBy: B, createdByName: 'Daniella Akesse', group: g, events: [ev(300, B, 'Daniella Akesse')] }),
  ]
  check('mixed-staff group → Annor gets only her 500', total(bs, A), { revenue: 500, rows: 1 })
  check('mixed-staff group → Daniella gets only her 300', total(bs, B), { revenue: 300, rows: 1 })
}

// ── Case 2: legacy group (no PAYMENT_EVENTS, group-wide amountPaid on every row)
{
  const g = { groupId: 'g-legacy', groupReference: 'GRP-LEG' }
  const pay = { amountPaid: 900, paymentStatus: 'part' }   // 900 for the WHOLE group
  const bs = [
    bk({ id: 'l1', roomId: room('301'), totalPrice: 1000, createdBy: A, createdByName: 'Annor Ivy', group: g, pay }),
    bk({ id: 'l2', roomId: room('302'), totalPrice: 500,  createdBy: A, createdByName: 'Annor Ivy', group: g, pay }),
  ]
  check('legacy group deposit counted once, prorated', total(bs, A), { revenue: 900, rows: 2 })
  check('legacy group deposit not credited to other staff', total(bs, B), { revenue: 0, rows: 0 })
}

// ── Case 3: single-room deposit booking (no group) — unchanged
{
  const bs = [bk({ id: 's1', roomId: room('401'), totalPrice: 350, createdBy: A, createdByName: 'Annor Ivy', events: [ev(350, A, 'Annor Ivy')] })]
  check('single-room deposit → creator gets 350', total(bs, A), { revenue: 350, rows: 1 })
  check('single-room deposit → other staff gets nothing', total(bs, B), { revenue: 0, rows: 0 })
}

// ── Case 4: legacy single-room deposit with no payment events
{
  const bs = [bk({ id: 's2', roomId: room('402'), totalPrice: 400, createdBy: B, createdByName: 'Daniella Akesse', pay: { amountPaid: 150, paymentStatus: 'part' } })]
  check('legacy single deposit → creator gets 150', total(bs, B), { revenue: 150, rows: 1 })
}

// ── Case 5: legacy single-room paid in full
{
  const bs = [bk({ id: 's3', roomId: room('403'), totalPrice: 500, createdBy: A, createdByName: 'Annor Ivy', pay: { amountPaid: 500, paymentStatus: 'full' } })]
  check('legacy single paid in full → creator gets 500', total(bs, A), { revenue: 500, rows: 1 })
}

// ── Case 6: checked-out stay — deposit by A at booking, balance collected by B at check-in
{
  const bs = [bk({
    id: 'c1', roomId: room('501'), totalPrice: 1000, status: 'checked-out',
    createdBy: A, createdByName: 'Annor Ivy', checkInBy: B,
    events: [ev(400, A, 'Annor Ivy'), { stage: 'checkin', amount: 600, staffId: B, staffName: 'Daniella Akesse', method: 'cash', paidAt: T }],
  })]
  check('checked-out: booking deposit stays with Annor', total(bs, A), { revenue: 400, rows: 1 })
  check('checked-out: check-in balance goes to Daniella', total(bs, B), { revenue: 600, rows: 1 })
}

// ── Case 7: the reported incident — 6-room group, one staff, 2200 deposit
{
  const g = { groupId: 'g-q57x', groupReference: 'GRP-2026-Q57X' }
  const rooms = [1000, 1200, 550, 400, 350, 350]
  const gt = rooms.reduce((s, r) => s + r, 0)
  const bs = rooms.map((price, i) => bk({
    id: `q${i}`, roomId: room(`60${i}`), totalPrice: price, createdBy: A, createdByName: 'Annor Ivy',
    group: g, events: [ev(Math.round((price / gt) * 2200 * 100) / 100, A, 'Annor Ivy')],
  }))
  check('reported incident: group deposit counted once', total(bs, A), { revenue: 2200, rows: 6 })
  check('reported incident: nothing lands on the other staff', total(bs, B), { revenue: 0, rows: 0 })
}


// ── Case 8: payment event saved with no staff stamp → creator keeps the money
{
  const bs = [bk({ id: 'u1', roomId: room('701'), totalPrice: 600, createdBy: A, createdByName: 'Annor Ivy',
    events: [{ stage: 'booking', amount: 250, staffId: '', staffName: '', method: 'cash', paidAt: T }] })]
  check('unstamped event → creator gets 250', total(bs, A), { revenue: 250, rows: 1 })
  check('unstamped event → other staff gets nothing', total(bs, B), { revenue: 0, rows: 0 })
}

// ── Case 9: group room paid by one staff, another room in same group unpaid
{
  const g = { groupId: 'g-part', groupReference: 'GRP-PART' }
  const bs = [
    bk({ id: 'p1', roomId: room('801'), totalPrice: 500, createdBy: A, createdByName: 'Annor Ivy', group: g, events: [ev(500, A, 'Annor Ivy')] }),
    bk({ id: 'p2', roomId: room('802'), totalPrice: 500, createdBy: A, createdByName: 'Annor Ivy', group: g, events: [ev(0, A, 'Annor Ivy')] }),
  ]
  check('group with one unpaid room → only the paid room counts', total(bs, A), { revenue: 500, rows: 1 })
}


// ── Case 10: GRP-2026-VO6H shape — batch of 2 rooms paid 1000, more rooms
//    added to the same group days later with no payment record of their own.
{
  const g = { groupId: 'g-vo6h', groupReference: 'GRP-VO6H' }
  const pay = { amountPaid: 1000, paymentStatus: 'part' }
  const mk = (id: string, price: number, at: string, withPay: boolean) => ({
    ...bk({ id, roomId: room(id), totalPrice: price, createdBy: A, createdByName: 'Annor Ivy',
            group: g, ...(withPay ? { pay } : {}) }),
    createdAt: at, checkIn: '2026-08-22T12:00:00',
  })
  const bs = [
    mk('v1', 700, '2026-08-19T09:16:41.000Z', true),
    mk('v2', 700, '2026-08-19T09:16:48.000Z', true),
    mk('v3', 4200, '2026-08-20T18:33:46.000Z', false),
    mk('v4', 1750, '2026-08-21T17:03:46.000Z', false),
  ]
  // 1000 belongs to the 2-room batch (subtotal 1400) → 500 each, not 1000 each
  // and not spread across the whole 8350 group.
  check('batch payment stays inside its batch', total(bs, A), { revenue: 1000, rows: 2 })
}

// ── Case 11: rooms added to a group on a later day carry their own payment
{
  const g = { groupId: 'g-two-batches', groupReference: 'GRP-2BATCH' }
  const mk = (id: string, price: number, at: string, paid: number) => ({
    ...bk({ id, roomId: room(id), totalPrice: price, createdBy: A, createdByName: 'Annor Ivy',
            group: g, pay: { amountPaid: paid, paymentStatus: 'part' } }),
    createdAt: at, checkIn: '2026-08-22T12:00:00',
  })
  const bs = [
    mk('t1', 500, '2026-08-19T09:00:00.000Z', 400),
    mk('t2', 500, '2026-08-19T09:00:10.000Z', 400),
    mk('t3', 700, '2026-08-21T15:00:00.000Z', 700),
  ]
  // 400 across batch one (200 + 200) + 700 for the room booked on its own.
  check('two batches in one group counted separately', total(bs, A), { revenue: 1100, rows: 3 })
}

// ── Case 12: a lone group member's stored amount is already its own
{
  const g = { groupId: 'g-lone', groupReference: 'GRP-LONE' }
  const bs = [
    { ...bk({ id: 'n1', roomId: room('901'), totalPrice: 500, createdBy: A, createdByName: 'Annor Ivy', group: g, pay: { amountPaid: 300, paymentStatus: 'part' } }), createdAt: '2026-08-19T09:00:00.000Z' },
    { ...bk({ id: 'n2', roomId: room('902'), totalPrice: 500, createdBy: A, createdByName: 'Annor Ivy', group: g }), createdAt: '2026-08-19T09:00:05.000Z' },
  ]
  check('single stamped row left as-is', total(bs, A), { revenue: 300, rows: 1 })
}


// ── Case 13: repaired rows (perRoom) are never split again, even when equal
//    priced rooms in one sitting end up holding identical shares.
{
  const g = { groupId: 'g-repaired', groupReference: 'GRP-REPAIRED' }
  const mk = (id: string, at: string) => ({
    ...bk({ id, roomId: room(id), totalPrice: 350, createdBy: A, createdByName: 'Annor Ivy',
            group: g, pay: { amountPaid: 350, paymentStatus: 'full', perRoom: true } }),
    createdAt: at, checkIn: '2026-08-22T12:00:00',
  })
  const bs = [
    mk('q1', '2026-08-19T09:00:00.000Z'),
    mk('q2', '2026-08-19T09:00:06.000Z'),
    mk('q3', '2026-08-19T09:00:12.000Z'),
  ]
  check('perRoom rows keep their full value', total(bs, A), { revenue: 1050, rows: 3 })
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
