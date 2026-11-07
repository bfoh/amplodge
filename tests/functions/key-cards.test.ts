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
import { handler as lockout } from '../../netlify/functions/key-card-lockout.js'
import { suggestDoorRoom } from '@/services/key-cards'
import { NO_BOOKING, cardTime, ceilToMinute, floorToMinute, isLockNo, nextDai, validityFor, verifyOrder } from '../../netlify/functions/_lib/key-cards.js'

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
check('lock numbers: the 6-hex code of the Lock Management System, in capitals', ['01020A', 'FFFFFF', '010309', '01020a', '01010101', '01020', '01020G'].map(isLockNo), [true, true, true, false, false, false, false])
check('the DAI counts 1..255, then starts again at 1', [null, 0, 1, 254, 255].map(nextDai), [1, 1, 2, 255, 1])

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
check('a receptionist cannot set lock numbers', (await call(saveLocks, bearer('staff'), { roomId: R.r101, locks: [{ lockNo: '01020A' }] })).status, 403)
r = await call(saveLocks, bearer('admin'), { roomId: R.r101, locks: [{ lockNo: '01020G' }] })
check('a malformed lock number is refused, saying what one looks like', [r.status, r.body.error?.includes('6-character code')], [400, true])
check('the old 8-digit form is refused', (await call(saveLocks, bearer('admin'), { roomId: R.r101, locks: [{ lockNo: '01010101' }] })).status, 400)
r = await call(saveLocks, bearer('admin'), { roomId: R.r101, locks: [{ lockNo: ' 01020a ' }, { lockNo: '01020B' }] })
check('an admin sets room 101; a code typed in small letters is stored in capitals', [r.status, r.body.locks.map((l: any) => l.lock_no).sort()], [200, ['01020A', '01020B']])
r = await call(saveLocks, bearer('admin'), { roomId: R.r101, locks: [{ lockNo: '01020A' }] })
check('...and changes it: the removed lock goes', tables.room_locks.filter((l) => l.room_id === R.r101).map((l) => l.lock_no), ['01020A'])
r = await call(saveLocks, bearer('admin'), { roomId: R.suite, locks: [{ lockNo: '01030A', label: '110' }, { lockNo: '010309', label: '109' }] })
check('the suite has two doors', [r.status, r.body.locks.length], [200, 2])
r = await call(saveLocks, bearer('admin'), { roomId: R.r102, locks: [{ lockNo: '01020a' }] })
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
check('it is a v2 order: the stay\'s DAI, starting at 1 for a door never carded', [first.v, first.dai], [2, 1])
check('a changed order fails the signature', verifyOrder(r.body.order.replace(first.end, '9912311200'), r.body.signature, enc1.publicKey), false)
check('the order names the doors, card numbers and times', [first.cards, first.room, first.guest],
  [[{ cardNo: 0, lockNos: ['01020A'] }, { cardNo: 1, lockNos: ['01020A'] }], '101', 'Ama Mensah'])
check('it ends check-out day at 12:00', first.end, day(3).slice(2).replace(/-/g, '') + '1200')
check('it starts an hour back', first.begin, cardTime(floorToMinute(new Date(Date.now() - 3600000))))
const amaRows = () => tables.key_cards.filter((c) => c.booking_id === B.ama)
check('two pending cards are recorded, with the DAI', amaRows().map((c) => [c.status, c.card_no, c.encoder_id === enc1.id, c.dai]), [['pending', 0, true, 1], ['pending', 1, true, 1]])

r = await ask(B.esi)
check('another guest cannot get a card for a door that is still taken', [r.status, r.body.error?.startsWith('A card for Ama Mensah')], [409, true])

// ─── The bridge reports back ─────────────────────────────────────────────────
const report = (token: string | null, body: any) => call(receipt, token ? `Device ${token}` : null, body)
check('no device token: 401', (await report(null, { nonce: first.nonce, cards: [] })).status, 401)
check('a made-up token: 401', (await report('nope', { nonce: first.nonce, cards: [] })).status, 401)
r = await report(enc1.token, { nonce: first.nonce, cards: [{ cardNo: 0, status: 'issued' }, { cardNo: 1, status: 'issued' }], dllVersion: 'ProUsb-20211115' })
check('the bridge confirms both cards', [r.status, r.body.updated, amaRows().map((c) => c.status)], [200, 2, ['issued', 'issued']])
r = await report(enc1.token, { nonce: first.nonce, cards: [{ cardNo: 0, status: 'issued' }] })
check('a resent report changes nothing', [r.status, r.body.updated], [200, 0])
r = await report(enc1.token, { nonce: first.nonce, cards: [{ cardNo: 1, status: 'failed' }] })
check('a confirmed card cannot be turned back into a failure', [r.body.updated, amaRows()[1].status], [0, 'issued'])
check('each card is in the activity log', tables.activity_logs.filter((l) => l.action === 'key_card_issued').length, 2)

