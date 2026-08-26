/**
 * Group membership: every room in a group must be findable, by both routes.
 *
 * Manage Group showed one room out of six for GRP-2026-BT5W. Two defects,
 * either of which loses rooms on its own:
 *
 *   1. createBooking threw away the id the database gave the new row and
 *      returned a locally-invented one, so the follow-up write that sets
 *      bookings.group_id addressed a row that does not exist. Production had
 *      1,033 bookings and NOT ONE with group_id set.
 *   2. With group_id never set, every group fell through to the legacy reader,
 *      which scanned the first 500 bookings and filtered them in the browser.
 *      Past 500 bookings that reader returns whichever members happen to fall
 *      inside the window — one of six, in the reported case.
 */
import { createBookingGroup, getGroupMembers, getGroupMeta } from '@/lib/booking-groups'
import { db, __reset, __store } from './fake-db'

const A = { id: 'staff-a', email: 'a@amp.com', user_metadata: { full_name: 'Annor Ivy' } }

let failures = 0
const out: string[] = []
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

const ROOMS = [
  { n: '101', p: 350 },
  { n: '102', p: 350 },
  { n: '103', p: 350 },
  { n: '104', p: 450 },
  { n: '105', p: 350 },
  { n: '106', p: 1400 },
]

async function seed() {
  __reset()
  ;(globalThis as any).__TEST_USER__ = A
  await db.staff.create({ id: 'sa', userId: A.id, name: 'Annor Ivy', email: A.email, role: 'staff' })
  for (const [i, r] of ROOMS.entries()) {
    await db.properties.create({ id: `room-${i}`, roomNumber: r.n, status: 'available', basePrice: r.p, price: r.p })
  }
}

const roomInput = (r: { n: string; p: number }, i: number) => ({
  bookingData: {
    guest: { fullName: `Guest ${i + 1}`, email: `g${i + 1}@example.com`, phone: '0240000000', address: '' },
    roomType: 'Executive Suite',
    roomNumber: r.n,
    dates: { checkIn: '2026-09-04', checkOut: '2026-09-05' },
    numGuests: 1,
    amount: r.p,
    status: 'confirmed' as const,
    source: 'reception' as const,
    paymentStatus: 'pending' as const,
    amountPaid: 0,
  } as any,
})

/** Bookings unrelated to the group, so the group's rows sit past the legacy window. */
async function fillWithUnrelatedBookings(count: number) {
  for (let i = 0; i < count; i++) {
    await db.bookings.create({
      guestId: `filler-guest-${i}`,
      roomId: 'room-0',
      checkIn: '2026-01-01',
      checkOut: '2026-01-02',
      status: 'checked-out',
      totalPrice: 100,
      numGuests: 1,
      specialRequests: 'walk-in',
    })
  }
}

async function main() {
  // ── The database's id is the booking's id ─────────────────────────────────
  await seed()
  const created = await createBookingGroup(
    ROOMS.map(roomInput),
    { fullName: 'Anne B', email: 'anne@example.com', phone: '0240000000', address: '' } as any,
  )
  check('every room in the group was created', created.length, ROOMS.length)

  const stored = __store.bookings || []
  check('every booking row carries group_id', stored.filter((b: any) => !!b.groupId).length, ROOMS.length)
  check('the group is one group', new Set(stored.map((b: any) => b.groupId)).size, 1)
  check('createBooking returns the row id the database assigned',
    created.every(b => stored.some((row: any) => row.id === (b.remoteId || b._id))), true)

  const groupId = (__store.bookingGroups || [])[0]?.id
  check('the group row is the group id', typeof groupId, 'string')
  const primaryId = (await getGroupMeta(groupId))?.primaryBookingId
  check('the group row points at a booking that exists',
    stored.some((row: any) => row.id === primaryId), true)

  // ── Reading the group back, by the indexed column ─────────────────────────
  check('every room is a member', (await getGroupMembers(groupId)).length, ROOMS.length)

  // ── Reading a legacy group back, past the old 500-row window ──────────────
  // Groups created before group_id existed carry the GROUP_DATA comment only,
  // and a hotel that has taken more than 500 bookings keeps its newest ones
  // outside any window the old reader looked at.
  await seed()
  await fillWithUnrelatedBookings(600)
  await createBookingGroup(
    ROOMS.map(roomInput),
    { fullName: 'Anne B', email: 'anne@example.com', phone: '0240000000', address: '' } as any,
  )
  const legacyGroupId = (__store.bookingGroups || [])[0]?.id
  for (const row of __store.bookings || []) delete row.groupId

  const legacyMembers = await getGroupMembers(legacyGroupId)
  check('a legacy group is read in full, whatever the table size', legacyMembers.length, ROOMS.length)
  check('a legacy group returns only its own rooms',
    legacyMembers.every((b: any) => (b.special_requests || b.specialRequests || '').includes(legacyGroupId)), true)

  // ── A group half tagged, half not ─────────────────────────────────────────
  // A room added today to a group booked before the column existed is tagged;
  // its older siblings are not. Reading either record alone loses rooms.
  const mixed = (__store.bookings || []).filter((b: any) => (b.specialRequests || '').includes(legacyGroupId))
  mixed[0].groupId = legacyGroupId
  check('a half-tagged group still returns every room',
    (await getGroupMembers(legacyGroupId)).length, ROOMS.length)
  check('and returns each room once',
    new Set((await getGroupMembers(legacyGroupId)).map((b: any) => b.id)).size, ROOMS.length)

  console.log(out.join('\n'))
  console.log(failures === 0 ? 'ALL PASS' : `FAILURE (${failures})`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('ERROR', e); process.exit(1) })
