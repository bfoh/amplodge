/**
 * Key cards, money and guests: the check-out morning SMS (a scheduled function, run
 * here against the in-memory database with a pretend SMS service), and the portal's
 * suggestion of how many nights a guest has paid for.
 */
import crypto from 'node:crypto'
import { tables } from './fake-supabase-js'
import { checkoutMessage, runCheckoutSms } from '../../netlify/functions/key-card-checkout-sms.js'
import { serviceClient } from '../../netlify/functions/_lib/key-cards.js'
import { ghanaNumber } from '../../netlify/functions/_lib/sms.js'
import { cardSleeveHtml, keyCardDays, paidNightsOf } from '@/services/key-card-stay'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}
process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'

// ─── The check-out morning SMS ───────────────────────────────────────────────
const now = new Date('2026-11-10T07:30:00Z')
const today = '2026-11-10'
const id = () => crypto.randomUUID()
const R = { a: id(), b: id(), c: id() }
const G = { ama: id(), kofi: id(), nophone: id(), yaw: id() }
tables.rooms = [{ id: R.a, room_number: '201' }, { id: R.b, room_number: '202' }, { id: R.c, room_number: '203' }]
tables.guests = [
  { id: G.ama, name: 'Ama Mensah', phone: '024 123 4567' },
  { id: G.kofi, name: 'Kofi Boateng', phone: '+233 20 765 4321' },
  { id: G.nophone, name: 'No Phone', phone: '' },
  { id: G.yaw, name: 'Yaw Asante', phone: '0551112222' },
]
const G2 = id()
tables.guests.push({ id: G2, name: 'Kofi B.', phone: '0207654321' })
const B = { ama: id(), kofi1: id(), kofi2: id(), nophone: id(), later: id(), gone: id(), yaw: id() }
tables.bookings = [
  { id: B.ama, guest_id: G.ama, room_id: R.a, status: 'checked-in', check_in: '2026-11-08', check_out: today, late_check_out: '14:00', checkout_sms_sent_on: null },
  { id: B.kofi1, guest_id: G.kofi, room_id: R.b, status: 'checked-in', check_in: '2026-11-08', check_out: today, checkout_sms_sent_on: null },
  { id: B.kofi2, guest_id: G.kofi, room_id: R.c, status: 'checked-in', check_in: '2026-11-08', check_out: today, checkout_sms_sent_on: null },
  { id: B.nophone, guest_id: G.nophone, room_id: R.c, status: 'checked-in', check_in: '2026-11-08', check_out: today, checkout_sms_sent_on: null },
  { id: B.later, guest_id: G.yaw, room_id: R.c, status: 'checked-in', check_in: '2026-11-08', check_out: '2026-11-12', checkout_sms_sent_on: null },
  { id: id(), guest_id: G2, room_id: R.a, status: 'checked-in', check_in: '2026-11-08', check_out: today, checkout_sms_sent_on: null },
  { id: B.gone, guest_id: G.yaw, room_id: R.c, status: 'checked-out', check_in: '2026-11-08', check_out: today, checkout_sms_sent_on: null },
]
tables.key_cards = [
  { id: id(), kind: 'guest', booking_id: B.ama, status: 'issued', valid_until: '2026-11-10T15:00:00.000Z' },
  { id: id(), kind: 'guest', booking_id: B.kofi1, status: 'returned', valid_until: '2026-11-10T12:00:00.000Z' },
]
tables.hotel_settings = [{ id: 'hs', checkout_morning_sms: false }]

const sent: Array<{ to: string; text: string }> = []
const send = async (to: string, text: string) => { sent.push({ to, text }); return { ok: true, error: null } }
const sb = serviceClient()

let r = await runCheckoutSms(sb, now, send)
check('switched off in Settings: nothing is sent', [r.off, sent.length], [true, 0])
tables.hotel_settings = [{ id: 'hs' }]
r = await runCheckoutSms(sb, now, send)
check('before the database update (no setting yet): nothing is sent', [r.off, sent.length], [true, 0])

tables.hotel_settings = [{ id: 'hs', checkout_morning_sms: true }]
r = await runCheckoutSms(sb, now, send)
check('switched on: one SMS per phone number leaving today (Kofi\'s rooms in one, however the number is written)', [r.sent, r.skipped, sent.map((s) => s.to).sort()], [2, 1, ['233207654321', '233241234567']])
const ama = sent.find((s) => s.to === '233241234567')!.text
check('Ama: her late check-out, and her working key card\'s end',
  [ama.includes('Good morning Ama.'), ama.includes('check-out is at 14:00'), ama.includes('key card stops working at 15:00'), ama.includes('hand your key card(s) in')], [true, true, true, true])
