#!/usr/bin/env node
/**
 * Removes the duplicate room types.
 *
 * The staff Rooms page used to re-create any of five default room types it
 * could not find, on every load, and each insert's realtime echo re-ran the
 * check (fixed in eb15e6d). room_types grew to 70 rows for five names. Per
 * name, one row has the rooms and the price the website charges; the rest
 * are seeded copies at the old prices (100/250/150/200/500) that nothing uses.
 *
 * The row kept per name is the one the website and the staff pages use: the
 * most rooms linked (properties.property_type_id), then the oldest, then the
 * lowest id (src/lib/room-types.ts, netlify/functions/_lib/room-catalog.js).
 * A row is deleted only if nothing points at it: no room (properties), no
 * mirror row (rooms.room_type_id, a foreign key) and no channel-manager
 * mapping (channel_room_mappings.local_room_type_id). If any copy is still
 * referenced the script stops without deleting anything.
 *
 * Every row is written to scratch/room-types-backup-<time>.json first, so the
 * deletion can be undone by re-inserting them. Dry-run by default; nothing is
 * changed until you pass --apply.
 *
 * Usage:
 *   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
 *     node scripts/remove-duplicate-room-types.mjs [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APPLY = process.argv.includes('--apply')
const SUPABASE_URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const [types, properties, mirrors, mappings] = await Promise.all([
  rest('room_types?select=*&order=created_at.asc'),
  rest('properties?select=id,room_number,property_type_id'),
  rest('rooms?select=id,room_number,room_type_id'),
  rest('channel_room_mappings?select=id,local_room_type_id'),
])

const linked = new Map()
for (const p of properties) if (p.property_type_id) linked.set(p.property_type_id, (linked.get(p.property_type_id) ?? 0) + 1)

const groups = new Map()
for (const t of types) {
  const key = norm(t.name)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(t)
}

const keep = []
const remove = []
for (const rows of groups.values()) {
  rows.sort(
    (a, b) =>
      (linked.get(b.id) ?? 0) - (linked.get(a.id) ?? 0) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
      String(a.id).localeCompare(String(b.id)),
  )
  keep.push(rows[0])
  remove.push(...rows.slice(1))
}

console.log(`room_types: ${types.length} rows, ${groups.size} names. Keeping ${keep.length}, removing ${remove.length}.\n`)
for (const t of keep) {
  const copies = remove.filter((r) => norm(r.name) === norm(t.name))
  console.log(`  keep   ${t.id}  ${t.name.padEnd(20)} GHS ${t.base_price}  ${linked.get(t.id) ?? 0} rooms  (${copies.length} copies to remove)`)
}

const removeIds = new Set(remove.map((t) => t.id))
const blockers = [
  ...properties.filter((p) => removeIds.has(p.property_type_id)).map((p) => `room ${p.room_number} (properties ${p.id})`),
  ...mirrors.filter((r) => removeIds.has(r.room_type_id)).map((r) => `rooms mirror ${r.room_number} (${r.id})`),
  ...mappings.filter((m) => removeIds.has(m.local_room_type_id)).map((m) => `channel mapping ${m.id}`),
]
if (blockers.length) {
  console.error(`\nSTOP: ${blockers.length} reference(s) to a copy. Re-save those rooms on the Rooms page (or remap the channel) first:`)
  blockers.forEach((b) => console.error('  ' + b))
  process.exit(1)
}
console.log(`\nNo room, mirror row or channel mapping points at any of the ${remove.length} copies.`)

if (!APPLY) {
  console.log('\nDry run. Pass --apply to back up and delete.')
  process.exit(0)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'scratch'), { recursive: true })
const backup = join(root, 'scratch', `room-types-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(backup, JSON.stringify({ takenAt: new Date().toISOString(), all: types, removed: remove }, null, 2))
console.log(`\nBacked up all ${types.length} rows to ${backup}`)

for (let i = 0; i < remove.length; i += 50) {
  const ids = remove.slice(i, i + 50).map((t) => t.id)
  await rest(`room_types?id=in.(${ids.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
}

const after = await rest('room_types?select=id,name,base_price')
const names = new Map()
for (const t of after) names.set(norm(t.name), (names.get(norm(t.name)) ?? 0) + 1)
const keptAll = keep.every((t) => after.some((a) => a.id === t.id))
console.log(`Deleted. room_types now has ${after.length} rows; one per name: ${[...names.values()].every((n) => n === 1)}; every kept row still there: ${keptAll}`)
