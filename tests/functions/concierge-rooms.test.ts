/**
 * The AI concierge sees and books the rooms the website does.
 *
 * Its availability check (check-availability, rooms-availability.js) and its
 * booking (submit-booking, create-booking.js) used to read the legacy `rooms`
 * table, counting only rows marked 'clean' or 'available'. On 2026-11-05 that
 * hid most real rooms (marked 'active'), missed new rooms 201-204, offered four
 * rooms no longer on the Rooms page (222, 333, 444, 555), listed every one of
 * about 70 duplicate room types, and let a checked-out stay block a room.
 *
 * This runs the real functions against an in-memory database that enforces
 * the booking foreign key and the overlap constraint.
 */
import { failInsert, tables, writes } from './fake-supabase-js'
import { handler as availability } from '../../netlify/functions/rooms-availability.js'
import { handler as createBooking } from '../../netlify/functions/create-booking.js'
import { buildCatalog } from '../../netlify/functions/_lib/room-catalog.js'
import { canonicalRoomTypes } from '../../src/lib/room-types'
import { dedupeRoomTypes } from '../../src/site/data/rooms'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

process.env.INTERNAL_FUNCTION_SECRET = 'test'
;(globalThis as any).fetch = async () => new Response('{}', { status: 200 })

const type = (id: string, name: string, base_price: number, capacity: number, created_at: string) => ({ id, name, base_price, capacity, max_occupancy: capacity, description: '', created_at })
const room = (id: string, room_number: string, property_type_id: string, status: string) => ({ id, name: `Room ${room_number}`, room_number, property_type_id, status })

tables.room_types = [
  type('std', 'Standard Room', 350, 2, '2025-12-14T20:53:48Z'),
  type('std-dup', 'Standard Room', 100, 2, '2026-06-05T18:37:58Z'),
  type('fam', 'Family Room', 700, 4, '2025-12-14T20:53:48Z'),
  type('fam-dup', 'Family Room', 200, 4, '2026-06-05T18:38:16Z'),
  type('exec', 'Executive Suite', 450, 2, '2025-12-14T20:53:48Z'), // no rooms
  type('tiw', 'Tiwaah Executive', 900, 2, '2026-11-05T10:00:00Z'),
]
tables.properties = [
  room('p101', '101', 'std', 'cleaning'), // today's housekeeping state; free later
  room('p102', '102', 'std', 'occupied'),
  room('p103', '103', 'std', 'maintenance'),
  room('p108', '108', 'fam', 'active'),
  room('p111', '111', 'fam-dup', 'active'), // linked to a duplicate: not sold online
  room('p201', '201', 'tiw', 'active'), // added on the Rooms page, no mirror yet
  room('p203', '203', 'tiw', 'active'),
  room('p209', '209', 'tiw', 'archived'),
]
tables.rooms = [
  { id: 'p101', room_number: '101', room_type_id: 'std', status: 'active' },
  { id: 'p102', room_number: '102', room_type_id: 'std', status: 'occupied' },
  { id: 'p103', room_number: '103', room_type_id: 'std', status: 'available' },
  { id: 'p108', room_number: '108', room_type_id: 'fam', status: 'active' },
  { id: 'o222', room_number: '222', room_type_id: 'std', status: 'available' }, // gone from the Rooms page
]
const IN = '2030-12-11'
const OUT = '2030-12-13'
tables.bookings = [
  { id: 'b1', room_id: 'p101', check_in: '2030-12-10', check_out: '2030-12-12', status: 'confirmed' },
  { id: 'b2', room_id: 'p102', check_in: '2030-12-09', check_out: '2030-12-12', status: 'checked-out' },
  { id: 'b3', room_id: 'p108', check_in: '2030-12-11', check_out: '2030-12-13', status: 'cancelled' },
]
tables.guests = []

const ask = async (guests: number) => {
  const res = await availability({ httpMethod: 'GET', headers: {}, queryStringParameters: { checkIn: IN, checkOut: OUT, guests: String(guests) } } as any)
  return JSON.parse(res.body).data as any[]
}
const book = async (roomTypeId: string, email: string) => {
  const res = await createBooking({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ checkIn: IN, checkOut: OUT, roomTypeId, guestName: 'Test Guest', guestEmail: email }) } as any)
  const booking = res.statusCode === 200 ? tables.bookings[tables.bookings.length - 1] : null
  return { status: res.statusCode, room: booking?.room_id, total: booking?.total_price }
}

