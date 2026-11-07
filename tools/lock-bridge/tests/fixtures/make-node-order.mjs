/* global URL, console */
// Makes node-order.json: an order signed exactly the way netlify/functions/key-card-order.js
// signs one, with a throwaway key (the private half is never written). The .NET tests check
// that the bridge accepts the server's bytes, signature and key encoding as they are.
//   node tools/lock-bridge/tests/fixtures/make-node-order.mjs
import crypto from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ORDER_VERSION, cardTime, publicKeyBase64, signOrder, verifyOrder } from '../../../../netlify/functions/_lib/key-cards.js'

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const encoderId = '7d1f4c2a-9b3e-4d5f-8a6b-0c1d2e3f4a5b'
const begin = new Date(Date.UTC(2026, 10, 7, 13, 0))
const end = new Date(Date.UTC(2026, 10, 9, 12, 0))
const order = JSON.stringify({
  v: ORDER_VERSION,
  kind: 'guest-cards',
  challenge: `${encoderId}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
  nonce: crypto.randomBytes(18).toString('base64url'),
  encoderId,
  bookingId: '0b8e6f1a-2c3d-4e5f-9a0b-1c2d3e4f5a6b',
  guest: 'Test Guest — Ama',
  room: '110',
  begin: cardTime(begin),
  end: cardTime(end),
  validUntil: end.toISOString(),
  dai: 3,
  cards: [{ cardNo: 0, lockNos: ['010309', '01030A'] }, { cardNo: 1, lockNos: ['010309', '01030A'] }],
})
const publicKey = publicKeyBase64(privateKey)
const signature = signOrder(order, privateKey)
if (!verifyOrder(order, signature, publicKey)) throw new Error('node could not verify its own order')
const out = fileURLToPath(new URL('./node-order.json', import.meta.url))
writeFileSync(out, JSON.stringify({ publicKey, order, signature, now: new Date(Date.UTC(2026, 10, 7, 13, 2)).toISOString() }, null, 2) + '\n')
console.log('wrote', out)
