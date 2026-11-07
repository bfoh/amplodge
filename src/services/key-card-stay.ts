/**
 * Key cards, money and guests: the card fee, late check-out, cards that stop on the
 * last paid night, and the card sleeve. When a stay's cards stop is decided by the
 * server (_lib/key-cards.js stayEnd); key-cards.ts mirrors it as stayKeyEnd.
 *
 * Their columns arrive with supabase/migrations/20261109120000_key_cards_stay_rules.sql.
 * Until that has been run, these features say so instead of failing quietly.
 */
import { db } from '@/lib/db'
import { GUEST_INFO } from '@/lib/guest-info'
import { bookingChargesService } from '@/services/booking-charges-service'
import { amountPaidOf, effectiveRoomPrice } from '@/services/booking-payment-service'
import { CHECK_OUT_TIME, hotelDay, hotelTime, stayEndDay, stayKeyEnd, type StayTimes } from '@/services/key-cards'

export const STAY_RULES_MIGRATION = 'supabase/migrations/20261109120000_key_cards_stay_rules.sql'
const NEEDS_UPDATE = `The database needs an update for this first: an admin runs ${STAY_RULES_MIGRATION} in the Supabase SQL editor.`

/** PostgREST's answer when a column the app writes is not in the database yet. */
const missingColumn = (e: any) =>
  e?.code === 'PGRST204' || e?.code === '42703' || /column|schema cache/i.test(String(e?.message ?? ''))

async function updateBooking(bookingId: string, change: Record<string, unknown>) {
  try {
    await db.bookings.update(bookingId, change)
  } catch (e) {
    if (missingColumn(e)) throw new Error(NEEDS_UPDATE)
    throw e
  }
}

// ─── Settings (Settings → Door locks) ────────────────────────────────────────

export interface KeyCardSettings {
  /** The database has the columns (the migration has been run). */
  ready: boolean
  /** The hotel_settings row, to save to. */
  id: string | null
  /** The charge offered for a card kept or lost. Null: none offered. */
  fee: number | null
  /** Guests leaving today get an SMS in the morning. */
  morningSms: boolean
}

export async function loadKeyCardSettings(): Promise<KeyCardSettings> {
  const rows = (await db.hotelSettings.list({ limit: 1 })) as Array<Record<string, any>>
  const r = rows[0] ?? {}
  const fee = Number(r.keyCardFee)
  return {
    ready: 'keyCardFee' in r || 'checkoutMorningSms' in r,
    id: r.id ?? null,
    fee: Number.isFinite(fee) && fee > 0 ? Math.round(fee * 100) / 100 : null,
    morningSms: r.checkoutMorningSms === true,
  }
}

export async function saveKeyCardSettings(id: string, fee: number | null, morningSms: boolean): Promise<void> {
  if (fee !== null && (!Number.isFinite(fee) || fee < 0)) throw new Error('The fee must be an amount of 0 or more.')
  try {
    await db.hotelSettings.update(id, { keyCardFee: fee && fee > 0 ? Math.round(fee * 100) / 100 : null, checkoutMorningSms: morningSms })
  } catch (e) {
    if (missingColumn(e)) throw new Error(NEEDS_UPDATE)
    throw e
  }
}

// ─── Money ───────────────────────────────────────────────────────────────────

export type ChargeMethod = 'cash' | 'mobile_money' | 'card' | 'pay_later'
export const CHARGE_METHODS: Array<{ value: ChargeMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'card', label: 'Card' },
  { value: 'pay_later', label: 'Pay later (on the bill)' },
]

/** Adds the card fee to the booking, for each card the guest kept or lost. */
export async function chargeCardFee(opts: { bookingId: string; fee: number; cards: number; why: 'kept' | 'lost'; method: ChargeMethod }): Promise<void> {
  const cards = Math.max(1, Math.round(opts.cards))
  await bookingChargesService.addCharge({
    bookingId: opts.bookingId,
    description: opts.why === 'kept' ? `Key card not returned${cards > 1 ? ` (${cards} cards)` : ''}` : `Lost key card${cards > 1 ? ` (${cards} cards)` : ''}`,
    category: 'other',
    quantity: cards,
    unitPrice: opts.fee,
    paymentMethod: opts.method,
  })
}

