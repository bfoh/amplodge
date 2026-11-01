import { useEffect, useState } from 'react'

import { db } from '@/lib/db'
import { PHOTOS, type Photo } from './photos'

/**
 * Room catalogue for the public site.
 *
 * The booking system is the source of truth for WHICH room categories exist:
 * every room type that has at least one room linked to it is shown and can be
 * booked, in price order. Nothing here fixes the number of categories, so a
 * type the owner adds in the staff portal appears on the site (with a
 * photographic placeholder) as soon as it has a room.
 *
 * This file only adds what the database doesn't hold: the photographs paired
 * with each known type, a one-line tagline and a note on what the photographs
 * show. Prices, guest numbers and descriptions are always live.
 *
 * room_types holds ~70 rows but only one row per name has rooms linked to it
 * (the rest are duplicates left by repeated seeding), so rows are grouped by
 * name and the row with the most linked rooms wins. Types with no rooms are
 * dropped. BookingPage uses the same rule (dedupeRoomTypes), so the type a
 * visitor picks here is the type the booking flow preselects and charges.
 */
export interface RoomEntry {
  /** URL slug, stable for a given type name. */
  slug: string
  name: string
  hero: Photo
  gallery: Photo[]
  /** What the photographs show. Not a claim about every room of the type. */
  photoNote: string
  tagline: string
  /** False for a type the site has no photographs of yet (the hero is then the lodge itself). */
  photographed: boolean
}

interface KnownRoom {
  hero: Photo
  gallery: Photo[]
  photoNote: string
  tagline: string
}

/** Photographs per known type, keyed by normalised type name. Pairings kept from the previous site. */
const KNOWN: Record<string, KnownRoom> = {
  'standard room': {
    hero: PHOTOS.roomStandard,
    gallery: [PHOTOS.roomStandard, PHOTOS.bedroomGreen, PHOTOS.deskGreen],
    photoNote: 'Pictured: green walls, a wooden double bed and a reading chair.',
    tagline: 'Comfort in its simplest form.',
  },
  'executive suite': {
    hero: PHOTOS.roomExecutive,
    gallery: [PHOTOS.roomExecutive, PHOTOS.bedsideDetail, PHOTOS.deskOrange],
    photoNote: 'Pictured: warm amber walls, a dark wood double bed and an armchair.',
    tagline: 'Settle into something special.',
  },
  'deluxe room': {
    hero: PHOTOS.roomDeluxe,
    gallery: [PHOTOS.roomDeluxe],
    photoNote: 'Pictured: soft grey walls, a double bed in navy bedding and an armchair.',
    tagline: 'A quieter kind of comfort.',
  },
  'family room': {
    hero: PHOTOS.roomFamily,
    gallery: [PHOTOS.roomFamily],
    photoNote: 'Pictured: two beds and teal curtains.',
    tagline: 'More room for moments together.',
  },
  'presidential suite': {
    hero: PHOTOS.roomPresidential,
    gallery: [PHOTOS.roomPresidential, PHOTOS.suiteLounge, PHOTOS.diningArea],
    photoNote: 'Pictured: the suite lounge with red leather recliners and marble floors.',
    tagline: 'Room to gather, and room to rest.',
  },
}

const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const titleCase = (s: string) => s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

