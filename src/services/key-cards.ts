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
import type { CardReading } from '@/services/lock-bridge'

export type KeyCardStatus =
  | 'pending' | 'issued' | 'failed' | 'unknown'
  | 'returned' | 'not_returned' | 'killed_at_door' | 'erased'
  | 'replaced' | 'locked_out'

export interface KeyCard {
  id: string
  /** 'lockout': a lock-out card, which belongs to no stay (null before the 20261108140000 migration). */
  kind?: 'guest' | 'lockout' | null
  bookingId: string | null
  roomId: string | null
  guestName: string | null
  roomNumber: string | null
  lockNos: string[]
  /** The card's DAI (null before the V0925 migration). */
  dai?: number | null
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

export interface EndsEarly {
  bookingId: string
  guestName: string
  roomNumber: string
  checkOut: string
  /** When the first of these cards stops. */
  validUntil: string
  cards: number
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
  /** Checked in, with cards that stop before the stay does: it was extended, or runs past 30 days. */
  endsEarly: EndsEarly[]
  /** The write was cut off: nobody knows whether the card works. */
  unknown: KeyCard[]
  /** Every guest card that can open a door right now. */
  live: KeyCard[]
  /** Lock-out cards not yet expired: each is to be held to its door once. */
  lockouts: KeyCard[]
  /** Every room with a door lock, for "Lock out a door". */
  doors: Array<{ roomId: string; roomNumber: string }>
}

export const STATUS_LABEL: Record<KeyCardStatus, string> = {
  pending: 'Being written',
  issued: 'Working',
  failed: 'Write failed',
  unknown: 'Check this card',
  returned: 'Returned',
  not_returned: 'Guest kept it',
  killed_at_door: 'Cancelled at door',
  erased: 'Written again',
  replaced: 'Replaced (lost)',
  locked_out: 'Locked out',
}

const LIVE: KeyCardStatus[] = ['issued', 'unknown', 'not_returned']
const STAYING = ['checked-in', 'confirmed', 'reserved']

export function canOpenDoor(card: KeyCard, now = new Date()): boolean {
  return LIVE.includes(card.status) && new Date(card.validUntil) > now
}

/** Ghana is on GMT all year, so the hotel's date is the UTC date. */
const hotelToday = (now = new Date()) => now.toISOString().slice(0, 10)

/** A time in hotel time (GMT), whatever the PC's own zone: "Sat 8 Nov, 12:00". */
export const hotelTime = (iso: string | Date) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** A hotel date (YYYY-MM-DD): "Tue 11 Nov". */
export const hotelDay = (date: string) =>
  new Date(`${String(date).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })

/**
 * A card stops on a day before the stay's check-out day (cards stop on check-out
 * day, an hour after check-out time): the stay was extended, or is longer than a
 * card may run.
 */
export function endsBefore(card: Pick<KeyCard, 'validUntil'>, checkOut: string): boolean {
  return new Date(card.validUntil).toISOString().slice(0, 10) < String(checkOut).slice(0, 10)
}

/** A card made for the room as it is now: it opens only doors of the room. */
export const withinLocks = (card: string[], room: string[]) => card.length > 0 && card.every((x) => room.includes(x))

/** A stay's guest cards, every state, oldest first. */
export async function loadStayCards(bookingId: string): Promise<KeyCard[]> {
  const cards = (await db.keyCards.list({ where: { bookingId }, orderBy: { createdAt: 'asc' }, limit: 100 })) as KeyCard[]
  return cards.filter((c) => c.kind !== 'lockout')
}

export async function loadKeyCardBoard(now = new Date()): Promise<KeyCardBoard> {
  const today = hotelToday(now)
  const [locks, cards, checkedIn, arriving] = await Promise.all([
    db.roomLocks.list() as Promise<RoomLock[]>,
    db.keyCards.list({ where: { validUntil: { gt: now.toISOString() } } }) as Promise<KeyCard[]>,
    db.bookings.list({ where: { status: 'checked-in' } }) as Promise<BookingRow[]>,
    db.bookings.list({ where: { checkIn: today, status: { in: ['confirmed', 'reserved'] } } }) as Promise<BookingRow[]>,
  ])
  const open = cards.filter((c) => canOpenDoor(c, now))
  const live = open.filter((c) => c.kind !== 'lockout')
  const lockouts = open.filter((c) => c.kind === 'lockout')
  const empty: KeyCardBoard = { configured: locks.length > 0, needsCard: [], shouldBeGone: [], wrongRoom: [], endsEarly: [], unknown: [], live, lockouts, doors: [] }
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
    db.rooms.list({ where: { id: { in: [...lockedRooms] } } }),
    stays.length ? db.guests.list({ where: { id: { in: [...new Set(stays.map((b) => b.guestId).filter(Boolean))] } } }) : Promise.resolve([]),
  ])
  const roomNo = new Map((rooms as Array<{ id: string; roomNumber: string }>).map((r) => [r.id, r.roomNumber]))
  const doors = [...roomNo].map(([roomId, roomNumber]) => ({ roomId, roomNumber: String(roomNumber) }))
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
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
  const early = new Map<string, EndsEarly>()
  for (const c of live) {
    const b = c.bookingId ? known.get(c.bookingId) : undefined
    if (!b || !STAYING.includes(b.status)) shouldBeGone.push(c)
    else if (c.roomId && b.roomId !== c.roomId) wrongRoom.push(c)
    else if (b.status === 'checked-in' && c.status !== 'not_returned' && endsBefore(c, b.checkOut)) {
      const e = early.get(b.id)
      if (e) {
        e.cards++
        if (c.validUntil < e.validUntil) e.validUntil = c.validUntil
      } else {
        early.set(b.id, {
          bookingId: b.id,
          guestName: c.guestName ?? ((b.guestId && guestName.get(b.guestId)) || 'Guest'),
          roomNumber: roomNo.get(b.roomId) || c.roomNumber || '?',
          checkOut: String(b.checkOut).slice(0, 10),
          validUntil: c.validUntil,
          cards: 1,
        })
      }
    }
  }
  const endsEarly = [...early.values()].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))

  return { ...empty, needsCard, shouldBeGone, wrongRoom, endsEarly, unknown: live.filter((c) => c.status === 'unknown'), doors }
}

/** What a guest card read at the encoder is, by this app's records. */
export interface CardIdentity {
  lockNo: string
  /** The room with that door code, or null when no room on the Rooms page has it. */
  room: { roomId: string; roomNumber: string; label: string | null } | null
  validUntil: Date | null
  expired: boolean
  /** DAI 0: made in Joney's own program, so this app has no record of it. */
  madeInJoney: boolean
  /**
   * This app's records of the card. Cards of one stay are written alike, so the card
   * may be any one of these. Empty when it was not made here (or not for that door).
   */
  records: KeyCard[]
  /** A card with another DAI made for the door since: once it is used at the door, the lock refuses this one. */
  newer: KeyCard | null
  /** The stay the card was made for, as it is now. */
  stay: CardStay | null
}

export interface CardStay {
  bookingId: string
  status: string
  checkOut: string
  /** The room the stay is in now, which may not be the card's. */
  roomId: string
  roomNumber: string
}

/** Statuses of a card that was really written (anything but being written, or failed). */
const WRITTEN: KeyCardStatus[] = ['issued', 'unknown', 'returned', 'not_returned', 'killed_at_door', 'replaced', 'locked_out']

/** Matches a guest card read at the encoder to its door and to this app's record of it. */
export async function identifyCard(reading: CardReading, now = new Date()): Promise<CardIdentity> {
  const lockNo = normalizeLockNo(reading.lockNo ?? '')
  const validUntil = reading.validUntil ? new Date(reading.validUntil) : null
  const locks = (await db.roomLocks.list({ where: { lockNo }, limit: 5 })) as RoomLock[]
  const lock = locks[0]
  let room: CardIdentity['room'] = null
  if (lock) {
    const r = (await db.rooms.list({ where: { id: lock.roomId }, limit: 1 })) as Array<{ id: string; roomNumber: string }>
    room = { roomId: lock.roomId, roomNumber: String(r[0]?.roomNumber ?? '?'), label: lock.label }
  }

  // A card ends on the minute its order said: look for that end, a minute either side.
  let records: KeyCard[] = []
  if (validUntil && !Number.isNaN(validUntil.getTime())) {
    const from = new Date(validUntil.getTime() - 60_000)
    const to = validUntil.getTime() + 60_000
    const near = (await db.keyCards.list({ where: { validUntil: { gte: from.toISOString() } }, orderBy: { validUntil: 'asc' }, limit: 200 })) as KeyCard[]
    records = near
      .filter((c) => new Date(c.validUntil).getTime() <= to)
      .filter((c) => (c.lockNos ?? []).map(normalizeLockNo).includes(lockNo))
      .filter((c) => !Number.isInteger(c.dai) || c.dai === reading.dai)
      .filter((c) => WRITTEN.includes(c.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.cardNo - b.cardNo)
  }

  let newer: KeyCard | null = null
  if (records.length && room) {
    const since = records[records.length - 1].createdAt
    const door = (await db.keyCards.list({ where: { roomId: room.roomId }, orderBy: { createdAt: 'desc' }, limit: 20 })) as KeyCard[]
    newer = door.find((c) => c.createdAt > since && WRITTEN.includes(c.status) && Number.isInteger(c.dai) && c.dai !== reading.dai
      && (c.lockNos ?? []).map(normalizeLockNo).includes(lockNo)) ?? null
  }

  let stay: CardStay | null = null
  const bookingId = records.find((c) => c.bookingId)?.bookingId
  if (bookingId) {
    const b = (await db.bookings.get(bookingId)) as BookingRow | null
    if (b) {
      let roomNumber = room && room.roomId === b.roomId ? room.roomNumber : null
      if (!roomNumber) {
        const r = (await db.rooms.list({ where: { id: b.roomId }, limit: 1 })) as Array<{ roomNumber: string }>
        roomNumber = String(r[0]?.roomNumber ?? '?')
      }
      stay = { bookingId, status: b.status, checkOut: String(b.checkOut).slice(0, 10), roomId: b.roomId, roomNumber }
    }
  }

  return {
    lockNo,
    room,
    validUntil,
    expired: !!validUntil && validUntil <= now,
    madeInJoney: reading.dai === 0,
    records,
    newer,
    stay,
  }
}

/** Where a door code read from a card could go: every room with its codes now, and the likely one. */
export interface DoorPlacement {
  rooms: Array<{ roomId: string; roomNumber: string; locks: RoomLock[] }>
  /** The room the code most likely belongs to, or null when the codes on record show no pattern. */
  suggested: string | null
  /** The rooms that suggestion was worked out from. */
  basis: string[]
}

/**
 * The room a door code most likely belongs to, from the rooms whose codes start
 * the same way. Joney numbers doors building, floor, room: if room 201 is …01 and
 * 204 is …04, then …02 is 202. But the lock program numbers doors in the order
 * they were set up, which need not follow the room numbers (on site one room broke
 * the pattern), so it suggests only when at least two rooms agree and none
 * disagrees. It is only a suggestion; staff confirm it.
 */
export function suggestDoorRoom(lockNo: string, rooms: DoorPlacement['rooms']): { roomId: string | null; basis: string[] } {
  const code = normalizeLockNo(lockNo)
  if (!isLockNo(code)) return { roomId: null, basis: [] }
  const prefix = code.slice(0, 4)
  const byOffset = new Map<number, string[]>()
  for (const r of rooms) {
    if (!/^\d+$/.test(r.roomNumber)) continue
    for (const l of r.locks) {
      if (l.lockNo === code || l.lockNo.slice(0, 4) !== prefix) continue
      const offset = Number(r.roomNumber) - parseInt(l.lockNo.slice(4), 16)
      byOffset.set(offset, [...(byOffset.get(offset) ?? []), r.roomNumber])
    }
  }
  // A clear pattern only: two rooms or more, all on the same offset.
  if (byOffset.size !== 1) return { roomId: null, basis: [] }
  const [offset, basis] = [...byOffset][0]
  if (new Set(basis).size < 2) return { roomId: null, basis: [] }
  const number = String(offset + parseInt(code.slice(4), 16))
  const room = rooms.find((r) => r.roomNumber === number)
  return room ? { roomId: room.roomId, basis: [...new Set(basis)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) } : { roomId: null, basis: [] }
}

/** The rooms a door code read from a card could be added to, and the likely one. */
export async function placeDoorCode(lockNo: string): Promise<DoorPlacement> {
  const [rooms, locks] = await Promise.all([
    db.rooms.list({ limit: 1000 }) as Promise<Array<{ id: string; roomNumber: string | number | null }>>,
    db.roomLocks.list({ limit: 1000 }) as Promise<RoomLock[]>,
  ])
  const list = rooms
    .filter((r) => r.roomNumber != null && String(r.roomNumber).trim() !== '')
    .map((r) => ({ roomId: r.id, roomNumber: String(r.roomNumber), locks: locks.filter((l) => l.roomId === r.id) }))
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
  const { roomId, basis } = suggestDoorRoom(lockNo, list)
  return { rooms: list, suggested: roomId, basis }
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

/**
 * 'issued' is only for a card whose writing was cut off, once it reads back right at the encoder.
 * 'erased' is for a card written again (updated, or moved to another room), once its new card is written.
 */
export type CardMark = 'returned' | 'not_returned' | 'killed_at_door' | 'issued' | 'erased'

export function markCard(cardId: string, status: CardMark, note?: string) {
  return post('key-card-mark', { cardId, status, note })
}

export function saveRoomLocks(roomId: string, locks: Array<{ lockNo: string; label?: string | null }>): Promise<{ locks: unknown[] }> {
  return post('room-locks-save', { roomId, locks })
}

/** The 6-character code Joney's Lock Management System shows for a door: 0-9 and A-F, e.g. 01020A. */
export const isLockNo = (s: string) => /^[0-9A-F]{6}$/.test(s)
export const normalizeLockNo = (s: string) => s.trim().toUpperCase()