const kofi = sent.find((s) => s.to === '233207654321')!.text
check('Kofi: all his rooms, no key line (no working card)', [kofi.includes('rooms 202, 203, 201'), kofi.includes('check-out is at 11:00'), kofi.includes('key card')], [true, true, false])
check('each booking sent to is marked, so it goes once', [B.ama, B.kofi1, B.kofi2, B.nophone].map((b) => tables.bookings.find((x) => x.id === b)!.checkout_sms_sent_on), [today, today, today, null])
sent.length = 0
r = await runCheckoutSms(sb, now, send)
check('a second run the same morning sends nothing', [r.sent, sent.length], [0, 0])

tables.bookings.find((b) => b.id === B.later)!.check_out = today
r = await runCheckoutSms(sb, now, async () => ({ ok: false, error: 'no credit' }))
check('an SMS the service refuses is not marked as sent', [r.failed, tables.bookings.find((b) => b.id === B.later)!.checkout_sms_sent_on], [1, null])

check('the message is short enough for two SMS parts', checkoutMessage('Ama', [{ roomNumber: '201', leaves: '14:00', keyUntil: '15:00' }]).length <= 306, true)
check('Ghana numbers in Arkesel\'s form', ['024 123 4567', '+233 20 765 4321', '241234567', '12', ''].map(ghanaNumber), ['233241234567', '233207654321', '233241234567', null, null])

// ─── How many nights a guest has paid for ────────────────────────────────────
const booking = (paid: number, extra: any = {}) => ({
  checkIn: '2026-11-07', checkOut: '2026-11-11', totalPrice: 800, amountPaid: paid, ...extra,
})
check('4 nights at 200, 400 paid: 2 nights, cards to the 9th', (({ paid, nights, paidUntil }) => [paid, nights, paidUntil])(paidNightsOf(booking(400), [])!), [2, 4, '2026-11-09'])
check('paid in full: every night, cards to check-out day', paidNightsOf(booking(800), [])!.paidUntil, '2026-11-11')
check('nothing paid yet: the first night is the shortest the cards go', [paidNightsOf(booking(0), [])!.paid, paidNightsOf(booking(0), [])!.paidUntil], [0, '2026-11-08'])
check('a payment a little short of a night does not count it', paidNightsOf(booking(399), [])!.paid, 1)
const extended = { ...booking(1000), totalPrice: 600, checkOut: '2026-11-12' }
const charges = [{ category: 'room_extension', description: 'Stay Extension (2 nights)', quantity: 2, unitPrice: 250, createdAt: '2026-11-08T10:00:00Z' }]
check('3 nights booked at 200, extended 2 at 250, 1000 paid: 4 nights', paidNightsOf(extended, charges)!.paid, 4)
check('a discount on the room is counted', paidNightsOf(booking(600, { discountAmount: 200, finalAmount: 600 }), [])!.paid, 4)
check('payments recorded only in the booking notes count too',
  paidNightsOf({ ...booking(0), amountPaid: undefined, specialRequests: '<!-- PAYMENT_DATA:{"amountPaid":600} -->' }, [])!.paid, 3)
check('the days the cards can stop on: each day after arrival, check-out last', keyCardDays('2026-11-07', '2026-11-10'), ['2026-11-08', '2026-11-09', '2026-11-10'])

// ─── The card sleeve ─────────────────────────────────────────────────────────
const sleeve = cardSleeveHtml({ roomNumber: '201', guestName: 'Ama <b>Mensah', stay: { checkIn: '2026-11-07', checkOut: '2026-11-10', lateCheckOut: '14:00' }, cards: 2 })
check('the sleeve: room, late check-out, key end, first name only, escaped',
  [sleeve.includes('>201<'), sleeve.includes('Tue 10 Nov, 14:00'), sleeve.includes('Tue 10 Nov, 15:00'), sleeve.includes('Welcome, Ama<'), sleeve.includes('<b>Mensah')], [true, true, true, true, false])
const paidSleeve = cardSleeveHtml({ roomNumber: '201', stay: { checkIn: '2026-11-07', checkOut: '2026-11-10', keyCardsUntil: '2026-11-08' } })
check('a sleeve for paid nights says the key stops after them', [paidSleeve.includes('Sun 8 Nov, 12:00'), paidSleeve.includes('nights paid for')], [true, true])

console.log(failures ? `FAILURE: ${failures} failed` : 'ALL PASS key card stay: check-out morning SMS, paid nights, card sleeve')
process.exit(failures ? 1 : 0)