// ─── A third card later ──────────────────────────────────────────────────────
r = await ask(B.ama, 1)
const extra = JSON.parse(r.body.order)
check('an extra card keeps the start time and DAI and takes the next number', [extra.begin, extra.dai, extra.cards], [first.begin, first.dai, [{ cardNo: 2, lockNos: ['01020A'] }]])
await report(enc1.token, { nonce: extra.nonce, cards: [{ cardNo: 2, status: 'issued' }] })

// ─── Clearing the door for the next guest ────────────────────────────────────
const amaCard = (no: number) => amaRows().find((c) => c.card_no === no)!
r = await call(mark, bearer('staff'), { cardId: amaCard(0).id, status: 'not_returned', note: 'left early' })
check('reception marks a card the guest kept', [r.status, amaCard(0).status], [200, 'not_returned'])
r = await ask(B.esi)
check('...the cards nobody has accounted for still hold the door', [r.status, r.body.error?.includes('the guest kept it')], [409, true])
await call(mark, bearer('staff'), { cardId: amaCard(1).id, status: 'returned' })
await call(mark, bearer('staff'), { cardId: amaCard(2).id, status: 'killed_at_door' })
r = await ask(B.esi)
check('a card the guest kept does not hold the door: the next guest gets a card', r.status, 200)
const esiOrder = JSON.parse(r.body.order)
const esiCard = tables.key_cards.find((c) => c.order_nonce === esiOrder.nonce)!
check('the next stay in the room gets the next DAI, so its card locks out the kept one', [esiOrder.dai, esiCard.dai], [2, 2])
check('a card still being written cannot be marked', (await call(mark, bearer('staff'), { cardId: esiCard.id, status: 'returned' })).status, 409)
await report(enc1.token, { nonce: esiOrder.nonce, cards: [{ cardNo: 0, status: 'issued' }] })

// ─── A lost card ─────────────────────────────────────────────────────────────
const lost = (bookingId: string, count = 1) => call(order, bearer('staff'), { bookingId, count, challenge: challenge(), replace: true })
r = await ask(B.esi, 1)
const esiExtra = JSON.parse(r.body.order)
await report(enc1.token, { nonce: esiExtra.nonce, cards: [{ cardNo: 1, status: 'issued' }] })
check('Esi has two working cards, both on DAI 2', tables.key_cards.filter((c) => c.booking_id === B.esi).map((c) => [c.status, c.dai]), [['issued', 2], ['issued', 2]])
const esiRows = () => tables.key_cards.filter((c) => c.booking_id === B.esi)
for (const c of esiRows()) c.issue_time = new Date(Date.now() - 86400000).toISOString() // made yesterday
r = await lost(B.esi, 2)
const replaced = JSON.parse(r.body.order)
check('one is lost: the stay gets new cards with a new DAI, numbered from 0, starting an hour back from now',
  [r.status, replaced.dai, replaced.cards.map((c: { cardNo: number }) => c.cardNo), replaced.begin], [200, 3, [0, 1], cardTime(floorToMinute(new Date(Date.now() - 3600000)))])
check('the stay\'s old cards are marked replaced, with why', esiRows().filter((c) => c.dai === 2).map((c) => [c.status, !!c.note]), [['replaced', true], ['replaced', true]])
check('the order is logged with how many cards it replaced', tables.activity_logs.filter((l) => l.action === 'key_card_ordered').at(-1)?.details?.replaced, 2)
r = await report(enc1.token, { nonce: esiOrder.nonce, cards: [{ cardNo: 0, status: 'unknown' }] })
check('a late report cannot bring a replaced card back', [r.body.updated, esiRows().find((c) => c.order_nonce === esiOrder.nonce)!.status], [0, 'replaced'])
await report(enc1.token, { nonce: replaced.nonce, cards: [{ cardNo: 0, status: 'issued' }, { cardNo: 1, status: 'issued' }] })
r = await ask(B.esi, 1)
check('an extra card after that takes the new DAI and the next number', [JSON.parse(r.body.order).dai, JSON.parse(r.body.order).cards[0].cardNo], [3, 2])
const oldCard = esiRows().find((c) => c.order_nonce === esiExtra.nonce)!
check('a replaced card can be marked returned when it turns up...', (await call(mark, bearer('staff'), { cardId: oldCard.id, status: 'returned' })).status, 200)
const oldCard2 = esiRows().find((c) => c.order_nonce === esiOrder.nonce)!
check('...but not "guest kept it", which would count it as opening the door again', (await call(mark, bearer('staff'), { cardId: oldCard2.id, status: 'not_returned' })).status, 409)
check('no working cards, nothing to replace', (await lost(B.noLock)).status, 409)

