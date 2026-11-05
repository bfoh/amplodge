/**
 * Room types and rooms, as the staff portal manages them.
 *
 * Prices are set per room TYPE. The website, the online booking page, on-site
 * bookings and the AI concierge all charge `room_types.base_price`; a room's
 * own `properties.base_price` is only a copy kept in step with its type.
 *
 * room_types holds about 70 rows for five names. The Rooms page used to
 * re-create any default type it could not find on every load, and each
 * insert's realtime echo re-ran that check, so one visit could add dozens of
 * rows (57 in 18 seconds on 2026-06-05). Only one row per name has rooms
 * linked to it, and that row is the one the website shows and the booking
 * flow charges: `dedupeRoomTypes` in src/site/data/rooms.ts keeps, per name,
 * the row with the most rooms. Staff pages must price and assign that same
 * row, or a price change lands on a duplicate that nothing reads.
 *
 * Rooms live in two tables. `properties` is the room list every page reads;
 * `rooms` is a legacy mirror that `bookings.room_id` points at and that the
 * AI concierge's availability check reads. The two must share an id.
 */

type Row = Record<string, any>

export const normalizeName = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const normalizeRoomNumber = (s: unknown): string => String(s ?? '').trim().toLowerCase()

/** The room type a room row points at. The column name varies by row age. */
export function linkedTypeId(room: Row): string {
  return String(room.propertyTypeId ?? room.property_type_id ?? room.roomTypeId ?? room.room_type_id ?? '')
}

export interface RoomTypeGroup<T extends Row> {
  /** The row staff edit and assign: the one the website and bookings use. */
  type: T
  /** Rooms linked to this type. */
  roomCount: number
  /** Other rows with the same name. The website and bookings ignore them. */
  duplicates: T[]
  /** Rooms linked to one of the duplicates, which the online booking page never offers. Re-saving the room relinks it. */
  strandedRooms: number
}

const createdAt = (t: Row) => String(t.createdAt ?? t.created_at ?? '')

/**
 * One entry per room-type name: the row with the most rooms, then the oldest,
 * then the lowest id. Types with no rooms are kept, so a type the owner has
 * just created can be priced and given its first room.
 *
 * Whenever any row of a name has rooms, the winner is the row the website
 * picks, because both choose the row with the most rooms.
 */
export function canonicalRoomTypes<T extends Row>(types: T[], rooms: Row[]): Array<RoomTypeGroup<T>> {
  const linked = new Map<string, number>()
  const nameOnly = new Map<string, number>()
  for (const room of rooms) {
    const id = linkedTypeId(room)
    if (id) linked.set(id, (linked.get(id) ?? 0) + 1)
    else if (room.propertyType) {
      const key = normalizeName(room.propertyType)
      nameOnly.set(key, (nameOnly.get(key) ?? 0) + 1)
    }
  }

  const groups = new Map<string, T[]>()
  for (const type of types) {
    const key = normalizeName(type.name)
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), type])
  }

  return [...groups.entries()].map(([key, rows]) => {
    const ranked = [...rows].sort(
      (a, b) =>
        (linked.get(String(b.id)) ?? 0) - (linked.get(String(a.id)) ?? 0) ||
        createdAt(a).localeCompare(createdAt(b)) ||
        String(a.id).localeCompare(String(b.id)),
    )
    const [type, ...duplicates] = ranked
    return {
      type,
      roomCount: (linked.get(String(type.id)) ?? 0) + (nameOnly.get(key) ?? 0),
      duplicates,
      strandedRooms: duplicates.reduce((n, t) => n + (linked.get(String(t.id)) ?? 0), 0),
    }
  })
}

/** The group a room type id belongs to, duplicates included. */
export function groupOf<T extends Row>(groups: Array<RoomTypeGroup<T>>, typeId: string): RoomTypeGroup<T> | undefined {
  if (!typeId) return undefined
  return groups.find((g) => g.type.id === typeId || g.duplicates.some((d) => d.id === typeId))
}

/** A type already called this, ignoring case and spacing (duplicates included). */
export function findTypeNamed<T extends Row>(types: T[], name: string, exceptId?: string): T | undefined {
  const key = normalizeName(name)
  return types.find((t) => normalizeName(t.name) === key && t.id !== exceptId)
}

