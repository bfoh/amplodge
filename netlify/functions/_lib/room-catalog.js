/**
 * The rooms the AI concierge offers and books: the same rooms, room types,
 * prices and availability rule as the website and the staff portal.
 *
 * The concierge used to read the legacy `rooms` table and count only rows
 * whose status was 'clean' or 'available'. That table is a mirror the Rooms
 * page never kept complete. On 2026-11-05 it was missing rooms 201-204, held
 * seven rows for rooms no longer on the Rooms page (222, 333, 444 and 555
 * marked available), and marked most real rooms 'active', which the filter
 * skipped. Its status is today's housekeeping state anyway, not whether a room
 * is free on the dates asked about. Any booking not cancelled blocked a room,
 * checked-out ones included.
 *
 * Now, as on the website (src/site/data/rooms.ts, src/lib/availability.ts):
 *  - rooms are the `properties` table (the Rooms page), less rooms that are
 *    archived; rooms under maintenance exist but are never free;
 *  - each name's room type is the row with the most rooms (room_types once
 *    held about 70 rows for five names), and its base_price is the price;
 *  - a room is taken on dates that overlap a reserved, confirmed or
 *    checked-in booking: the rule the database's bookings_no_room_overlap
 *    constraint enforces.
 *
 * bookings.room_id points at the `rooms` mirror, so a booking needs the
 * room's mirror row; ensureRoomMirror creates it if the Rooms page didn't.
 */

export const ACTIVE_BOOKING_STATUSES = ['reserved', 'confirmed', 'checked-in']

const ARCHIVED = new Set(['inactive', 'archived', 'deleted'])

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const positive = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
}

/** Nightly rate, or null when the type has none. */
export const typePrice = (type) => positive(type?.base_price)

/** Guest limit: `capacity` is what the booking page enforces; `max_occupancy` is the older column. */
export const typeCapacity = (type) => positive(type?.capacity ?? type?.max_occupancy)

const byRoomNumber = (a, b) => String(a.room_number ?? '').localeCompare(String(b.room_number ?? ''), undefined, { numeric: true })

/**
 * One entry per room-type name that has rooms, cheapest first:
 * `{ type, duplicateIds, rooms }`. Rooms linked to a duplicate type row are
 * left out, as on the website (re-saving such a room on the Rooms page
 * relinks it).
 */
export function buildCatalog(types, rooms) {
    const live = (rooms || []).filter((r) => !ARCHIVED.has(norm(r.status)))
    const linked = new Map()
    for (const r of live) {
        if (r.property_type_id) linked.set(r.property_type_id, (linked.get(r.property_type_id) ?? 0) + 1)
    }

    const groups = new Map()
    for (const t of types || []) {
        const key = norm(t.name)
        if (!key) continue
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(t)
    }

    const entries = []
    for (const rows of groups.values()) {
        rows.sort(
            (a, b) =>
                (linked.get(b.id) ?? 0) - (linked.get(a.id) ?? 0) ||
                String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
                String(a.id).localeCompare(String(b.id))
        )
        const [type, ...duplicates] = rows
        const typeRooms = live.filter((r) => r.property_type_id === type.id).sort(byRoomNumber)
        if (typeRooms.length === 0) continue
        entries.push({ type, duplicateIds: duplicates.map((d) => d.id), rooms: typeRooms })
    }

    return entries.sort(
        (a, b) =>
            (typePrice(a.type) ?? Infinity) - (typePrice(b.type) ?? Infinity) || String(a.type.name).localeCompare(String(b.type.name))
    )
}

/** The entry a room-type id belongs to, including the id of an old duplicate. */
export function findEntry(catalog, typeId) {
    if (!typeId) return undefined
    return catalog.find((e) => e.type.id === typeId || e.duplicateIds.includes(typeId))
}

/** Rooms of an entry that can be booked, given the ids of rooms taken on the dates. */
export function freeRooms(entry, busyRoomIds) {
    return entry.rooms.filter((r) => norm(r.status) !== 'maintenance' && !busyRoomIds.has(r.id))
}

export async function loadCatalog(supabase) {
    const [types, rooms] = await Promise.all([
        supabase.from('room_types').select('id, name, description, base_price, capacity, max_occupancy, created_at'),
        supabase.from('properties').select('id, name, room_number, property_type_id, status'),
    ])
    if (types.error) throw types.error
    if (rooms.error) throw rooms.error
    return buildCatalog(types.data, rooms.data)
}

/** Ids of rooms taken by an active booking overlapping [checkIn, checkOut). */
export async function busyRoomIds(supabase, checkIn, checkOut, roomIds) {
    let query = supabase
        .from('bookings')
        .select('room_id')
        .in('status', ACTIVE_BOOKING_STATUSES)
        .lt('check_in', checkOut)
        .gt('check_out', checkIn)
    if (roomIds) query = query.in('room_id', roomIds)
    const { data, error } = await query
    if (error) throw error
    return new Set((data || []).map((b) => b.room_id))
}

/** Make sure the room has the `rooms` row its booking will point at. */
export async function ensureRoomMirror(supabase, room, type) {
    const { data, error } = await supabase.from('rooms').select('id').eq('id', room.id).maybeSingle()
    if (error) throw error
    if (data) return
    const { error: insertError } = await supabase.from('rooms').insert({
        id: room.id,
        room_number: room.room_number,
        room_type_id: type.id,
        price: typePrice(type),
        status: 'available',
    })
    if (!insertError) return
    // 23505 is fine only if another request created this row meanwhile. If
    // something else is unique (an orphaned row holding the room number), the
    // row still isn't there and the booking would fail its foreign key.
    if (insertError.code === '23505') {
        const again = await supabase.from('rooms').select('id').eq('id', room.id).maybeSingle()
        if (again.data) return
    }
    throw insertError
}

const PHOTOS = {
    'standard room': 'room-standard-1024.jpg',
    'executive suite': 'room-executive-suite-1024.jpg',
    'deluxe room': 'room-deluxe-1024.jpg',
    'family room': 'room-family-576.jpg',
    'presidential suite': 'room-presidential-suite-560.jpg',
}

/** The lodge's own photograph of a type, or of the lodge for a type it has none of yet (as the website does). */
export function typePhotos(type, siteUrl = 'https://amplodge.org') {
    const file = PHOTOS[norm(type?.name)] || 'exterior-road-1080.jpg'
    return [`${siteUrl.replace(/\/$/, '')}/images/property/${file}`]
}
