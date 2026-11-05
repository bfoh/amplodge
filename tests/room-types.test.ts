/**
 * Adding rooms and setting prices.
 *
 * Three faults stopped the owner adding rooms on 2026-11-05:
 *  - The Rooms page re-created any default room type it could not find, and
 *    each insert's realtime echo re-ran the check: room_types grew to 70 rows
 *    for five names, all listed on Set Prices and in the Add Room dropdown.
 *    A price typed into the wrong "Standard Room" row changed nothing.
 *  - Adding a room wrote `updated_at` to the `rooms` mirror, which has no such
 *    column, so no new room reached it (rooms 201 to 204 never did).
 *  - Saving a price wrote `price` to `properties`, which has no such column, so
 *    no room's copy of a price ever changed.
 *
 * This checks the rules in src/lib/room-types.ts: which room-type row is the
 * live one, that it is the row the website charges, and that every key the
 * pages write is a real column (against schema.json, the database's OpenAPI
 * description).
 */
import schema from '../schema.json'
import {
  canonicalRoomTypes,
  findTypeNamed,
  groupOf,
  mirrorPriceUpdate,
  newRoomMirrorRow,
  newRoomRow,
  newRoomTypeRow,
  roomFields,
  roomMirrorFields,
  roomPriceUpdate,
  roomTypeDetailsUpdate,
  roomTypePriceUpdate,
  roomWithNumber,
} from '../src/lib/room-types'
import { dedupeRoomTypes } from '../src/site/data/rooms'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// --- The live shape: each name's priced row has the rooms; seeded copies are newer and empty.
const type = (id: string, name: string, basePrice: number, createdAt: string, capacity = 2) => ({ id, name, basePrice, capacity, createdAt })
const types = [
  type('std', 'Standard Room', 350, '2025-12-14T20:53:48Z'),
  type('fam', 'Family Room', 700, '2025-12-14T20:53:48Z', 4),
  type('pres', 'Presidential Suite', 1200, '2025-12-23T20:25:29Z', 5),
  // An empty copy OLDER than the row with rooms: rooms decide, not age.
  type('pres-old', 'Presidential Suite', 500, '2025-12-01T00:00:00Z', 5),
  type('std-dup1', 'Standard Room', 100, '2026-04-15T07:03:51Z'),
  type('std-dup2', 'standard  room ', 100, '2026-06-05T18:37:58Z'),
  type('fam-dup', 'Family Room', 200, '2026-06-05T18:38:16Z', 4),
  // Just added on Set Prices, no rooms yet.
  type('tiwaah', 'Tiwaah Executive', 900, '2026-11-05T10:00:00Z', 2),
]
const room = (id: string, roomNumber: string, propertyTypeId: string) => ({ id, roomNumber, propertyTypeId, name: `Room ${roomNumber}` })
const rooms = [
  room('r101', '101', 'std'),
  room('r102', '102', 'std'),
  room('r108', '108', 'fam'),
  room('r110', '110+109', 'pres'),
  room('r111', '111', 'fam-dup'), // linked to a duplicate: never offered online
]

const groups = canonicalRoomTypes(types, rooms)
const byName = Object.fromEntries(groups.map((g) => [g.type.name, g]))

check('one entry per name, spacing and case ignored', groups.length, 4)
check('the row with rooms wins over newer copies', byName['Standard Room'].type.id, 'std')
check('the row with rooms wins over an older empty copy', byName['Presidential Suite'].type.id, 'pres')
check('rooms are counted on the live row', byName['Standard Room'].roomCount, 2)
check('the copies are kept aside, not lost', byName['Standard Room'].duplicates.map((d) => d.id), ['std-dup1', 'std-dup2'])
check('a room on a copy is reported as stranded', byName['Family Room'].strandedRooms, 1)
check('a new type with no rooms can still be priced and given rooms', byName['Tiwaah Executive']?.roomCount, 0)
check('a copy\'s id finds its group, so editing that room relinks it', groupOf(groups, 'fam-dup')?.type.id, 'fam')

// The row staff price must be the row the website shows and the booking page charges.
const site = dedupeRoomTypes(types, rooms)
for (const g of site) {
  check(`Set Prices edits the row the website charges for ${g.type.name}`, byName[g.type.name].type.id, g.type.id)
}

