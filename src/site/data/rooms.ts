import { useEffect, useState } from 'react'

import { db } from '@/lib/db'
import { PHOTOS, type Photo } from './photos'

/**
 * Room catalogue for the public site.
 *
 * Static part (this file): slug, display name, photographs. The photo for each
 * type is the one the previous site already used for it, so no pairing is
 * new; the event hall is never shown as a bedroom.
 *
 * Live part (Supabase): price, max guests, description. room_types holds ~70
 * rows but only one row per name has rooms linked to it (the rest are
 * duplicates left by repeated seeding), so rows are grouped by name and the
 * row with the most linked rooms wins. Types with no rooms are dropped. This is
 * the same rule BookingPage uses (see dedupeRoomTypes there), so the price a
 * guest sees here is the price they are charged.
 */
export interface RoomCatalogEntry {
  slug: string
  name: string
  /** Lower-case name used to match room_types rows. */
  match: string
  hero: Photo
  gallery: Photo[]
  /** What the photograph shows. Not a claim about every room of the type. */
  photoNote: string
}

export const ROOM_CATALOG: RoomCatalogEntry[] = [
  {
    slug: 'standard-room',
    name: 'Standard Room',
    match: 'standard room',
    hero: PHOTOS.roomStandard,
    gallery: [PHOTOS.roomStandard, PHOTOS.bedroomGreen, PHOTOS.deskGreen],
    photoNote: 'Pictured: green walls, a wooden double bed and a reading chair.',
  },
  {
    slug: 'executive-suite',
    name: 'Executive Suite',
    match: 'executive suite',
    hero: PHOTOS.roomExecutive,
    gallery: [PHOTOS.roomExecutive, PHOTOS.bedsideDetail, PHOTOS.deskOrange],
    photoNote: 'Pictured: warm amber walls, a dark wood double bed and an armchair.',
  },
  {
    slug: 'deluxe-room',
    name: 'Deluxe Room',
    match: 'deluxe room',
    hero: PHOTOS.roomDeluxe,
    gallery: [PHOTOS.roomDeluxe],
    photoNote: 'Pictured: soft grey walls and a double bed in navy bedding.',
  },
  {
    slug: 'family-room',
    name: 'Family Room',
    match: 'family room',
    hero: PHOTOS.roomFamily,
    gallery: [PHOTOS.roomFamily],
    photoNote: 'Pictured: two beds and teal curtains.',
  },
  {
    slug: 'presidential-suite',
    name: 'Presidential Suite',
    match: 'presidential suite',
    hero: PHOTOS.roomPresidential,
    gallery: [PHOTOS.roomPresidential, PHOTOS.suiteLounge, PHOTOS.diningArea],
    photoNote: 'Pictured: the suite lounge with red leather recliners and marble floors.',
  },
]

/**
 * Executive Suite has been excluded from online booking in code since commit
 * 99d5d77 (2025-12-13). The public site keeps that rule and offers an
 * enquiry instead. Shared with BookingPage so both stay in step.
 */
export function isBookableOnline(name: string): boolean {
  return !name.toLowerCase().includes('executive suite')
}

export interface LiveRoom extends RoomCatalogEntry {
  typeId: string | null
  /** Nightly rate in the property currency; null until loaded or if unknown. */
  price: number | null
  maxGuests: number | null
  description: string
  bookable: boolean
}

type AnyRow = Record<string, unknown>

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase()

/** Group duplicate room_types rows by name; keep the row with the most rooms. */
export function dedupeRoomTypes<T extends AnyRow>(types: T[], properties: AnyRow[]): Array<{ type: T; roomCount: number; propertyPrice: number | null }> {
  const roomsFor = (t: T) =>
    properties.filter((p) => {
      const typeId = p.propertyTypeId ?? p.property_type_id ?? p.roomTypeId
      return typeId ? typeId === t.id : normalize(p.propertyType) === normalize(t.name)
    })
  const best = new Map<string, { type: T; roomCount: number; propertyPrice: number | null }>()
  for (const type of types) {
    const rooms = roomsFor(type)
    const key = normalize(type.name)
    const current = best.get(key)
    if (!current || rooms.length > current.roomCount) {
      const priced = rooms.map((r) => num(r.basePrice ?? r.base_price ?? r.price)).find((n) => n !== null) ?? null
      best.set(key, { type, roomCount: rooms.length, propertyPrice: priced })
    }
  }
  return Array.from(best.values()).filter((g) => g.roomCount > 0)
}

function toLive(entry: RoomCatalogEntry, group?: { type: AnyRow; propertyPrice: number | null }): LiveRoom {
  const t = group?.type
  return {
    ...entry,
    typeId: t ? String(t.id) : null,
    price: t ? num(t.basePrice ?? t.base_price) ?? group?.propertyPrice ?? null : null,
    maxGuests: t ? num(t.maxOccupancy ?? t.max_occupancy ?? t.capacity) : null,
    description: t ? String(t.description ?? '').trim() : '',
    bookable: isBookableOnline(entry.name),
  }
}

export interface RoomsState {
  rooms: LiveRoom[]
  status: 'loading' | 'ready' | 'error'
}

let cache: { at: number; promise: Promise<LiveRoom[]> } | null = null
const CACHE_MS = 5 * 60 * 1000

function fetchRooms(): Promise<LiveRoom[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.promise
  const promise = Promise.all([db.roomTypes.list({ orderBy: { createdAt: 'asc' } }), db.properties.list()]).then(([types, properties]) => {
    const groups = dedupeRoomTypes(types as unknown as AnyRow[], properties as unknown as AnyRow[])
    const byName = new Map(groups.map((g) => [normalize(g.type.name), g]))
    const known = ROOM_CATALOG.filter((e) => byName.has(e.match)).map((e) => toLive(e, byName.get(e.match)))
    return known.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
  })
  cache = { at: Date.now(), promise }
  promise.catch(() => {
    cache = null
  })
  return promise
}

/**
 * Live rooms. While loading (or if the request fails) the static catalogue is
 * returned without prices, so pages render their layout at once and never
 * show stale or invented rates.
 */
export function useRooms(): RoomsState {
  const [state, setState] = useState<RoomsState>(() => ({ rooms: ROOM_CATALOG.map((e) => toLive(e)), status: 'loading' }))
  useEffect(() => {
    let alive = true
    fetchRooms()
      .then((rooms) => alive && setState({ rooms: rooms.length ? rooms : ROOM_CATALOG.map((e) => toLive(e)), status: rooms.length ? 'ready' : 'error' }))
      .catch(() => alive && setState((s) => ({ ...s, status: 'error' })))
    return () => {
      alive = false
    }
  }, [])
  return state
}

export function findRoom(slug: string | undefined): RoomCatalogEntry | undefined {
  return ROOM_CATALOG.find((r) => r.slug === slug)
}

export function formatRate(price: number | null, currency = 'GHS'): string | null {
  if (price === null) return null
  try {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price)
  } catch {
    return `${currency} ${Math.round(price)}`
  }
}

/** The booking flow's entry point for a room, with optional dates and guests. */
export function bookingHref(room?: Pick<LiveRoom, 'typeId'> | null, opts: { checkIn?: string; checkOut?: string; guests?: number } = {}): string {
  const q = new URLSearchParams()
  if (room?.typeId) q.set('roomType', room.typeId)
  if (opts.checkIn) q.set('checkIn', opts.checkIn)
  if (opts.checkOut) q.set('checkOut', opts.checkOut)
  if (opts.guests) q.set('guests', String(opts.guests))
  const s = q.toString()
  return s ? `/booking?${s}` : '/booking'
}