// ─── Late check-out ──────────────────────────────────────────────────────────

/**
 * Sets (or with null, clears) a late check-out on the booking's check-out day. With
 * a charge above 0, the charge is added to the booking.
 */
export async function setLateCheckOut(opts: { bookingId: string; time: string | null; charge?: number; method?: ChargeMethod }): Promise<void> {
  if (opts.time !== null && !/^(1[2-8]):00$/.test(opts.time)) throw new Error('Pick a time from 12:00 to 18:00.')
  await updateBooking(opts.bookingId, { lateCheckOut: opts.time })
  if (opts.time && opts.charge && opts.charge > 0) {
    await bookingChargesService.addCharge({
      bookingId: opts.bookingId,
      description: `Late check-out (until ${opts.time})`,
      category: 'room_extension',
      quantity: 1,
      unitPrice: Math.round(opts.charge * 100) / 100,
      paymentMethod: opts.method ?? 'cash',
    })
  }
}

// ─── Cards that stop on the last paid night ──────────────────────────────────

const addDays = (day: string, n: number) => {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const nightsBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000)

export interface PaidNights {
  /** Nights in the stay. */
  nights: number
  /** Nights the money paid so far covers, the first night first. */
  paid: number
  amountPaid: number
  /** What the stay's nights cost, extensions included. */
  cost: number
  /** The day cards would stop on for the nights paid (check-out day when all are paid). */
  paidUntil: string
}

/**
 * How many of a stay's nights are paid for: the room price spread over the nights
 * booked, then each extension night at its own price, against what the guest has paid.
 * A suggestion for staff, who pick the day themselves.
 */
export function paidNightsOf(booking: any, charges: Array<{ category: string; description: string; quantity: number; unitPrice: number; createdAt: string }>): PaidNights | null {
  const checkIn = String(booking?.checkIn ?? '').slice(0, 10)
  const checkOut = String(booking?.checkOut ?? '').slice(0, 10)
  const nights = nightsBetween(checkIn, checkOut)
  if (!(nights > 0)) return null
  const extensions = charges
    .filter((c) => c.category === 'room_extension' && /^Stay Extension \(/.test(c.description))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const extended = extensions.reduce((n, c) => n + Math.max(0, Math.round(Number(c.quantity) || 0)), 0)
  const booked = Math.max(1, nights - extended)
  const rate = effectiveRoomPrice(booking) / booked
  const costs = [
    ...Array.from({ length: Math.min(booked, nights) }, () => rate),
    ...extensions.flatMap((c) => Array.from({ length: Math.max(0, Math.round(Number(c.quantity) || 0)) }, () => Number(c.unitPrice) || 0)),
  ].slice(0, nights)
  const amountPaid = amountPaidOf(booking)
  let paid = 0
  let spent = 0
  for (const cost of costs) {
    if (spent + cost > amountPaid + 0.01) break
    spent += cost
    paid++
  }
  const cost = Math.round(costs.reduce((s, c) => s + c, 0) * 100) / 100
  return { nights, paid, amountPaid, cost, paidUntil: addDays(checkIn, Math.max(1, Math.min(paid, nights))) }
}

/** The days cards can be set to stop on: every day after arrival, check-out day last (the whole stay). */
export function keyCardDays(checkIn: string, checkOut: string): string[] {
  const n = nightsBetween(checkIn, checkOut)
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(checkIn, i + 1))
}

/** Sets the day the stay's cards stop on; check-out day (or null) means the whole stay. */
export async function setKeyCardsUntil(bookingId: string, day: string | null, checkOut: string): Promise<void> {
  const until = day && day.slice(0, 10) < checkOut.slice(0, 10) ? day.slice(0, 10) : null
  await updateBooking(bookingId, { keyCardsUntil: until })
}

