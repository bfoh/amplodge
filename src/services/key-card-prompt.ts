/**
 * The "Make key cards?" prompt after a check-in, like receipt-print.ts: call
 * sites cannot render React, so they ask here and the <KeyCardDialog /> mounted
 * at the app root shows it. It resolves once the dialog closes, so the receipt
 * prompt can follow without two dialogs fighting.
 */
import { db } from '@/lib/db'
import { canOpenDoor, endsBefore, loadStayCards, withinLocks, type KeyCard } from '@/services/key-cards'

export interface KeyCardRequest {
  bookingId: string
  guestName?: string | null
  roomNumber?: string | null
  /**
   * A card was lost: the new cards get a new DAI and replace every card of the
   * stay, which stop working once a new card has opened the door.
   */
  replace?: boolean
  /** A lock-out card for this room instead of guest cards (bookingId is then empty). */
  lockoutRoomId?: string
  /** One of several stays carded in a row: which one, and how to stop the rest. */
  queue?: { at: number; of: number; stop: () => void }
}

type Opener = (req: KeyCardRequest, closed: () => void) => void
let opener: Opener | null = null

export function subscribeKeyCardPrompt(fn: Opener | null): void {
  opener = fn
}

/** True when the booking's room has a door lock number (so it gets key cards at all). */
async function roomHasLock(bookingId: string): Promise<boolean> {
  const booking = (await db.bookings.get(bookingId)) as { roomId?: string } | null
  if (!booking?.roomId) return false
  const locks = (await db.roomLocks.list({ where: { roomId: booking.roomId }, limit: 10 })) as unknown[]
  return locks.length > 0
}

/**
 * Offers to make key cards for a booking. Does nothing for a room without a
 * door lock number, so nothing changes until an admin sets the locks up.
 */
export async function promptKeyCards(req: KeyCardRequest): Promise<void> {
  if (!opener || !req.bookingId) return
  try {
    if (!(await roomHasLock(req.bookingId))) return
  } catch (e) {
    console.warn('[KeyCards] could not check the room lock; no prompt', e)
    return
  }
  const open = opener
  if (!open) return
  await new Promise<void>((resolve) => open(req, resolve))
}

/**
 * Offers to make a lock-out card for a room: a short card that, held to the lock
 * once, makes it refuse every older card (netlify/functions/key-card-lockout.js).
 */
export async function promptLockoutCard(roomId: string, roomNumber?: string | null): Promise<void> {
  const open = opener
  if (!open || !roomId) return
  await new Promise<void>((resolve) => open({ bookingId: '', lockoutRoomId: roomId, roomNumber }, resolve))
}

// ─── Updating a stay's cards, and taking them back ───────────────────────────

export interface StayCardsRequest {
  bookingId: string
  guestName?: string | null
  roomNumber?: string | null
}

type StayOpener = (req: StayCardsRequest, closed: () => void) => void
let updateOpener: StayOpener | null = null
let collectOpener: StayOpener | null = null

export function subscribeUpdatePrompt(fn: StayOpener | null): void {
  updateOpener = fn
}

export function subscribeCollectPrompt(fn: StayOpener | null): void {
  collectOpener = fn
}

/** Card states in which a card is still out with the guest and was written. */
const OUT: KeyCard['status'][] = ['issued', 'unknown']

/**
 * The stay's cards that no longer match it: they stop before its check-out day
 * (it was extended), or open a room the guest has left.
 */
export async function cardsOutOfStep(bookingId: string): Promise<KeyCard[]> {
  const booking = (await db.bookings.get(bookingId)) as { roomId?: string; checkOut?: string; status?: string } | null
  if (!booking?.roomId || booking.status !== 'checked-in') return []
  const [cards, locks] = await Promise.all([
    loadStayCards(bookingId),
    db.roomLocks.list({ where: { roomId: booking.roomId }, limit: 10 }) as Promise<Array<{ lockNo: string }>>,
  ])
  if (!locks.length) return []
  const doors = locks.map((l) => l.lockNo)
  return cards.filter((c) => OUT.includes(c.status)
    && (!withinLocks(c.lockNos ?? [], doors) || endsBefore(c, String(booking.checkOut))))
}

/**
 * After an extension or a room move: offers to write the stay's cards again so
 * they match it. Does nothing when every card already does.
 */
export async function promptUpdateCards(req: StayCardsRequest): Promise<void> {
  if (!updateOpener || !req.bookingId) return
  try {
    if (!(await cardsOutOfStep(req.bookingId)).length) return
  } catch (e) {
    console.warn('[KeyCards] could not check the stay\'s cards; no prompt', e)
    return
  }
  const open = updateOpener
  if (!open) return
  await new Promise<void>((resolve) => open(req, resolve))
}

/** The stay's cards still out with the guest: written, and not yet returned or accounted for. */
export async function cardsOut(bookingId: string): Promise<KeyCard[]> {
  return (await loadStayCards(bookingId)).filter((c) => OUT.includes(c.status))
}

/** After a check-out: offers to take the stay's cards back. Does nothing when no card is out. */
export async function promptCollectCards(req: StayCardsRequest): Promise<void> {
  if (!collectOpener || !req.bookingId) return
  try {
    if (!(await cardsOut(req.bookingId)).length) return
  } catch (e) {
    console.warn('[KeyCards] could not check the stay\'s cards; no prompt', e)
    return
  }
  const open = collectOpener
  if (!open) return
  await new Promise<void>((resolve) => open(req, resolve))
}

// ─── Several stays in a row ──────────────────────────────────────────────────

/**
 * Makes cards for several stays one after another (a group's rooms, or every
 * stay on the Key cards page that needs one). Stays whose room has no lock,
 * and stays that have a working card already, are left out. Resolves with how
 * many stays were offered cards.
 */
export async function queueKeyCards(reqs: KeyCardRequest[]): Promise<number> {
  const todo: KeyCardRequest[] = []
  for (const r of reqs) {
    try {
      if (!(await roomHasLock(r.bookingId))) continue
      const cards = await loadStayCards(r.bookingId)
      if (cards.some((c) => canOpenDoor(c) && c.status !== 'not_returned')) continue
      todo.push(r)
    } catch (e) {
      console.warn('[KeyCards] could not check a stay for the queue', e)
    }
  }
  let stopped = false
  for (let i = 0; i < todo.length && !stopped; i++) {
    await promptKeyCards({ ...todo[i], queue: { at: i + 1, of: todo.length, stop: () => { stopped = true } } })
  }
  return todo.length
}

// ─── One stay's cards ────────────────────────────────────────────────────────

let stayOpener: StayOpener | null = null

export function subscribeStayPrompt(fn: StayOpener | null): void {
  stayOpener = fn
}

/** Shows a stay's key cards and what can be done with them (from a booking's menu). */
export async function promptStayCards(req: StayCardsRequest): Promise<void> {
  const open = stayOpener
  if (!open || !req.bookingId) return
  await new Promise<void>((resolve) => open(req, resolve))
}
