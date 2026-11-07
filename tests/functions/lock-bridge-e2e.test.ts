/**
 * The whole key-card loop across the three real pieces:
 *   the portal's client code (src/services/lock-bridge.ts)
 *   → the .NET lock bridge (the simulator build, a real process on 127.0.0.1:47123)
 *   → the real Netlify handlers, served over HTTP against the in-memory database.
 * Pairing, a signed order, two cards written, and the bridge's own receipts
 * landing in key_cards. The browser is played by a fetch wrapper that adds the
 * Origin header Chrome would send.
 *
 * Needs the simulator built: run through tests/run.sh, which builds it.
 */
import crypto from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { authUsers, clientSession, tables, tokens, uuidTables } from './fake-supabase-js'
import { handler as pair } from '../../netlify/functions/lock-encoder-pair.js'
import { handler as order } from '../../netlify/functions/key-card-order.js'
import { handler as receipt } from '../../netlify/functions/key-card-receipt.js'
import { handler as lockout } from '../../netlify/functions/key-card-lockout.js'
import { handler as mark } from '../../netlify/functions/key-card-mark.js'
import { handler as saveLocks } from '../../netlify/functions/room-locks-save.js'
import { callFunction } from '@/lib/api'
import {
  BRIDGE_URL, BridgeError, OrderRefused, adoptPairedBridge, bridgeStatus, forgetEncoderPc, getEncoderPc,
  pairThisPc, prepareCardUpdate, prepareKeyCards, prepareLockoutCard, readCard, writeKeyCard,
} from '@/services/lock-bridge'
import { identifyCard, markCard, placeDoorCode, saveRoomLocks } from '@/services/key-cards'
import { cardsOut, cardsOutOfStep } from '@/services/key-card-prompt'

let failures = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(what: () => T | Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const end = Date.now() + ms
  let v = await what()
  while (!ok(v) && Date.now() < end) { await sleep(100); v = await what() }
  return v
}

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.LOCK_ORDER_PRIVATE_KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
uuidTables.add('lock_encoders'); uuidTables.add('key_cards'); uuidTables.add('room_locks')

// ─── A small hotel ───────────────────────────────────────────────────────────
const person = (id: string, role: string) => {
  authUsers.push({ id, email: `${role}@amp.test` })
  tokens[`tok-${role}`] = id
  return { id: crypto.randomUUID(), user_id: id, name: role, email: `${role}@amp.test`, role }
}
tables.staff = [person('u-admin', 'admin'), person('u-desk', 'staff')]
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const ROOM = crypto.randomUUID(), GUEST = crypto.randomUUID(), BOOKING = crypto.randomUUID()
tables.rooms = [{ id: ROOM, room_number: '101' }]
tables.guests = [{ id: GUEST, name: 'Ama Mensah' }]
tables.bookings = [{ id: BOOKING, room_id: ROOM, guest_id: GUEST, status: 'checked-in', check_in: day(0), check_out: day(3) }]
tables.room_locks = [{ id: crypto.randomUUID(), room_id: ROOM, lock_no: '01030A', label: null }]
tables.lock_encoders = []; tables.key_cards = []; tables.activity_logs = []

// ─── The server: the real handlers over HTTP ─────────────────────────────────
type Handler = (event: { httpMethod?: string; headers: Record<string, string>; body: string }) => Promise<{ statusCode: number; body?: string }>
const handlers: Record<string, Handler> = { 'lock-encoder-pair': pair, 'key-card-order': order, 'key-card-receipt': receipt, 'key-card-lockout': lockout, 'key-card-mark': mark, 'room-locks-save': saveLocks }
const server = http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const fn = handlers[(req.url || '').replace(/^\/\.netlify\/functions\//, '').split('?')[0]]
  if (!fn) { res.writeHead(404).end('{}'); return }
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]))
  const r = await fn({ httpMethod: req.method, headers, body })
  res.writeHead(r.statusCode, { 'content-type': 'application/json' }).end(r.body || '')
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port