// ─── A lock-out card ─────────────────────────────────────────────────────────
const lockOut = (roomId: string, ch = challenge(), who = 'staff') => call(lockout, bearer(who), { roomId, challenge: ch })
check('a lock-out card needs a login', (await call(lockout, null, { roomId: R.r101, challenge: challenge() })).status, 401)
check('...and a challenge from the bridge', (await call(lockout, bearer('staff'), { roomId: R.r101 })).status, 400)
check('...and a room', (await lockOut('not-a-room')).status, 400)
check('an unknown room is refused', (await lockOut(id())).status, 404)
r = await lockOut(R.r102)
check('a room without a lock number is refused', [r.status, r.body.error?.startsWith('Room 102 has no lock number')], [409, true])
r = await lockOut(R.r101)
check('not while a guest staying in the room has working cards: theirs would stop too', [r.status, / is staying in room 101 with working cards/.test(r.body.error)], [409, true])

for (const b of tables.bookings.filter((k) => k.id === B.esi || k.id === B.ama)) b.status = 'checked-out'
const liveOn101 = () => tables.key_cards.filter((c) => c.lock_nos.includes('01020A') && ['issued', 'unknown', 'not_returned', 'pending'].includes(c.status) && c.kind !== 'lockout')
const before = liveOn101().map((c) => c.id)
r = await lockOut(R.r101)
const out = JSON.parse(r.body.order)
check('once the room is empty, staff get a lock-out card order, signed', [r.status, verifyOrder(r.body.order, r.body.signature, enc1.publicKey)], [200, true])
check('it is a guest-card order the installed bridges take: no booking, the next DAI, one card for the door',
  [out.kind, out.purpose, out.bookingId, out.guest, out.room, out.dai, out.cards], ['guest-cards', 'lockout', NO_BOOKING, null, '101', 4, [{ cardNo: 0, lockNos: ['01020A'] }]])
check('it works for 20 minutes', out.end, cardTime(ceilToMinute(new Date(Date.now() + 20 * 60000))))
const outRows = () => tables.key_cards.filter((c) => c.order_nonce === out.nonce)
check('it is recorded as a lock-out card of no stay', outRows().map((c) => [c.kind, c.booking_id, c.room_id === R.r101, c.status, c.dai]), [['lockout', null, true, 'pending', 4]])
check('every card that could still open the door is marked locked out, with why',
  [before.length > 0, before.every((cid) => { const c = tables.key_cards.find((k) => k.id === cid)!; return c.status === 'locked_out' && c.note?.includes('lock-out card') }), r.body.summary.lockedOut],
  [true, true, before.length])
check('the lock-out is logged', tables.activity_logs.filter((l) => l.action === 'key_card_lockout').at(-1)?.details?.lockedOut, before.length)
r = await report(enc1.token, { nonce: out.nonce, cards: [{ cardNo: 0, status: 'issued' }] })
check('the bridge reports it written', [r.status, outRows()[0].status], [200, 'issued'])
check('a lock-out card can only be marked returned', [
  (await call(mark, bearer('staff'), { cardId: outRows()[0].id, status: 'not_returned' })).status,
  (await call(mark, bearer('staff'), { cardId: outRows()[0].id, status: 'returned' })).status,
], [409, 200])
const lockedOut = tables.key_cards.find((c) => c.id === before[0])!
check('a locked-out card that turns up can be marked returned, nothing else', [
  (await call(mark, bearer('staff'), { cardId: lockedOut.id, status: 'not_returned' })).status,
  (await call(mark, bearer('staff'), { cardId: lockedOut.id, status: 'returned' })).status,
], [409, 200])
r = await lockOut(R.r101)
const out2 = JSON.parse(r.body.order)
check('another lock-out for the same door takes the next DAI again', [r.status, out2.dai], [200, 5])
const B_next = id()
tables.bookings.push({ id: B_next, room_id: R.r101, guest_id: G.yaw, status: 'checked-in', check_in: day(0), check_out: day(2) })
r = await ask(B_next)
check('a live lock-out card does not hold the door: the next guest gets a card, with the DAI after it', [r.status, JSON.parse(r.body.order).dai], [200, 6])
const R201 = id()
tables.rooms.push({ id: R201, room_number: '201' })
await call(saveLocks, bearer('admin'), { roomId: R201, locks: [{ lockNo: '0102A0' }, { lockNo: '0102A1' }] })
r = await lockOut(R201)
check('a two-door room gets a lock-out card for each door, even with no cards on record', [r.status, JSON.parse(r.body.order).cards, r.body.summary.lockedOut],
  [200, [{ cardNo: 0, lockNos: ['0102A0'] }, { cardNo: 1, lockNos: ['0102A1'] }], 0])