/**
 * A room already using this number. Bookings find their room by number, and
 * the staff booking screens keep only the first room with a given number, so
 * a second one would be silently unbookable.
 */
export function roomWithNumber<T extends Row>(rooms: T[], roomNumber: string, exceptId?: string): T | undefined {
  const key = normalizeRoomNumber(roomNumber)
  if (!key) return undefined
  return rooms.find((r) => normalizeRoomNumber(r.roomNumber ?? r.room_number) === key && r.id !== exceptId)
}

const positive = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** A type's nightly rate, or null when it has none. */
export function typePrice(type: Row | undefined): number | null {
  return type ? positive(type.basePrice ?? type.base_price) : null
}

/** A type's guest limit. Online booking reads `capacity`; the concierge reads `max_occupancy`. */
export function typeCapacity(type: Row | undefined): number | null {
  return type ? positive(type.capacity ?? type.maxOccupancy ?? type.max_occupancy) : null
}

// ---------------------------------------------------------------------------
// Write payloads. Every key here must be a real column: the wrapper sends keys
// as given, and one unknown column fails the whole write. Two did: rooms has no
// updated_at (so no new room ever reached the mirror) and properties has no
// price (so a price change never reached any room). tests/room-types.test.ts
// checks every key against schema.json.
// ---------------------------------------------------------------------------

/** A new room type, priced and with its guest limit in both columns that hold it. */
export function newRoomTypeRow(input: { name: string; capacity: number; basePrice: number; description?: string }, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    name: input.name.trim().replace(/\s+/g, ' '),
    description: input.description?.trim() ?? '',
    basePrice: input.basePrice,
    capacity: input.capacity,
    maxOccupancy: input.capacity,
    createdAt: now,
    updatedAt: now,
  }
}

/** A room type's details, without its price (priced on its own row of the table). */
export function roomTypeDetailsUpdate(input: { name: string; capacity: number; description?: string }, now = new Date().toISOString()) {
  return {
    name: input.name.trim().replace(/\s+/g, ' '),
    description: input.description?.trim() ?? '',
    capacity: input.capacity,
    maxOccupancy: input.capacity,
    updatedAt: now,
  }
}

export function roomTypePriceUpdate(basePrice: number, now = new Date().toISOString()) {
  return { basePrice, updatedAt: now }
}

/** A room's own fields (properties table), priced from its type. */
export function roomFields(
  input: { name: string; roomNumber: string; address?: string; bedrooms: unknown; bathrooms: unknown; maxGuests: unknown; description?: string },
  type: Row,
  now = new Date().toISOString(),
) {
  const whole = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
  return {
    name: input.name.trim(),
    roomNumber: input.roomNumber.trim(),
    address: input.address?.trim() ?? '',
    propertyTypeId: String(type.id),
    bedrooms: whole(input.bedrooms, 1),
    bathrooms: whole(input.bathrooms, 1),
    maxGuests: whole(input.maxGuests, typeCapacity(type) ?? 2),
    basePrice: typePrice(type),
    description: input.description ?? '',
    updatedAt: now,
  }
}

export function newRoomRow(id: string, fields: ReturnType<typeof roomFields>) {
  return { id, ...fields, status: 'active', createdAt: fields.updatedAt }
}

/** The copy of its type's price a room keeps (properties table). */
export function roomPriceUpdate(basePrice: number, now = new Date().toISOString()) {
  return { basePrice, updatedAt: now }
}

/** The legacy mirror's copy of the price (rooms table). */
export function mirrorPriceUpdate(price: number) {
  return { price }
}

/**
 * The rooms-table row for a room. Status is left out on purpose: check-in,
 * check-out and housekeeping move it, and an edit must not reset it.
 */
export function roomMirrorFields(room: { roomNumber: string; roomTypeId: string; price: number | null }) {
  return { roomNumber: room.roomNumber, roomTypeId: room.roomTypeId || null, price: room.price }
}

export function newRoomMirrorRow(id: string, room: { roomNumber: string; roomTypeId: string; price: number | null }, now = new Date().toISOString()) {
  return { id, ...roomMirrorFields(room), status: 'available', createdAt: now }
}
