/**
 * Door-lock key cards: the server decides which door a card opens and until
 * when, signs the order for the reception PC's lock bridge, and records what
 * the bridge reports. These run the real handlers against the in-memory
 * database, with a real ECDSA key.
 */
import crypto from 'node:crypto'
import { authUsers, tables, tokens, uuidTables } from './fake-supabase-js'
import { handler as saveLocks } from '../../netlify/functions/room-locks-save.js'
import { handler as pair } from '../../netlify/functions/lock-encoder-pair.js'
import { handler as order } from '../../netlify/functions/key-card-order.js'
import { handler as receipt } from '../../netlify/functions/key-card-receipt.js'
import { handler as mark } from '../../netlify/functions/key-card-mark.js'
import { cardTime, floorToMinute, isLockNo, validityFor, verifyOrder } from '../../netlify/functions/_lib/key-cards.js'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.LOCK_ORDER_PRIVATE_KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
uuidTables.add('lock_encoders'); uuidTables.add('key_cards'); uuidTables.add('room_locks')

// ─── The rules on their own ──────────────────────────────────────────────────
check('card time is yyMMddHHmm, hotel (GMT) time', cardTime(new Date(Date.UTC(2026, 10, 7, 9, 5))), '2611070905')
let v = validityFor('2026-11-10', new Date('2026-11-07T09:30:40Z'))
check('a card starts an hour back (slow lock clocks) and ends check-out day 11:00 + 1 h',
  [v.begin.toISOString(), v.end.toISOString(), v.capped], ['2026-11-07T08:30:00.000Z', '2026-11-10T12:00:00.000Z', false])
v = validityFor('2027-01-30', new Date('2026-11-07T09:30:00Z'))
check('never valid for more than 30 days', [v.end.toISOString(), v.capped], ['2026-12-07T08:30:00.000Z', true])
v = validityFor('2026-11-12', new Date('2026-11-08T10:00:00Z'), '2026-11-07T08:30:00.000Z')
check('extra cards keep the booking\'s start time', v.begin.toISOString(), '2026-11-07T08:30:00.000Z')
check('lock numbers: 8 digits, first pair 00..15', ['01011003', '15990000', '16010101', '0101100', '0101100a'].map(isLockNo), [true, true, false, false, false])

// ─── A small hotel ───────────────────────────────────────────────────────────
const person = (id: string, role: string) => {
  authUsers.push({ id, email: `${role}@amp.test` })
  tokens[`tok-${role}`] = id
  return { id: crypto.randomUUID(), user_id: id, name: role, email: `${role}@amp.test`, role }
}
tables.staff = [person('u-owner', 'owner'), person('u-admin', 'admin'), person('u-desk', 'staff')]

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const id = () => crypto.randomUUID()
const R = { r101: id(), suite: id(), r102: id() }
tables.rooms = [
  { id: R.r101, room_number: '101' },
  { id: R.suite, room_number: '110+109' },
  { id: R.r102, room_number: '102' },
]
const G = { ama: id(), kofi: id(), esi: id(), yaw: id() }
tables.guests = [
  { id: G.ama, name: 'Ama Mensah' }, { id: G.kofi, name: 'Kofi Boateng' },
  { id: G.esi, name: 'Esi Owusu' }, { id: G.yaw, name: 'Yaw Darko' },
]
const B = { ama: id(), later: id(), noLock: id(), suite: id(), gone: id(), esi: id(), yaw: id() }
tables.bookings = [
  { id: B.ama, room_id: R.r101, guest_id: G.ama, status: 'checked-in', check_in: day(0), check_out: day(3) },
  { id: B.later, room_id: R.r101, guest_id: G.kofi, status: 'confirmed', check_in: day(4), check_out: day(6) },
  { id: B.noLock, room_id: R.r102, guest_id: G.kofi, status: 'checked-in', check_in: day(0), check_out: day(1) },
  { id: B.suite, room_id: R.suite, guest_id: G.kofi, status: 'checked-in', check_in: day(0), check_out: day(2) },
  { id: B.gone, room_id: R.r101, guest_id: G.kofi, status: 'checked-out', check_in: day(-2), check_out: day(0) },
  { id: B.esi, room_id: R.r101, guest_id: G.esi, status: 'confirmed', check_in: day(0), check_out: day(1) },
  { id: B.yaw, room_id: R.suite, guest_id: G.yaw, status: 'reserved', check_in: day(0), check_out: day(1) },
]
tables.room_locks = []; tables.lock_encoders = []; tables.key_cards = []; tables.activity_logs = []

const call = async (fn: any, auth: string | null, body: any) => {
  const res: any = await fn({
    httpMethod: 'POST',
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  })
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') }
}
const bearer = (role: string) => `Bearer tok-${role}`