// ─── The browser: relative function URLs, Chrome's Origin, localStorage ──────
const realFetch = globalThis.fetch
globalThis.fetch = ((input: string | URL, init: RequestInit = {}) => {
  let url = typeof input === 'string' ? input : String(input)
  if (url.startsWith('/.netlify/functions/')) url = `http://127.0.0.1:${port}${url}`
  if (url.startsWith(BRIDGE_URL)) {
    const headers = new Headers(init.headers)
    headers.set('Origin', 'https://amplodge.org')
    init = { ...init, headers }
  }
  return realFetch(url, init)
}) as typeof fetch
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) },
})

// ─── The bridge: the simulator, as its own process ───────────────────────────
const dll = process.env.LOCK_BRIDGE_SIM_DLL
const dotnet = process.env.DOTNET || 'dotnet'
if (!dll) { console.log('FAILURE: LOCK_BRIDGE_SIM_DLL is not set (run through tests/run.sh)'); process.exit(1) }
const already = await bridgeStatus().then(() => true, () => false)
if (already) { console.log(`FAILURE: something already listens on ${BRIDGE_URL}. Quit the lock bridge or simulator first.`); process.exit(1) }
const data = mkdtempSync(path.join(tmpdir(), 'lockbridge-e2e-'))
const sim = spawn(dotnet, [dll, '--port', '47123', '--server', `http://127.0.0.1:${port}`, '--data', data, '--delay-ms', '50'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
})
let simOutput = ''
sim.stdout.on('data', (d) => { simOutput += d })
sim.stderr.on('data', (d) => { simOutput += d })

const finish = () => {
  sim.kill()
  server.close()
  try { rmSync(data, { recursive: true, force: true }) } catch { /* left in tmp */ }
  console.log(failures ? `FAILURE: ${failures} failed` : 'ALL PASS lock bridge end to end: portal client → .NET bridge → server, pairing, signed cards, receipts')
  process.exit(failures ? 1 : 0)
}