// With no rooms loaded yet (the Rooms page loads types first), the oldest row
// wins, which for every live name is the priced one.
const cold = Object.fromEntries(canonicalRoomTypes(types, []).map((g) => [g.type.name, g.type.id]))
check('before rooms load, the oldest row is offered', [cold['Standard Room'], cold['Family Room']], ['std', 'fam'])

// --- Names and numbers.
check('a type name is taken whatever its case and spacing', findTypeNamed(types, '  family   ROOM')?.id, 'fam')
check('a new name is free', findTypeNamed(types, 'Tiwaah Executive Suite'), undefined)
check('a room number is taken whatever its case and spacing', roomWithNumber(rooms, ' 110+109 ')?.id, 'r110')
check('a room keeps its own number when edited', roomWithNumber(rooms, '101', 'r101'), undefined)
check('an empty number never clashes', roomWithNumber(rooms, '  '), undefined)

// --- A room is priced by its type.
const tiwaah = types.find((t) => t.id === 'tiwaah')!
const fields = roomFields({ name: ' Tiwaah 201 ', roomNumber: ' 201 ', bedrooms: 1, bathrooms: 1, maxGuests: NaN }, tiwaah, '2026-11-05T12:00:00Z')
check('a new room takes its type\'s price', fields.basePrice, 900)
check('and its type\'s guest limit when none is given', fields.maxGuests, 2)
check('and is linked to the type', fields.propertyTypeId, 'tiwaah')
check('names and numbers are trimmed', [fields.name, fields.roomNumber], ['Tiwaah 201', '201'])
check('an edit leaves the room\'s housekeeping status alone', 'status' in roomMirrorFields({ roomNumber: '201', roomTypeId: 'tiwaah', price: 900 }), false)
check('a new mirror row is free to book, typed and priced', newRoomMirrorRow('r201', { roomNumber: '201', roomTypeId: 'tiwaah', price: 900 }, 'now'), {
  id: 'r201', roomNumber: '201', roomTypeId: 'tiwaah', price: 900, status: 'available', createdAt: 'now',
})
const newType = newRoomTypeRow({ name: '  Tiwaah   Executive ', capacity: 3, basePrice: 950 })
check('a new type stores its guest limit where booking and the concierge read it', [newType.capacity, newType.maxOccupancy], [3, 3])
check('a new type\'s name is tidied', newType.name, 'Tiwaah Executive')

// --- Every key written is a real column. One unknown key fails the whole write.
const definitions = (schema as any).definitions as Record<string, { properties: Record<string, unknown> }>
const snake = (k: string) => k.replace(/([A-Z])/g, '_$1').toLowerCase()
const unknownColumns = (table: string, payload: Record<string, unknown>) =>
  Object.keys(payload).map(snake).filter((c) => !(c in definitions[table].properties))

check('the checker catches the old rooms write (no updated_at)', unknownColumns('rooms', { roomNumber: '1', updatedAt: 'x' }), ['updated_at'])
check('the checker catches the old price sync (no properties.price)', unknownColumns('properties', { basePrice: 1, price: 1 }), ['price'])

const writes: Array<[string, string, Record<string, unknown>]> = [
  ['room_types', 'new room type', newType],
  ['room_types', 'room type details', roomTypeDetailsUpdate({ name: 'X', capacity: 2 })],
  ['room_types', 'room type price', roomTypePriceUpdate(1)],
  ['properties', 'new room', newRoomRow('r', fields)],
  ['properties', 'edited room', fields],
  ['properties', 'room price copy', roomPriceUpdate(1)],
  ['rooms', 'new mirror row', newRoomMirrorRow('r', { roomNumber: '1', roomTypeId: 't', price: 1 })],
  ['rooms', 'mirror update', roomMirrorFields({ roomNumber: '1', roomTypeId: 't', price: 1 })],
  ['rooms', 'mirror price copy', mirrorPriceUpdate(1)],
]
for (const [table, label, payload] of writes) check(`${label}: every column exists on ${table}`, unknownColumns(table, payload), [])

if (failures) {
  console.log(`FAILURE  ${failures} check(s) failed`)
  process.exit(1)
}
console.log('ALL PASS room types: one live row per name, the row the website charges, rooms priced by type, real columns only')
