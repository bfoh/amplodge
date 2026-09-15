/**
 * Deleting an employee must not delete their takings.
 *
 * An employee leaves and the admin removes them. What they collected while
 * they worked here is the hotel's record of its own income — last month's
 * total cannot change because of something done to the staff list today.
 *
 * The trap is that one person is written down under two different ids. A
 * booking and a standalone sale record the AUTH user id; a booking charge
 * records the STAFF ROW id, because booking_charges.created_by points at
 * staff.id. The staff row is the only thing tying the two together, and
 * deleting the employee is exactly the act of removing it — after which their
 * charges answer to an id nothing recognises, and the money on them silently
 * leaves every total. It does not even land in "unassigned": that counts
 * charges with no staff on them at all, and these have one.
 *
 * So the suite runs the same week twice, once with the staff row and once
 * without, and holds the figures to being identical.
 */
import { calculateCompanyPeriodRevenue, calculateStaffWeekResultInternal } from '@/services/revenue-service'

const WS = '2026-08-17', WE = '2026-08-23'

// The employee who leaves, and the one who stays.
const GONE = { rowId: 'staff-row-gone', authId: 'auth-gone', name: 'frimpomaa', email: 'frimpomaa@amplodge.com' }
const STAYS = { rowId: 'staff-row-stays', authId: 'auth-stays', name: 'Daniella Akesse', email: 'daniella@amplodge.com' }

const staffRow = (p: typeof GONE) => ({ id: p.rowId, userId: p.authId, name: p.name, email: p.email })

const properties = [
  { id: 'room-101', roomNumber: '101' },
  { id: 'room-102', roomNumber: '102' },
]
const guests = [{ id: 'g1', name: 'Guest One', email: 'g1@x.com' }]

const booking = (id: string, roomId: string, who: typeof GONE, price: number) => ({
  id,
  roomId,
  guestId: 'g1',
  checkIn: '2026-08-19T12:00:00',
  checkOut: '2026-08-20T12:00:00',
  status: 'checked-out',
  totalPrice: price,
  discountAmount: 0,
  finalAmount: null,
  createdBy: who.authId,
  createdByName: who.name,
  createdAt: '2026-08-19T09:00:00.000Z',
  paymentMethod: 'cash',
  special_requests: [
    `<!-- PAYMENT_EVENTS:${JSON.stringify([{
      stage: 'booking', amount: price, staffId: who.authId, staffName: who.name,
      method: 'cash', splits: [{ method: 'cash', amount: price }],
      paidAt: '2026-08-19T09:00:00.000Z',
    }])} -->`,
    `<!-- PAYMENT_DATA:${JSON.stringify({ amountPaid: price, paymentStatus: 'full', perRoom: true })} -->`,
    `<!-- GUEST_SNAPSHOT:${JSON.stringify({ name: 'Guest One' })} -->`,
  ].join('\n\n'),
})

/**
 * A charge carries the staff ROW id — a different id space from the booking —
 * plus the auth id and the name, which are what still join the two once the
 * staff row is gone.
 */
const charge = (id: string, bookingId: string, who: typeof GONE, amount: number, opts: { name?: string; userId?: string | null } = {}) => ({
  id,
  bookingId,
  description: 'Drinks',
  category: 'food_beverage',
  quantity: 1,
  unitPrice: amount,
  amount,
  paymentMethod: 'cash',
  createdBy: who.rowId,
  createdByName: opts.name ?? who.name,
  createdByUserId: opts.userId === null ? undefined : (opts.userId ?? who.authId),
  createdAt: '2026-08-19T20:00:00.000Z',
})

/** A standalone sale carries the AUTH id, like a booking. */
const sale = (id: string, who: typeof GONE, amount: number) => ({
  id, amount, saleDate: '2026-08-20', staffId: who.authId, staffName: who.name,
  description: 'Bar sale', paymentMethod: 'cash',
})

const bookings = [
  booking('b-gone', 'room-101', GONE, 400),
  booking('b-stays', 'room-102', STAYS, 300),
]
const chargesRaw = [
  charge('c-gone-1', 'b-gone', GONE, 60),
  charge('c-gone-2', 'b-gone', GONE, 40),
  charge('c-stays', 'b-stays', STAYS, 25),
]
const standaloneSales = [sale('s-gone', GONE, 50), sale('s-stays', STAYS, 15)]

const shared = (staffRows: any[]) => ({ bookings, properties, guests, chargesRaw, staffRows, standaloneSales } as any)