try {
  const first = await until(() => bridgeStatus().catch(() => null), (s) => !!s, 30000)
  if (!first) throw new Error(`the simulator did not start:\n${simOutput}`)
  check('the bridge starts unpaired, with the simulated encoder ready', [first.paired, first.encoder.ready, first.encoder.name], [false, true, 'simulator'])

  // ── Pairing, as Settings → Door locks does it ──
  clientSession.token = 'tok-admin'
  const started = await (await callFunction('lock-encoder-pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', label: 'Front desk' }),
  })).json()
  check('an admin gets a one-time code', /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/.test(started.code), true)
  const pc = await pairThisPc(started.code)
  check('the bridge redeems it with the server and this browser is marked', [pc.label, getEncoderPc()?.encoderId], ['Front desk', started.encoderId])
  check('the server now holds the PC\'s token (hashed)', /^[0-9a-f]{64}$/.test(tables.lock_encoders[0].token_hash ?? ''), true)
  const again = await pairThisPc(started.code).then(() => null, (e) => e)
  check('a paired bridge refuses another pairing from a page', [again instanceof BridgeError, again?.status], [true, 409])
  const paired = await bridgeStatus()
  check('status shows it paired', [paired.paired, paired.label, paired.encoderId], [true, 'Front desk', started.encoderId])

  // ── Two cards, as the check-in dialog does it ──
  clientSession.token = 'tok-staff'
  const p = await prepareKeyCards(BOOKING, 2)
  check('the signed order names the room, guest and end (check-out day 11:00 + 1 h)',
    [p.room, p.guest, p.validUntil, p.cardNos], ['101', 'Ama Mensah', `${day(3)}T12:00:00.000Z`, [0, 1]])
  check('the server holds two pending cards', tables.key_cards.map((c) => c.status), ['pending', 'pending'])

  check('card 1 is written', (await writeKeyCard(p, 0)).outcome, 'issued')
  check('asking again returns the stored result', (await writeKeyCard(p, 0)).outcome, 'issued')
  const forged = { ...p, order: p.order.replace(`"validUntil":"${p.validUntil}"`, '"validUntil":"2027-01-01T12:00:00.000Z"') }
  check('a changed order is refused', (await writeKeyCard(forged, 1)).outcome, 'refused')
  check('a card that is not in the order is refused', (await writeKeyCard(p, 5)).outcome, 'refused')
  check('card 2 is written', (await writeKeyCard(p, 1)).outcome, 'issued')

  // ── The bridge reports on its own ──
  const reported = await until(() => tables.key_cards.map((c) => c.status), (s) => s.every((x) => x === 'issued'))
  check('both cards reach the server as issued', reported, ['issued', 'issued'])
  const enc = tables.lock_encoders[0]
  check('the server knows the bridge\'s version and that it is the simulator', [!!enc.last_seen_at, enc.bridge_version, enc.dll_version], [true, '0.1.2', 'simulator'])
  check('both are in the activity log', tables.activity_logs.filter((l) => l.action === 'key_card_issued').length, 2)
  const status = await until(() => bridgeStatus(), (s) => s.unsentResults === 0)
  check('nothing is left unsent', status.unsentResults, 0)

  // ── Read a card: the card on the encoder is Ama's second card ──
  const read = await readCard()
  check('the bridge reads a guest card: its door, end and DAI, nothing more',
    [read.kind, read.lockNo, new Date(read.validUntil!).toISOString(), read.dai, Object.keys(read).sort()],
    ['guest', '01030A', p.validUntil, tables.key_cards[0].dai, ['dai', 'kind', 'lockNo', 'message', 'staffType', 'validUntil']])
  const who = await identifyCard(read)
  check('the portal finds the room and the stay\'s two cards, made alike',
    [who.room?.roomNumber, who.expired, who.madeInJoney, who.records.map((c) => [c.guestName, c.cardNo, c.status]), who.newer],
    ['101', false, false, [['Ama Mensah', 0, 'issued'], ['Ama Mensah', 1, 'issued']], null])
  const fromJoney = await identifyCard({ ...read, dai: 0 })
  check('a card from Joney\'s program for the same door: the room, but no record', [fromJoney.room?.roomNumber, fromJoney.madeInJoney, fromJoney.records.length], ['101', true, 0])
  const stray = await identifyCard({ ...read, lockNo: '0a0b0c' })
  check('a door no room has: its code, to add on the Rooms page', [stray.room, stray.lockNo, stray.records.length], [null, '0A0B0C', 0])
  // A card made in Joney's program for a room whose code is not on record yet.
  const R102 = crypto.randomUUID(), R103 = crypto.randomUUID()
  tables.rooms.push({ id: R102, room_number: '102' }, { id: R103, room_number: '103' })
  const newDoor = { ...read, lockNo: '01030B', dai: 0 }
  const alone = await placeDoorCode((await identifyCard(newDoor)).lockNo)
  check('one room on record is no pattern: no room is suggested', [alone.suggested, alone.rooms.map((r) => r.roomNumber)], [null, ['101', '102', '103']])
  tables.room_locks.push({ id: crypto.randomUUID(), room_id: R103, lock_no: '01030C', label: null })
  const place = await placeDoorCode(newDoor.lockNo)
  check('two rooms that agree are (101 is …0A and 103 is …0C, so …0B is 102)', [place.suggested, place.basis], [R102, ['101', '103']])
  clientSession.token = 'tok-admin'
  await saveRoomLocks(R102, [{ lockNo: '01030B' }])
  clientSession.token = 'tok-staff'
  const placed = await identifyCard(newDoor)
  check('an admin adds it in one click, and the card now reads as room 102', [placed.room?.roomNumber, placed.madeInJoney, tables.room_locks.filter((l) => l.room_id === R102).map((l) => l.lock_no)], ['102', true, ['01030B']])
  const old = await identifyCard({ ...read, validUntil: new Date(Date.now() - 3600000).toISOString() })
  check('an expired card says so', [old.expired, old.records.length], [true, 0])
  check('the portal knows the card\'s stay as it is now', [who.stay?.status, who.stay?.checkOut, who.stay?.roomNumber], ['checked-in', day(3), '101'])

  // ── The stay is extended: Ama's cards still stop on the old day ──
  tables.bookings[0].check_out = day(5)
  const behind = await cardsOutOfStep(BOOKING)
  check('after an extension both cards are out of step', behind.map((c) => c.cardNo), [0, 1])
  const onEncoder = await identifyCard(await readCard())
  const target = onEncoder.records.find((c) => behind.some((b) => b.id === c.id))!
  const up = await prepareCardUpdate(BOOKING, target.id)
  check('the update order keeps the DAI, ends on the new check-out day, and takes the next card number',
    [JSON.parse(up.order).dai, up.validUntil, up.cardNos], [read.dai, `${day(5)}T12:00:00.000Z`, [2]])
  check('the bridge writes it over the guest card', (await writeKeyCard(up, 2)).outcome, 'issued')
  await markCard(target.id, 'erased', 'Written again')
  const after = await readCard()
  check('the card now reads with the new end and the same DAI', [new Date(after.validUntil!).toISOString(), after.dai], [`${day(5)}T12:00:00.000Z`, read.dai])
  await until(() => tables.key_cards.find((c) => c.order_nonce === up.nonce)?.status, (s) => s === 'issued')
  const nowCard = await identifyCard(after)
  check('...and is known as the stay\'s up-to-date card', [nowCard.records.map((c) => [c.cardNo, c.status]), nowCard.newer], [[[2, 'issued']], null])
  check('one card is left to update: the old record of the written card is closed', (await cardsOutOfStep(BOOKING)).map((c) => c.cardNo), [1])
  const twice = await prepareCardUpdate(BOOKING, nowCard.records[0].id).then(() => null, (e) => e)
  check('an up-to-date card is not updated again', [twice instanceof OrderRefused, twice?.upToDate], [true, true])

  // ── Check-out: the guest hands one card back ──
  tables.bookings[0].status = 'checked-out'
  check('two cards are out at check-out', (await cardsOut(BOOKING)).map((c) => c.cardNo), [1, 2])
  const handedIn = await identifyCard(await readCard())
  const back = handedIn.records.find((c) => c.bookingId === BOOKING)!
  await markCard(back.id, 'returned', 'Read back at check-out')
  check('the card read on the encoder is marked returned, and one is still out', (await cardsOut(BOOKING)).map((c) => c.cardNo), [1])

  // ── A browser that lost its mark ──
  forgetEncoderPc()
  const adopted = await adoptPairedBridge()
  check('it can adopt the bridge\'s pairing again', adopted.encoderId, started.encoderId)

  // ── A lock-out card: the guest checked out early ──
  tables.bookings[0].status = 'checked-out'
  const lo = await prepareLockoutCard(ROOM)
  check('a lock-out card order is a one-card order for the door, with no guest', [lo.room, lo.guest, lo.cardNos], ['101', null, [0]])
  check('the bridge takes the order (no booking, a purpose it does not need to know) and writes the card', (await writeKeyCard(lo, 0)).outcome, 'issued')
  const loRow = await until(() => tables.key_cards.find((c) => c.order_nonce === lo.nonce)?.status, (s) => s === 'issued')
  check('...and reports it issued', loRow, 'issued')
  check('the card still out is marked locked out (the others were written again, and returned)', tables.key_cards.filter((c) => c.booking_id === BOOKING).map((c) => c.status), ['erased', 'locked_out', 'returned'])
  const loRead = await identifyCard(await readCard())
  check('reading the lock-out card finds it', [loRead.room?.roomNumber, loRead.records.map((c) => [c.kind, c.status])], ['101', [['lockout', 'issued']]])
  const amaAgain = await identifyCard(read)
  check('Ama\'s card that was still out, read: locked out, and the lock-out card is the newer card for the door',
    [amaAgain.records.map((c) => c.status), amaAgain.newer?.orderNonce], [['locked_out'], lo.nonce])
  await markCard(amaAgain.records[0].id, 'returned')
  check('it is handed in and marked returned', (await identifyCard(read)).records.map((c) => c.status), ['returned'])

  // ── Unpairing ──
  clientSession.token = 'tok-admin'
  await callFunction('lock-encoder-pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', encoderId: started.encoderId }) })
  clientSession.token = 'tok-staff'
  const refused = await prepareKeyCards(BOOKING, 1).then(() => null, (e: Error) => e.message)
  check('a removed PC gets no more orders', /not paired/.test(refused ?? ''), true)
} catch (e) {
  failures++
  console.log(`FAIL  ${e instanceof Error ? e.stack : e}`)
} finally {
  finish()
}