// ─── The suite, and a second PC ──────────────────────────────────────────────
r = await ask(B.suite, 1)
const suite = JSON.parse(r.body.order)
check('a two-door suite gets one card per door until Joney confirms suite cards', suite.cards,
  [{ cardNo: 0, lockNos: ['010309'] }, { cardNo: 1, lockNos: ['01030A'] }])
check('the DAI is kept per door: the suite starts at 1', suite.dai, 1)
r = await call(pair, bearer('admin'), { action: 'start', label: 'Back office' })
r = await call(pair, null, { action: 'redeem', code: r.body.code })
const enc2 = { id: r.body.encoderId as string, token: r.body.deviceToken as string }
check('another PC cannot report on this PC\'s order', (await report(enc2.token, { nonce: suite.nonce, cards: [{ cardNo: 0, status: 'issued' }] })).status, 403)
check('the suite is held while its cards are being written', (await ask(B.yaw)).status, 409)
for (const c of tables.key_cards.filter((k) => k.order_nonce === suite.nonce)) c.created_at = new Date(Date.now() - 20 * 60000).toISOString()
r = await ask(B.yaw)
check('an order never written stops holding the door after 15 minutes', r.status, 200)
check('...and the next stay still takes a new DAI: two stays never share one', JSON.parse(r.body.order).dai, 2)

// ─── A card whose writing was cut off, read back at the encoder ──────────────
const nextCard = tables.key_cards.find((c) => c.booking_id === B_next)!
await report(enc1.token, { nonce: nextCard.order_nonce, cards: [{ cardNo: 0, status: 'unknown' }] })
const issuedLogs = tables.activity_logs.filter((l) => l.action === 'key_card_issued').length
r = await call(mark, bearer('staff'), { cardId: nextCard.id, status: 'issued', note: 'Read back at the encoder' })
check('a cut-off card that reads back right can be marked working', [r.status, nextCard.status, nextCard.note], [200, 'issued', 'Read back at the encoder'])
check('...and that is logged', tables.activity_logs.filter((l) => l.action === 'key_card_issued').length, issuedLogs + 1)
check('only a cut-off card: "working" cannot be put back on any other card', [
  (await call(mark, bearer('staff'), { cardId: nextCard.id, status: 'issued' })).status,
  (await call(mark, bearer('staff'), { cardId: lockedOut.id, status: 'issued' })).status,
  (await call(mark, bearer('staff'), { cardId: outRows()[0].id, status: 'issued' })).status,
], [409, 409, 409])

// ─── Which room a door code read from a card belongs to ─────────────────────
{
  const room = (n: string, ...codes: string[]) => ({ roomId: `id-${n}`, roomNumber: n, locks: codes.map((c) => ({ id: c, roomId: `id-${n}`, lockNo: c, label: null })) })
  const floor = [room('201', '0B0101'), room('202'), room('203'), room('204', '0B0104'), room('210'), room('FLAT', '0B0130'), room('101', '0B0001')]
  check('from the rooms whose codes start the same way: 201 is …01 and 204 is …04, so …02 is 202',
    suggestDoorRoom('0b0102', floor), { roomId: 'id-202', basis: ['201', '204'] })
  check('the last part is hex: …0A is 210', suggestDoorRoom('0B010A', floor).roomId, 'id-210')
  check('no room with that number: no suggestion', suggestDoorRoom('0B0109', floor).roomId, null)
  check('another floor\'s pattern is not used', suggestDoorRoom('0B0203', floor).roomId, null)
  const odd = [...floor, room('205', '0B0109')]
  check('a room off the pattern means there is no pattern (the lock program numbers doors as they were set up)', suggestDoorRoom('0B0103', odd).roomId, null)
  check('one room is no pattern: 201 is …01 does not make …0B room 211', suggestDoorRoom('0B010B', [room('201', '0B0101'), room('211')]).roomId, null)
  check('not a door code: nothing', suggestDoorRoom('C9', floor).roomId, null)
}

// ─── Unpairing ───────────────────────────────────────────────────────────────
check('a receptionist cannot unpair a PC', (await call(pair, bearer('staff'), { action: 'revoke', encoderId: enc1.id })).status, 403)
check('an admin unpairs the front desk PC', (await call(pair, bearer('admin'), { action: 'revoke', encoderId: enc1.id })).status, 200)
check('...its challenges no longer get orders', (await ask(B.ama)).status, 409)
check('...and its token no longer reports', (await report(enc1.token, { nonce: esiOrder.nonce, cards: [{ cardNo: 0, status: 'issued' }] })).status, 401)

console.log(failures ? `FAILURE: ${failures} failed` : 'ALL PASS key cards: server-decided doors, times and DAI, signed orders, one door one guest, bridge receipts, pairing')
process.exit(failures ? 1 : 0)