async function main() {
  // --- The catalogue is the website's.
  const catalog = buildCatalog(tables.room_types, tables.properties)
  const site = dedupeRoomTypes(tables.room_types as any, tables.properties as any)
  const staff = canonicalRoomTypes(tables.room_types as any, tables.properties as any)
  check('the concierge offers the categories the website offers', catalog.map((e: any) => e.type.id).sort(), site.map((g) => g.type.id).sort())
  check('and the rows Set Prices edits', catalog.map((e: any) => e.type.id).every((id: string) => staff.some((g) => g.type.id === id)), true)

  // --- Availability.
  const two = await ask(2)
  check('one entry per category with rooms, cheapest first', two.map((t) => t.name), ['Standard Room', 'Family Room', 'Tiwaah Executive'])
  const byName = Object.fromEntries(two.map((t) => [t.name, t]))
  check('a confirmed stay blocks its room, a checked-out one does not, maintenance never frees', byName['Standard Room'].roomIds, ['p102'])
  check('a room\'s housekeeping status today does not hide it on later dates', two.flatMap((t) => t.roomIds).includes('p102'), true)
  check('a room gone from the Rooms page is never offered', two.flatMap((t) => t.roomIds).includes('o222'), false)
  check('a cancelled booking blocks nothing', byName['Family Room'].roomIds, ['p108'])
  check('a room on a duplicate type is not offered', two.flatMap((t) => t.roomIds).includes('p111'), false)
  check('a new room is offered before it has a mirror row, archived ones never', byName['Tiwaah Executive'].roomIds, ['p201', 'p203'])
  check('prices and guest limits are the live ones', two.map((t) => [t.price, t.maxOccupancy]), [[350, 2], [700, 4], [900, 2]])
  check('photos are the lodge\'s own', byName['Family Room'].images, ['https://amplodge.org/images/property/room-family-576.jpg'])
  check('a category without photos shows the lodge', byName['Tiwaah Executive'].images, ['https://amplodge.org/images/property/exterior-road-1080.jpg'])
  const three = await ask(3)
  check('a party too big for a category gets none of it', three.map((t) => [t.name, t.availableCount]), [['Standard Room', 0], ['Family Room', 1], ['Tiwaah Executive', 0]])

  // --- Booking.
  failInsert.rooms = (row) => (row.id === 'p201' ? { code: '23505', message: 'duplicate key value violates unique constraint "rooms_room_number_key"' } : null)
  // 23505 on the mirror is treated as "already there"; the booking then fails the FK and moves on.
  const first = await book('tiw', 'a@example.test')
  check('a room that cannot be prepared is skipped for the next', [first.status, first.room], [200, 'p203'])
  delete failInsert.rooms
  const mirror = tables.rooms.find((r) => r.id === 'p203')
  check('the booked room gets its mirror row, typed and priced', mirror && [mirror.room_type_id, mirror.price, mirror.status], ['tiw', 900, 'available'])
  check('the price is the type\'s, per night', first.total, 1800)

  const second = await book('tiw', 'b@example.test')
  check('the next booking takes the next free room', [second.status, second.room], [200, 'p201'])
  const third = await book('tiw', 'c@example.test')
  check('when the category is full the agent hears so', third.status, 409)

  const viaDuplicate = await book('std-dup', 'd@example.test')
  check('an old duplicate type id books the live type at the live price', [viaDuplicate.status, viaDuplicate.room, viaDuplicate.total], [200, 'p102', 700])
  check('the orphaned room 222 was never booked', tables.bookings.some((b) => b.room_id === 'o222'), false)
  check('every new booking points at a mirror row', tables.bookings.filter((b) => !b.id?.startsWith('b')).every((b) => tables.rooms.some((r) => r.id === b.room_id)), true)
  check('no room type was created or changed', writes.some((w) => w.table === 'room_types'), false)

  if (failures) {
    console.log(`FAILURE  ${failures} check(s) failed`)
    process.exit(1)
  }
  console.log('ALL PASS concierge rooms: the website\'s categories, rooms and prices; live availability; bookings land on real rooms')
}
main().catch((e) => {
  console.error('FAILURE', e)
  process.exit(1)
})
