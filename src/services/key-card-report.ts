/**
 * The day's key cards, for managers: every card written that day and by whom,
 * cards returned, kept and lost, lock-outs, and what looks out of the ordinary.
 * Read from the key_cards rows and the activity log the card functions keep.
 */
import { db } from '@/lib/db'
import type { KeyCard } from '@/services/key-cards'

/** An activity-log row of a card function (entity type key_card). */
export interface CardLog {
  action: string
  entityId: string
  userId: string
  createdAt: string
  details: any
}

export interface StaffName {
  id: string
  userId?: string | null
  name: string
}

export type CardWork = 'New cards' | 'Extra card' | 'Updated' | 'Lost card: new cards' | 'Lock-out'

export interface DayCard {
  id: string
  time: string
  roomNumber: string
  guestName: string | null
  what: CardWork
  by: string
  status: KeyCard['status']
}

export interface KeyCardDay {
  day: string
  /** Every card the encoder wrote that day, updates and lock-outs included. */
  written: number
  updated: number
  lockouts: number
  failed: number
  returned: number
  kept: number
  /** "Card lost" orders: a stay's cards replaced. */
  lost: number
  byStaff: Array<{ name: string; cards: number }>
  cards: DayCard[]
  alerts: string[]
}

/** More cards than this for one stay is worth a look. */
export const MANY_CARDS = 4
/** This many failed writes in a day points at the encoder or the blank cards. */
export const MANY_FAILURES = 3

/** Statuses of a card that was written onto a card (an 'erased' row was too, then written again). */
const WRITTEN: KeyCard['status'][] = ['issued', 'unknown', 'returned', 'not_returned', 'killed_at_door', 'replaced', 'locked_out', 'erased']

const clock = (iso: string) => iso.slice(11, 16)
/** 22:00 to 06:00, hotel time (GMT). */
const atNight = (iso: string) => { const h = Number(iso.slice(11, 13)); return h >= 22 || h < 6 }

/**
 * The day's figures from its rows. cardsPerStay: for each stay with a card written
 * that day, how many physical cards it has had in all (rows not written again).
 */
export function summarizeKeyCardDay(
  day: string,
  dayCards: KeyCard[],
  logs: CardLog[],
  staff: StaffName[],
  cardsPerStay: Map<string, number>,
): KeyCardDay {
  const byId = new Map<string, string>()
  for (const s of staff) {
    byId.set(s.id, s.name)
    if (s.userId) byId.set(s.userId, s.name)
  }
  const orders = new Map(logs.filter((l) => l.action === 'key_card_ordered').map((l) => [l.entityId, l]))

  const written = dayCards
    .filter((c) => c.createdAt.slice(0, 10) === day && WRITTEN.includes(c.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.cardNo - b.cardNo)
  const work = (c: KeyCard): CardWork => {
    if (c.kind === 'lockout') return 'Lock-out'
    const d = orders.get(c.orderNonce)?.details ?? {}
    if (d.updated) return 'Updated'
    if (d.replaced) return 'Lost card: new cards'
    if (d.extra) return 'Extra card'
    return 'New cards'
  }
  const cards: DayCard[] = written.map((c) => ({
    id: c.id,
    time: clock(c.createdAt),
    roomNumber: c.roomNumber ?? '?',
    guestName: c.kind === 'lockout' ? null : c.guestName,
    what: work(c),
    by: (c.issuedBy && byId.get(c.issuedBy)) || 'Unknown',
    status: c.status,
  }))

  const tally = new Map<string, number>()
  for (const c of cards) tally.set(c.by, (tally.get(c.by) ?? 0) + 1)
  const byStaff = [...tally].map(([name, n]) => ({ name, cards: n })).sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name))

  const ofDay = logs.filter((l) => l.createdAt.slice(0, 10) === day)
  const lostOrders = ofDay.filter((l) => l.action === 'key_card_ordered' && Number(l.details?.replaced) > 0)

  const alerts: string[] = []
  for (const l of lostOrders.filter((o) => atNight(o.createdAt))) {
    const who = byId.get(l.userId) ?? 'someone'
    alerts.push(`At ${clock(l.createdAt)}, at night, ${who} made new cards for room ${l.details?.room ?? '?'}${l.details?.guest ? ` (${l.details.guest})` : ''} after a card was lost.`)
  }
  const seen = new Set<string>()
  for (const c of written) {
    if (!c.bookingId || seen.has(c.bookingId)) continue
    seen.add(c.bookingId)
    const n = cardsPerStay.get(c.bookingId) ?? 0
    if (n > MANY_CARDS) alerts.push(`Room ${c.roomNumber ?? '?'}${c.guestName ? ` (${c.guestName})` : ''}: ${n} cards made for one stay.`)
  }
  const failed = dayCards.filter((c) => c.createdAt.slice(0, 10) === day && c.status === 'failed').length
  if (failed >= MANY_FAILURES) alerts.push(`${failed} card writes failed: check the encoder and the blank cards.`)

  return {
    day,
    written: cards.length,
    updated: cards.filter((c) => c.what === 'Updated').length,
    lockouts: cards.filter((c) => c.what === 'Lock-out').length,
    failed,
    returned: ofDay.filter((l) => l.action === 'key_card_returned' && l.details?.guest != null).length,
    kept: ofDay.filter((l) => l.action === 'key_card_not_returned').length,
    lost: lostOrders.length,
    byStaff,
    cards,
    alerts,
  }
}

/** The day's figures (a YYYY-MM-DD hotel date). */
export async function loadKeyCardDay(day: string): Promise<KeyCardDay> {
  const from = `${day}T00:00:00.000Z`
  const [cards, logs, staff] = await Promise.all([
    db.keyCards.list({ where: { createdAt: { gte: from } }, orderBy: { createdAt: 'asc' }, limit: 1000 }) as Promise<KeyCard[]>,
    db.activityLogs.list({ where: { entityType: 'key_card', createdAt: { gte: from } }, orderBy: { createdAt: 'asc' }, limit: 2000 }) as Promise<unknown[]>,
    db.staff.list({ limit: 500 }) as Promise<unknown[]>,
  ])
  const dayCards = cards.filter((c) => c.createdAt.slice(0, 10) === day)
  const dayLogs = (logs as CardLog[]).filter((l) => l.createdAt.slice(0, 10) === day).map((l) => ({
    ...l,
    details: typeof l.details === 'string' ? safeJson(l.details) : l.details,
  }))

  const stays = [...new Set(dayCards.map((c) => c.bookingId).filter((id): id is string => !!id))]
  const cardsPerStay = new Map<string, number>()
  if (stays.length) {
    const all = (await db.keyCards.list({ where: { bookingId: { in: stays } }, limit: 1000 })) as KeyCard[]
    for (const c of all) {
      if (c.kind === 'lockout' || !c.bookingId || c.status === 'erased' || !WRITTEN.includes(c.status)) continue
      cardsPerStay.set(c.bookingId, (cardsPerStay.get(c.bookingId) ?? 0) + 1)
    }
  }
  return summarizeKeyCardDay(day, dayCards, dayLogs, staff as StaffName[], cardsPerStay)
}

function safeJson(s: string) {
  try { return JSON.parse(s) } catch { return {} }
}