// ─── Pairing the reception PC ────────────────────────────────────────────────
check('a receptionist cannot start pairing', (await call(pair, bearer('staff'), { action: 'start' })).status, 403)
let r = await call(pair, bearer('admin'), { action: 'start', label: 'Front desk PC' })
check('an admin gets a one-time code', [r.status, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/.test(r.body.code)], [200, true])
const code1 = r.body.code
check('a wrong code is refused', (await call(pair, null, { action: 'redeem', code: 'AAAAA-BBBBB-CCCCC-DDDDD' })).status, 404)
r = await call(pair, null, { action: 'redeem', code: ` ${code1.toLowerCase().replace(/-/g, ' ')} `, bridgeVersion: '0.1.0' })
check('the bridge swaps the code (typed loosely) for a token and the public key', [r.status, !!r.body.deviceToken, !!r.body.publicKey], [200, true, true])
const enc1 = { id: r.body.encoderId as string, token: r.body.deviceToken as string, publicKey: r.body.publicKey as string }
check('only the token\'s hash is stored', tables.lock_encoders[0].token_hash === crypto.createHash('sha256').update(enc1.token).digest('hex'), true)
check('the code works once', (await call(pair, null, { action: 'redeem', code: code1 })).status, 404)
r = await call(pair, bearer('admin'), { action: 'start', label: 'Old PC' })
tables.lock_encoders.find((e) => e.id === r.body.encoderId)!.pairing_expires_at = new Date(Date.now() - 1000).toISOString()
check('an expired code is refused', (await call(pair, null, { action: 'redeem', code: r.body.code })).status, 404)
r = await call(pair, bearer('admin'), { action: 'list' })
check('admins see the PCs, without secrets', [r.body.encoders.map((e: any) => e.state).sort(), JSON.stringify(r.body).includes('hash')], [['expired', 'paired'], false])

// ─── Lock numbers ────────────────────────────────────────────────────────────
check('a receptionist cannot set lock numbers', (await call(saveLocks, bearer('staff'), { roomId: R.r101, locks: [{ lockNo: '01010101' }] })).status, 403)
check('a malformed lock number is refused', (await call(saveLocks, bearer('admin'), { roomId: R.r101, locks: [{ lockNo: '16010101' }] })).status, 400)
r = await call(saveLocks, bearer('admin'), { roomId: R.r101, locks: [{ lockNo: '01010101' }, { lockNo: '01010199' }] })
check('an admin sets room 101', [r.status, r.body.locks.length], [200, 2])
r = await call(saveLocks, bearer('admin'), { roomId: R.r101, locks: [{ lockNo: '01010101' }] })
check('...and changes it: the removed lock goes', tables.room_locks.filter((l) => l.room_id === R.r101).map((l) => l.lock_no), ['01010101'])
r = await call(saveLocks, bearer('admin'), { roomId: R.suite, locks: [{ lockNo: '01011001', label: '110' }, { lockNo: '01010901', label: '109' }] })
check('the suite has two doors', [r.status, r.body.locks.length], [200, 2])
r = await call(saveLocks, bearer('admin'), { roomId: R.r102, locks: [{ lockNo: '01010101' }] })
check('one lock cannot belong to two rooms', [r.status, r.body.error?.includes('room 101')], [409, true])

// ─── Ordering cards ──────────────────────────────────────────────────────────
const challenge = (encoderId = enc1.id) => `${encoderId}.${crypto.randomBytes(18).toString('base64url')}`
const ask = (bookingId: string, count = 1, ch = challenge(), who = 'staff') => call(order, bearer(who), { bookingId, count, challenge: ch })

check('no login, no card', (await call(order, null, { bookingId: B.ama, challenge: challenge() })).status, 401)
check('no challenge from the bridge, no card', (await call(order, bearer('staff'), { bookingId: B.ama })).status, 400)
check('a PC that was never paired is refused', (await ask(B.ama, 1, challenge(id()))).status, 409)
check('at most 4 cards at a time', (await ask(B.ama, 5)).status, 400)
check('a guest arriving another day is refused', (await ask(B.later)).status, 409)
check('a checked-out guest is refused', (await ask(B.gone)).status, 409)
r = await ask(B.noLock)
check('a room without a lock number is refused, with what to do', [r.status, r.body.error], [409, 'Room 102 has no lock number yet. An admin can add it on the Rooms page.'])

r = await ask(B.ama, 2)
check('a checked-in guest gets two cards', r.status, 200)
const first = JSON.parse(r.body.order)
check('the order is signed by the server\'s key', verifyOrder(r.body.order, r.body.signature, enc1.publicKey), true)
check('a changed order fails the signature', verifyOrder(r.body.order.replace(first.end, '9912311200'), r.body.signature, enc1.publicKey), false)
check('the order names the doors, card numbers and times', [first.cards, first.room, first.guest],
  [[{ cardNo: 0, lockNos: ['01010101'] }, { cardNo: 1, lockNos: ['01010101'] }], '101', 'Ama Mensah'])
check('it ends check-out day at 12:00', first.end, day(3).slice(2).replace(/-/g, '') + '1200')
check('it starts an hour back', first.begin, cardTime(floorToMinute(new Date(Date.now() - 3600000))))
const amaRows = () => tables.key_cards.filter((c) => c.booking_id === B.ama)
check('two pending cards are recorded', amaRows().map((c) => [c.status, c.card_no, c.encoder_id === enc1.id]), [['pending', 0, true], ['pending', 1, true]])

