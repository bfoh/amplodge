/**
 * Each locked door's state, for the Rooms, Calendar and Housekeeping pages: worked
 * out from the Key cards board, so it says nothing the Key cards page does not.
 *
 * The locks are offline: "secure" means no card this app knows of opens the door
 * apart from the stay in the room. Cards made in Joney's own program are not known.
 */
import type { KeyCardBoard } from '@/services/key-cards'

export interface DoorStatus {
  roomId: string
  roomNumber: string
  /** Cards of a stay that is over, or that moved to another room, still open this door. */
  oldCards: number
  /** When the last of those stops by itself. */
  oldCardUntil: string | null
  /** A lock-out card waiting to be held to this door's lock (it works for 20 minutes). */
  lockout: { cardId: string; madeAt: string; until: string } | null
  /** The stay in the room has working cards until then. */
  guestUntil: string | null
  /** Checked in, or arriving today, with no working card. */
  needsCard: boolean
}

export type DoorTone = 'old-card' | 'lockout' | 'needs-card' | 'guest' | 'secure'

/** The state of every room with a door lock, by room id. */
export function doorStatuses(board: KeyCardBoard): Map<string, DoorStatus> {
  const out = new Map<string, DoorStatus>()
  for (const d of board.doors) {
    out.set(d.roomId, { roomId: d.roomId, roomNumber: d.roomNumber, oldCards: 0, oldCardUntil: null, lockout: null, guestUntil: null, needsCard: false })
  }
  const later = (a: string | null, b: string) => (!a || b > a ? b : a)

  const stray = new Set([...board.shouldBeGone, ...board.wrongRoom].map((c) => c.id))
  for (const c of board.live) {
    const s = c.roomId ? out.get(c.roomId) : undefined
    if (!s) continue
    if (stray.has(c.id)) {
      s.oldCards++
      s.oldCardUntil = later(s.oldCardUntil, c.validUntil)
    } else if (c.status !== 'not_returned') {
      s.guestUntil = later(s.guestUntil, c.validUntil)
    }
  }
  for (const c of board.lockouts) {
    const s = c.roomId ? out.get(c.roomId) : undefined
    if (s && (!s.lockout || c.createdAt > s.lockout.madeAt)) s.lockout = { cardId: c.id, madeAt: c.createdAt, until: c.validUntil }
  }
  for (const n of board.needsCard) {
    const s = out.get(n.roomId)
    if (s) s.needsCard = true
  }
  return out
}

/** What matters most about a door: a card that should be dead first. */
export function doorTone(s: DoorStatus): DoorTone {
  if (s.oldCards > 0) return 'old-card'
  if (s.lockout) return 'lockout'
  if (s.needsCard) return 'needs-card'
  if (s.guestUntil) return 'guest'
  return 'secure'
}
