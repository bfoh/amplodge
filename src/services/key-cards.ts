/**
 * Door-lock key cards, as the staff portal sees them.
 *
 * The browser only reads here. Every change goes through a Netlify function
 * (key-card-mark, room-locks-save), because which door a card opens and until
 * when is the server's decision. Cards themselves are written on the reception
 * PC by the lock bridge, from orders the server signs (key-card-order).
 */
import { db } from '@/lib/db'
import { callFunction } from '@/lib/api'

export type KeyCardStatus =
  | 'pending' | 'issued' | 'failed' | 'unknown'
  | 'returned' | 'not_returned' | 'killed_at_door' | 'erased'
  | 'replaced'

export interface KeyCard {
  id: string
  bookingId: string | null
  roomId: string | null
  guestName: string | null
  roomNumber: string | null
  lockNos: string[]
  orderNonce: string
  cardNo: number
  issueTime: string
  validUntil: string
  status: KeyCardStatus
  error: string | null
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface RoomLock {
  id: string
  roomId: string
  lockNo: string
  label: string | null
}

interface BookingRow {
  id: string
  roomId: string
  guestId: string | null
  status: string
  checkIn: string
  checkOut: string
}

export interface NeedsCard {
  bookingId: string
  guestName: string
  roomNumber: string
  checkOut: string
  arrivingToday: boolean
}

export interface KeyCardBoard {
  /** False until an admin has set at least one lock number. */
  configured: boolean
  /** Checked in (or arriving today) in a room with a lock, and no working card. */
  needsCard: NeedsCard[]
  /** Still opens a door although the stay is over or cancelled. */
  shouldBeGone: KeyCard[]
  /** Opens a door of a room the guest is no longer in. */
  wrongRoom: KeyCard[]
  /** The write was cut off: nobody knows whether the card works. */
  unknown: KeyCard[]
  /** Every card that can open a door right now. */
  live: KeyCard[]
}

export const STATUS_LABEL: Record<KeyCardStatus, string> = {
  pending: 'Being written',
  issued: 'Working',
  failed: 'Write failed',
  unknown: 'Check this card',
  returned: 'Returned',
  not_returned: 'Guest kept it',
  killed_at_door: 'Cancelled at door',
  erased: 'Erased',
  replaced: 'Replaced (lost)',
}

const LIVE: KeyCardStatus[] = ['issued', 'unknown', 'not_returned']
const STAYING = ['checked-in', 'confirmed', 'reserved']

export function canOpenDoor(card: KeyCard, now = new Date()): boolean {
  return LIVE.includes(card.status) && new Date(card.validUntil) > now
}

/** Ghana is on GMT all year, so the hotel's date is the UTC date. */
const hotelToday = (now = new Date()) => now.toISOString().slice(0, 10)

export async function loadKeyCardBoard(now = new Date()): Promise<KeyCardBoard> {
  const today = hotelToday(now)
  const [locks, cards, checkedIn, arriving] = await Promise.all([
    db.roomLocks.list() as Promise<RoomLock[]>,
    db.keyCards.list({ where: { validUntil: { gt: now.toISOString() } } }) as Promise<KeyCard[]>,
    db.bookings.list({ where: { status: 'checked-in' } }) as Promise<BookingRow[]>,
    db.bookings.list({ where: { checkIn: today, status: { in: ['confirmed', 'reserved'] } } }) as Promise<BookingRow[]>,
  ])
  const live = cards.filter((c) => canOpenDoor(c, now))
  const empty: KeyCardBoard = { configured: locks.length > 0, needsCard: [], shouldBeGone: [], wrongRoom: [], unknown: [], live }
  if (!locks.length) return empty

  // Bookings of live cards that are not in the lists above (checked out, cancelled, moved).
  const known = new Map<string, BookingRow>([...checkedIn, ...arriving].map((b) => [b.id, b]))
  const missing = [...new Set(live.map((c) => c.bookingId).filter((id): id is string => !!id && !known.has(id)))]
  if (missing.length) {
    const more = (await db.bookings.list({ where: { id: { in: missing } } })) as BookingRow[]
    more.forEach((b) => known.set(b.id, b))
  }

  const lockedRooms = new Set(locks.map((l) => l.roomId))
  const stays = [...checkedIn, ...arriving].filter((b) => lockedRooms.has(b.roomId))
  const [rooms, guests] = await Promise.all([
    stays.length ? db.rooms.list({ where: { id: { in: [...new Set(stays.map((b) => b.roomId))] } } }) : Promise.resolve([]),
    stays.length ? db.guests.list({ where: { id: { in: [...new Set(stays.map((b) => b.guestId).filter(Boolean))] } } }) : Promise.resolve([]),
  ])
  const roomNo = new Map((rooms as Array<{ id: string; roomNumber: string }>).map((r) => [r.id, r.roomNumber]))
  const guestName = new Map((guests as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]))

  const working = new Set(live.filter((c) => c.status !== 'not_returned').map((c) => c.bookingId))
  const needsCard = stays
    .filter((b) => !working.has(b.id))
    .map((b) => ({
      bookingId: b.id,
      guestName: (b.guestId && guestName.get(b.guestId)) || 'Guest',
      roomNumber: roomNo.get(b.roomId) || '?',
      checkOut: String(b.checkOut).slice(0, 10),
      arrivingToday: b.status !== 'checked-in',
    }))
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))

  const shouldBeGone: KeyCard[] = []
  const wrongRoom: KeyCard[] = []
  for (const c of live) {
    const b = c.bookingId ? known.get(c.bookingId) : undefined
    if (!b || !STAYING.includes(b.status)) shouldBeGone.push(c)
    else if (c.roomId && b.roomId !== c.roomId) wrongRoom.push(c)
  }

  return { ...empty, needsCard, shouldBeGone, wrongRoom, unknown: live.filter((c) => c.status === 'unknown') }
}

async function post(name: string, body: unknown) {
  const res = await callFunction(name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export type CardMark = 'returned' | 'not_returned' | 'killed_at_door'

export function markCard(cardId: string, status: CardMark, note?: string) {
  return post('key-card-mark', { cardId, status, note })
}

export function saveRoomLocks(roomId: string, locks: Array<{ lockNo: string; label?: string | null }>): Promise<{ locks: unknown[] }> {
  return post('room-locks-save', { roomId, locks })
}

/** The 6-character code Joney's Lock Management System shows for a door: 0-9 and A-F, e.g. 01020A. */
export const isLockNo = (s: string) => /^[0-9A-F]{6}$/.test(s)
export const normalizeLockNo = (s: string) => s.trim().toUpperCase()