r = await ask(B.esi)
check('another guest cannot get a card for a door that is still taken', [r.status, r.body.error?.startsWith('A card for Ama Mensah')], [409, true])

// ─── The bridge reports back ─────────────────────────────────────────────────
const report = (token: string | null, body: any) => call(receipt, token ? `Device ${token}` : null, body)
check('no device token: 401', (await report(null, { nonce: first.nonce, cards: [] })).status, 401)
check('a made-up token: 401', (await report('nope', { nonce: first.nonce, cards: [] })).status, 401)
r = await report(enc1.token, { nonce: first.nonce, cards: [{ cardNo: 0, status: 'issued' }, { cardNo: 1, status: 'issued' }], dllVersion: 'proRFL 2009' })
check('the bridge confirms both cards', [r.status, r.body.updated, amaRows().map((c) => c.status)], [200, 2, ['issued', 'issued']])
r = await report(enc1.token, { nonce: first.nonce, cards: [{ cardNo: 0, status: 'issued' }] })
check('a resent report changes nothing', [r.status, r.body.updated], [200, 0])
r = await report(enc1.token, { nonce: first.nonce, cards: [{ cardNo: 1, status: 'failed' }] })
check('a confirmed card cannot be turned back into a failure', [r.body.updated, amaRows()[1].status], [0, 'issued'])
check('each card is in the activity log', tables.activity_logs.filter((l) => l.action === 'key_card_issued').length, 2)

// ─── A third card later ──────────────────────────────────────────────────────
r = await ask(B.ama, 1)
const extra = JSON.parse(r.body.order)
check('an extra card keeps the start time and takes the next number', [extra.begin, extra.cards], [first.begin, [{ cardNo: 2, lockNos: ['01010101'] }]])
await report(enc1.token, { nonce: extra.nonce, cards: [{ cardNo: 2, status: 'issued' }] })

// ─── Clearing the door for the next guest ────────────────────────────────────
const amaCard = (no: number) => amaRows().find((c) => c.card_no === no)!
r = await call(mark, bearer('staff'), { cardId: amaCard(0).id, status: 'not_returned', note: 'left early' })
check('reception marks a card the guest kept', [r.status, amaCard(0).status], [200, 'not_returned'])
check('...which still blocks the door until it expires', (await ask(B.esi)).status, 409)
for (const no of [0, 1, 2]) await call(mark, bearer('staff'), { cardId: amaCard(no).id, status: 'killed_at_door' })
r = await ask(B.esi)
check('once the cards are cancelled at the door, the next guest gets a card', r.status, 200)
const esiOrder = JSON.parse(r.body.order)
const esiCard = tables.key_cards.find((c) => c.order_nonce === esiOrder.nonce)!
check('a card still being written cannot be marked', (await call(mark, bearer('staff'), { cardId: esiCard.id, status: 'returned' })).status, 409)

// ─── The suite, and a second PC ──────────────────────────────────────────────
r = await ask(B.suite, 1)
const suite = JSON.parse(r.body.order)
check('a two-door suite gets one card per door until Joney confirms suite cards', suite.cards,
  [{ cardNo: 0, lockNos: ['01010901'] }, { cardNo: 1, lockNos: ['01011001'] }])
r = await call(pair, bearer('admin'), { action: 'start', label: 'Back office' })
r = await call(pair, null, { action: 'redeem', code: r.body.code })
const enc2 = { id: r.body.encoderId as string, token: r.body.deviceToken as string }
check('another PC cannot report on this PC\'s order', (await report(enc2.token, { nonce: suite.nonce, cards: [{ cardNo: 0, status: 'issued' }] })).status, 403)
check('the suite is held while its cards are being written', (await ask(B.yaw)).status, 409)
for (const c of tables.key_cards.filter((k) => k.order_nonce === suite.nonce)) c.created_at = new Date(Date.now() - 20 * 60000).toISOString()
check('an order never written stops holding the door after 15 minutes', (await ask(B.yaw)).status, 200)

// ─── Unpairing ───────────────────────────────────────────────────────────────
check('a receptionist cannot unpair a PC', (await call(pair, bearer('staff'), { action: 'revoke', encoderId: enc1.id })).status, 403)
check('an admin unpairs the front desk PC', (await call(pair, bearer('admin'), { action: 'revoke', encoderId: enc1.id })).status, 200)
check('...its challenges no longer get orders', (await ask(B.ama)).status, 409)
check('...and its token no longer reports', (await report(enc1.token, { nonce: esiOrder.nonce, cards: [{ cardNo: 0, status: 'issued' }] })).status, 401)

console.log(failures ? `FAILURE: ${failures} failed` : 'ALL PASS key cards: server-decided doors and times, signed orders, one door one guest, bridge receipts, pairing')
process.exit(failures ? 1 : 0)
