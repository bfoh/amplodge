/**
 * The "Make key cards?" prompt after a check-in, like receipt-print.ts: call
 * sites cannot render React, so they ask here and the <KeyCardDialog /> mounted
 * at the app root shows it. It resolves once the dialog closes, so the receipt
 * prompt can follow without two dialogs fighting.
 */
import { db } from '@/lib/db'

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
  const locks = (await db.roomLocks.list({ where: { roomId: booking.roomId } })) as unknown[]
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
