/**
 * Looking after the door locks: the blank card stock, each lock's upkeep (batteries,
 * clock, faults) and the staff cards made in Joney's program. These are records only:
 * nothing here makes or changes a card.
 *
 * The tables arrive with supabase/migrations/20261110120000_key_cards_upkeep.sql.
 * Until that has been run, these features say so instead of failing quietly.
 */
import { db } from '@/lib/db'

export const UPKEEP_MIGRATION = 'supabase/migrations/20261110120000_key_cards_upkeep.sql'
export const NEEDS_UPKEEP_UPDATE = `The database needs an update for this first: an admin runs ${UPKEEP_MIGRATION} in the Supabase SQL editor.`

/** PostgREST's answer when a table or column is not in the database yet. */
export const notThereYet = (e: any) =>
  ['PGRST204', 'PGRST205', '42703', '42P01'].includes(e?.code) || /column|schema cache|does not exist/i.test(String(e?.message ?? ''))

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (e) {
    if (notThereYet(e)) throw new Error(NEEDS_UPKEEP_UPDATE)
    throw e
  }
}

const todayInHotel = () => new Date().toISOString().slice(0, 10)

// ─── Blank card stock ────────────────────────────────────────────────────────

export interface StockItem {
  id: string
  name: string
  stock: number
  min: number
}

export interface CardStock {
  /** The database has the column (the migration has been run). */
  ready: boolean
  settingsId: string | null
  /** The inventory item that counts blank cards, if one is chosen. */
  item: StockItem | null
}

const asItem = (r: any): StockItem => ({ id: r.id, name: r.name, stock: Number(r.stockQuantity) || 0, min: Number(r.minThreshold) || 0 })

export async function loadCardStock(): Promise<CardStock> {
  const rows = (await db.hotelSettings.list({ limit: 1 })) as Array<Record<string, any>>
  const r = rows[0] ?? {}
  const ready = 'keyCardStockItem' in r
  let item: StockItem | null = null
  if (ready && r.keyCardStockItem) {
    const it = await db.inventory.get(r.keyCardStockItem).catch(() => null)
    if (it) item = asItem(it)
  }
  return { ready, settingsId: r.id ?? null, item }
}

export async function loadStockItems(): Promise<StockItem[]> {
  const rows = (await db.inventory.list({ limit: 500 })) as unknown[]
  return rows.map(asItem).sort((a, b) => a.name.localeCompare(b.name))
}

export function saveCardStockItem(settingsId: string, itemId: string | null): Promise<void> {
  return guarded(async () => { await db.hotelSettings.update(settingsId, { keyCardStockItem: itemId } as any) })
}

/** Adds a "Blank key cards" item to Inventory (stock 0: count the pile, then restock it there). */
export async function createCardStockItem(): Promise<StockItem> {
  const row = await db.inventory.create({ name: 'Blank key cards', category: 'other', stockQuantity: 0, minThreshold: 20, unitPrice: 0 } as any)
  return asItem(row)
}

/** Few enough blank cards left to say so. */
export const stockLow = (item: StockItem | null) => !!item && item.stock <= item.min

// ─── Lock upkeep ─────────────────────────────────────────────────────────────

export type UpkeepKind = 'battery' | 'clock' | 'fault' | 'fixed' | 'note'
export const UPKEEP_KINDS: Array<{ value: UpkeepKind; label: string }> = [
  { value: 'battery', label: 'Batteries changed' },
  { value: 'clock', label: 'Clock set (clock card)' },
  { value: 'fault', label: 'A fault' },
  { value: 'fixed', label: 'Fault fixed' },
  { value: 'note', label: 'A note' },
]
/** Change the batteries this often (the lock also beeps when they run low). */
export const BATTERY_MONTHS = 12
/** Set the lock's clock this often: a lock whose clock drifts refuses cards near their start or end. */
export const CLOCK_MONTHS = 6

export interface UpkeepEntry {
  id: string
  roomId: string
  kind: UpkeepKind
  note: string | null
  doneOn: string
  staffName: string | null
  createdAt: string
}

export interface DoorUpkeep {
  roomId: string
  roomNumber: string
  /** The day the batteries were last changed, if on record. */
  battery: string | null
  clock: string | null
  batteryDue: boolean
  clockDue: boolean
  /** The last fault logged with no fix logged after it. */
  openFault: UpkeepEntry | null
  /** Newest first. */
  entries: UpkeepEntry[]
}