const EMPLOYED = shared([staffRow(GONE), staffRow(STAYS)])
const DELETED = shared([staffRow(STAYS)])

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) console.log(`      got ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
}

const before = calculateCompanyPeriodRevenue(WS, WE, EMPLOYED)
const after = calculateCompanyPeriodRevenue(WS, WE, DELETED)

// What the fixtures are worth: rooms 400 + 300, charges 60 + 40 + 25, sales 50 + 15.
check('the fixtures add up before anyone is deleted', before.grandRevenue, 890)
check('rooms', before.roomRevenue, 700)
check('charges', before.additionalRevenue, 125)
check('sales', before.standaloneSalesRevenue, 65)

// ── The rule ────────────────────────────────────────────────────────────────
check('the hotel earned the same after the employee was deleted', after.grandRevenue, before.grandRevenue)
check('room revenue is unchanged', after.roomRevenue, before.roomRevenue)
check('charge revenue is unchanged', after.additionalRevenue, before.additionalRevenue)
check('sales revenue are unchanged', after.standaloneSalesRevenue, before.standaloneSalesRevenue)
check('nothing fell into unassigned', after.unassignedRevenue, before.unassignedRevenue)

// ── And it is still THEIR revenue, under their name ──────────────────────────
const shareOf = (r: typeof before, name: string) =>
  r.byStaff.filter((s) => s.staffName === name).reduce((sum, s) => sum + s.grandRevenue, 0)

check('the departed employee still holds what they took', shareOf(after, GONE.name), shareOf(before, GONE.name))
check('which is rooms 400 + charges 100 + sale 50', shareOf(after, GONE.name), 550)
check('the employee who stayed is untouched', shareOf(after, STAYS.name), shareOf(before, STAYS.name))

// Their money must not be scattered across several rows for the same person —
// a manager reading the report has to see one line per person, named.
check('and appears as one line, not several', after.byStaff.filter((s) => s.staffName === GONE.name).length, 1)
check('named, never a bare id', after.byStaff.some((s) => s.staffName === GONE.rowId || s.staffName === GONE.authId), false)

// The per-person report, which is what MyRevenue and the HR page draw.
const goneAfter = calculateStaffWeekResultInternal(GONE.authId, WS, WE, DELETED)
check('their own week still shows their charges', goneAfter.additionalRevenue, 100)
check('and their rooms', goneAfter.totalRevenue, 400)
check('and their sales', goneAfter.standaloneSalesRevenue, 50)

// Deleting somebody must not hand their takings to a colleague.
const staysAfter = calculateStaffWeekResultInternal(STAYS.authId, WS, WE, DELETED)
check('the colleague gained nothing', staysAfter.grandRevenue, 340)

// ── The join has to hold when the names disagree ─────────────────────────────
// Payment events usually stamp the account's email while the charge carries the
// name someone typed, so matching on the name alone leaves the same person
// reported as two rows. The auth id on the charge is what settles it.
{
  const namedByEmail = bookings.map((b) => b.createdBy !== GONE.authId ? b : {
    ...b,
    createdByName: GONE.email,
    special_requests: b.special_requests.replace(`"staffName":"${GONE.name}"`, `"staffName":"${GONE.email}"`),
  })
  const disagreeing = {
    ...shared([staffRow(STAYS)]),
    bookings: namedByEmail,
    standaloneSales: [{ ...sale('s-gone', GONE, 50), staffName: GONE.email }, sale('s-stays', STAYS, 15)],
  } as any

  const r = calculateCompanyPeriodRevenue(WS, WE, disagreeing)
  check('the total still holds when the names disagree', r.grandRevenue, 890)
  check('and it is still one line for that person', r.byStaff.filter((x) => x.grandRevenue === 550).length, 1)
  check('labelled with the name, not the email', r.byStaff.some((x) => x.staffName === GONE.name), true)
}

// ── Charges written before the auth id was recorded ──────────────────────────
// The migration fills it in for every existing charge, but a charge saved
// during the deploy window may carry only the name. That must still be counted.
{
  const legacy = {
    ...shared([staffRow(STAYS)]),
    chargesRaw: [
      charge('c-gone-1', 'b-gone', GONE, 60, { userId: null }),
      charge('c-gone-2', 'b-gone', GONE, 40, { userId: null }),
      charge('c-stays', 'b-stays', STAYS, 25),
    ],
  } as any
  const r = calculateCompanyPeriodRevenue(WS, WE, legacy)
  check('a name-only charge is still counted', r.grandRevenue, 890)
  check('and still theirs', r.byStaff.filter((x) => x.staffName === GONE.name).reduce((t, x) => t + x.grandRevenue, 0), 550)
}

// ── A charge with neither, which is what today's rows look like ──────────────
// Money whose owner cannot be established must still be money the hotel earned.
{
  const anonymous = {
    ...shared([staffRow(STAYS)]),
    chargesRaw: [
      charge('c-gone-1', 'b-gone', GONE, 60, { name: '', userId: null }),
      charge('c-gone-2', 'b-gone', GONE, 40, { name: '', userId: null }),
      charge('c-stays', 'b-stays', STAYS, 25),
    ],
  } as any
  const r = calculateCompanyPeriodRevenue(WS, WE, anonymous)
  check('an unattributable charge is not lost from the total', r.grandRevenue, 890)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