export function roomSlug(name: string): string {
  return normalize(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function entryFor(rawName: string): RoomEntry {
  const key = normalize(rawName)
  const name = titleCase(key)
  const known = KNOWN[key]
  if (known) return { slug: roomSlug(name), name, photographed: true, ...known }
  // A type the site has no photographs of yet: show the lodge itself and say so.
  return {
    slug: roomSlug(name),
    name,
    hero: PHOTOS.exteriorRoad,
    gallery: [],
    photoNote: 'Photographs of this room are coming soon. Pictured: the lodge.',
    tagline: '',
    photographed: false,
  }
}

/** The known types, in price order, used while live data loads (no prices are ever shown from here). */
export const KNOWN_ROOMS: RoomEntry[] = ['standard room', 'executive suite', 'deluxe room', 'family room', 'presidential suite'].map(entryFor)

export interface LiveRoom extends RoomEntry {
  /** room_types.id of the row bookings use; null until loaded. */
  typeId: string | null
  /** Nightly rate in the property currency; null until loaded or if unknown. */
  price: number | null
  maxGuests: number | null
  description: string
  /** Rooms of this type in the booking system. */
  roomCount: number
}

type AnyRow = Record<string, unknown>

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

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

/**
 * Whether a type can be booked online. Every active type can: since
 * 2026-11-01 the Executive Suite books through the same flow as the rest (it
 * had been enquiry-only since the first commit). Kept as the one place a rule
 * would go, shared with BookingPage.
 */
export function isBookableOnline(name: string): boolean {
  return normalize(name).length > 0
}

function placeholder(entry: RoomEntry): LiveRoom {
  return { ...entry, typeId: null, price: null, maxGuests: null, description: '', roomCount: 0 }
}

function toLive(group: { type: AnyRow; roomCount: number; propertyPrice: number | null }): LiveRoom {
  const t = group.type
  const entry = entryFor(String(t.name ?? ''))
  const description = String(t.description ?? '').trim()
  return {
    ...entry,
    tagline: entry.tagline || description,
    typeId: String(t.id),
    price: num(t.basePrice ?? t.base_price) ?? group.propertyPrice ?? null,
    maxGuests: num(t.maxOccupancy ?? t.max_occupancy ?? t.capacity),
    description,
    roomCount: group.roomCount,
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
  const promise = Promise.all([db.roomTypes.list({ orderBy: { createdAt: 'asc' } }), db.properties.list()]).then(([types, properties]) =>
    dedupeRoomTypes(types as unknown as AnyRow[], properties as unknown as AnyRow[])
      .filter((g) => isBookableOnline(String(g.type.name ?? '')))
      .map(toLive)
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.name.localeCompare(b.name)),
  )
  cache = { at: Date.now(), promise }
  promise.catch(() => {
    cache = null
  })
  return promise
}

/**
 * Live rooms. While loading (or if the request fails) the known types are
 * returned without prices, so pages render their layout at once and never
 * show stale or invented rates.
 */
export function useRooms(): RoomsState {
  const [state, setState] = useState<RoomsState>(() => ({ rooms: KNOWN_ROOMS.map(placeholder), status: 'loading' }))
  useEffect(() => {
    let alive = true
    fetchRooms()
      .then((rooms) => alive && setState({ rooms: rooms.length ? rooms : KNOWN_ROOMS.map(placeholder), status: rooms.length ? 'ready' : 'error' }))
      .catch(() => alive && setState((s) => ({ ...s, status: 'error' })))
    return () => {
      alive = false
    }
  }, [])
  return state
}

/** A known type by slug, without waiting for live data (contact form, page titles). */
export function findKnownRoom(slug: string | undefined): RoomEntry | undefined {
  return KNOWN_ROOMS.find((r) => r.slug === slug)
}

export function formatRate(price: number | null, currency = 'GHS'): string | null {
  if (price === null) return null
  try {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price)
  } catch {
    return `${currency} ${Math.round(price)}`
  }
}

export interface BookingIntent {
  checkIn?: string
  checkOut?: string
  guests?: number
}

/**
 * The one entry point into the booking flow, used by every "Book" action on
 * the site: header, hero, film, room navigator, room cards, room pages and the
 * closing invitation. With a room, the flow opens with that type preselected.
 */
export function bookingHref(room?: Pick<LiveRoom, 'typeId'> | null, opts: BookingIntent = {}): string {
  const q = new URLSearchParams()
  if (room?.typeId) q.set('roomType', room.typeId)
  if (opts.checkIn) q.set('checkIn', opts.checkIn)
  if (opts.checkOut) q.set('checkOut', opts.checkOut)
  if (opts.guests) q.set('guests', String(opts.guests))
  const s = q.toString()
  return s ? `/booking?${s}` : '/booking'
}