/** Whether the booking row has the columns of 20261109120000 (the migration has been run). */
export const hasStayRules = (booking: unknown) =>
  !!booking && typeof booking === 'object' && ('lateCheckOut' in booking || 'keyCardsUntil' in booking)

/** "Sat 8 Nov, 12:00", and why: for staff. */
export function describeKeyEnd(b: StayTimes): string {
  const { early, time } = stayEndDay(b)
  const end = hotelTime(stayKeyEnd(b))
  return early ? `${end} (the nights paid for)` : time !== CHECK_OUT_TIME ? `${end} (late check-out at ${time})` : end
}

// ─── The card sleeve ─────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/**
 * A slip for the receipt printer that goes round the key card: the room number (never
 * written on the card itself), check-out, when the key stops, Wi-Fi and help.
 */
export function cardSleeveHtml(opts: { roomNumber: string; guestName?: string | null; stay: StayTimes; cards?: number; until?: string | null }): string {
  const { time, early } = stayEndDay(opts.stay)
  const checkOutDay = hotelDay(String(opts.stay.checkOut ?? ''))
  const first = String(opts.guestName ?? '').trim().split(/\s+/)[0] ?? ''
  const keyEnd = hotelTime(opts.until || stayKeyEnd(opts.stay))
  return `<!doctype html><html><head><meta charset="utf-8"><title>Key card · Room ${esc(opts.roomNumber)}</title><style>
@page{size:72mm auto;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:72mm}
body{font-family:'Segoe UI',-apple-system,Arial,sans-serif;font-size:11px;line-height:1.4;color:#000;background:#fff}
.s{width:72mm;padding:4mm 3mm 6mm;text-align:center}
.hn{font-size:14px;font-weight:800;letter-spacing:.4px}
.lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-top:5px}
.room{font-size:34px;font-weight:800;line-height:1.1}
.div{border-top:1px dashed #000;margin:7px 0}
.row{display:flex;justify-content:space-between;gap:6px;text-align:left;margin:2px 0}
.row b{white-space:nowrap}
.note{font-size:9.5px;margin-top:6px}
</style></head><body><div class="s">
<div class="hn">AMP LODGE</div>
${first ? `<div>Welcome, ${esc(first)}</div>` : ''}
<div class="lbl">Your room</div>
<div class="room">${esc(opts.roomNumber)}</div>
<div class="div"></div>
<div class="row"><span>Check-out</span><b>${esc(checkOutDay)}, ${esc(early ? CHECK_OUT_TIME : time)}</b></div>
<div class="row"><span>Your key works until</span><b>${esc(keyEnd)}</b></div>
${early ? '<div class="note">Your key stops after the nights paid for. Pay at reception for more nights and the key is updated.</div>' : ''}
<div class="div"></div>
<div class="row"><span>Wi-Fi</span><b>${esc(GUEST_INFO.wifiName)}</b></div>
<div class="row"><span>Password</span><b>${esc(GUEST_INFO.wifiPassword)}</b></div>
<div class="row"><span>Breakfast</span><b>${esc(GUEST_INFO.breakfast)}</b></div>
<div class="row"><span>Reception</span><b>${esc(GUEST_INFO.helpPhone)}</b></div>
<div class="div"></div>
<div class="note">Keep this slip apart from the card: the card does not say which room it opens.${opts.cards && opts.cards > 1 ? ` You have ${opts.cards} cards.` : ''} Please hand your key card${opts.cards && opts.cards > 1 ? 's' : ''} in at reception when you leave.</div>
</div></body></html>`
}

/** Prints the card sleeve on the receipt printer. Throws if the browser blocks the print window. */
export function printCardSleeve(opts: Parameters<typeof cardSleeveHtml>[0]): void {
  const w = window.open('', '_blank')
  if (!w) throw new Error('Could not open the print window. Allow pop-ups for this site.')
  w.document.write(cardSleeveHtml(opts))
  w.document.close()
  setTimeout(() => w.print(), 300)
}