/** The day `months` after `day` (YYYY-MM-DD). */
export function monthsAfter(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  const target = d.getUTCMonth() + months
  d.setUTCMonth(target)
  // 31 Aug + 6 months is 28/29 Feb, not 2/3 Mar.
  if (d.getUTCMonth() !== ((target % 12) + 12) % 12) d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

/** Each door's upkeep: when its batteries and clock were last done, what is due, and any open fault. */
export function summarizeUpkeep(doors: Array<{ roomId: string; roomNumber: string }>, entries: UpkeepEntry[], today = todayInHotel()): DoorUpkeep[] {
  const newest = (a: UpkeepEntry, b: UpkeepEntry) => b.doneOn.localeCompare(a.doneOn) || b.createdAt.localeCompare(a.createdAt)
  return doors.map((d) => {
    const mine = entries.filter((e) => e.roomId === d.roomId).sort(newest)
    const battery = mine.find((e) => e.kind === 'battery')?.doneOn ?? null
    const clock = mine.find((e) => e.kind === 'clock')?.doneOn ?? null
    const lastFault = mine.find((e) => e.kind === 'fault') ?? null
    const fixedSince = lastFault ? mine.some((e) => e.kind === 'fixed' && newest(e, lastFault) < 0) : false
    return {
      roomId: d.roomId,
      roomNumber: d.roomNumber,
      battery,
      clock,
      // Only once one is on record: a lock nobody has logged yet is not "due".
      batteryDue: !!battery && monthsAfter(battery, BATTERY_MONTHS) <= today,
      clockDue: !!clock && monthsAfter(clock, CLOCK_MONTHS) <= today,
      openFault: lastFault && !fixedSince ? lastFault : null,
      entries: mine,
    }
  })
}

export async function loadUpkeep(doors: Array<{ roomId: string; roomNumber: string }>): Promise<{ ready: boolean; doors: DoorUpkeep[] }> {
  try {
    const rows = (await db.lockUpkeep.list({ orderBy: { doneOn: 'desc' }, limit: 2000 })) as UpkeepEntry[]
    return { ready: true, doors: summarizeUpkeep(doors, rows) }
  } catch (e) {
    if (notThereYet(e)) return { ready: false, doors: summarizeUpkeep(doors, []) }
    throw e
  }
}

export function logUpkeep(entry: { roomId: string; kind: UpkeepKind; note?: string | null; doneOn?: string; staffId?: string | null; staffName?: string | null }): Promise<void> {
  const note = entry.note?.trim() ? entry.note.trim().slice(0, 500) : null
  return guarded(async () => {
    await db.lockUpkeep.create({
      roomId: entry.roomId,
      kind: entry.kind,
      note,
      doneOn: entry.doneOn || todayInHotel(),
      staffId: entry.staffId ?? null,
      staffName: entry.staffName ?? null,
    }, { returning: 'minimal' })
  })
}

// ─── Staff cards (made in Joney's program) ───────────────────────────────────

export type StaffCardKind = 'master' | 'floor' | 'cleaner' | 'other'
export const STAFF_CARD_KINDS: Array<{ value: StaffCardKind; label: string }> = [
  { value: 'master', label: 'Master card' },
  { value: 'floor', label: 'Floor card' },
  { value: 'cleaner', label: 'Cleaner card' },
  { value: 'other', label: 'Other staff card' },
]
export const staffCardLabel = (k: StaffCardKind) => STAFF_CARD_KINDS.find((x) => x.value === k)?.label ?? 'Staff card'

export type CardEnd = 'returned' | 'cancelled' | 'lost'
export const CARD_ENDS: Record<CardEnd, string> = {
  returned: 'Handed back',
  cancelled: 'Cancelled in LQ015',
  lost: 'Lost',
}

export interface StaffKeyCard {
  id: string
  staffId: string | null
  holderName: string
  kind: StaffCardKind
  label: string | null
  givenOn: string
  endedOn: string | null
  endedHow: CardEnd | null
  note: string | null
  createdAt: string
}

export async function loadStaffCards(): Promise<{ ready: boolean; cards: StaffKeyCard[] }> {
  try {
    const cards = (await db.staffKeyCards.list({ orderBy: { givenOn: 'desc' }, limit: 500 })) as StaffKeyCard[]
    return { ready: true, cards }
  } catch (e) {
    if (notThereYet(e)) return { ready: false, cards: [] }
    throw e
  }
}

/** The staff cards a person still holds, or null when the register is not set up (or not theirs to see). */
export async function cardsHeldBy(staffId: string): Promise<StaffKeyCard[] | null> {
  try {
    const rows = (await db.staffKeyCards.list({ where: { staffId }, limit: 50 })) as StaffKeyCard[]
    return rows.filter((c) => !c.endedOn)
  } catch {
    return null
  }
}

export function addStaffCard(card: { staffId: string | null; holderName: string; kind: StaffCardKind; label?: string | null; givenOn?: string; note?: string | null; createdBy?: string | null }): Promise<void> {
  const holderName = card.holderName.trim().slice(0, 120)
  if (!holderName) return Promise.reject(new Error('Who holds the card?'))
  return guarded(async () => {
    await db.staffKeyCards.create({
      staffId: card.staffId,
      holderName,
      kind: card.kind,
      label: card.label?.trim() ? card.label.trim().slice(0, 80) : null,
      givenOn: card.givenOn || todayInHotel(),
      note: card.note?.trim() ? card.note.trim().slice(0, 500) : null,
      createdBy: card.createdBy ?? null,
    }, { returning: 'minimal' })
  })
}

export function endStaffCard(id: string, how: CardEnd): Promise<void> {
  return guarded(async () => {
    await db.staffKeyCards.update(id, { endedOn: todayInHotel(), endedHow: how, updatedAt: new Date().toISOString() })
  })
}
