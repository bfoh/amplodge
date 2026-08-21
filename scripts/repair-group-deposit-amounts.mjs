#!/usr/bin/env node
/**
 * Repairs PAYMENT_DATA.amountPaid on group-booking member rows.
 *
 * OnsiteBookingPage wrote the WHOLE group's payment onto every room in the
 * group (fixed 2026-08-21), so a 6-room group that paid a GHS 2,200 deposit
 * stored "amountPaid: 2200" six times. Every consumer that reads a member's
 * amountPaid — check-in balance, invoices, reservations, revenue reports —
 * therefore saw the deposit once per room.
 *
 * PAYMENT_EVENTS on the same rows already hold the correct per-room share, so
 * this script rewrites each member's PAYMENT_DATA.amountPaid to:
 *   · the sum of that booking's own booking-stage PAYMENT_EVENTS, when present
 *   · otherwise its proportional share of the group-wide figure, by room price
 *
 * Single-room groups are left alone (nothing to prorate) and a member whose
 * stored value already matches the target is skipped. Dry-run by default —
 * prints what it WOULD change and does not touch the database until --apply.
 *
 * Usage:
 *   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
 *     node scripts/repair-group-deposit-amounts.mjs [--apply]
 */

const APPLY = process.argv.includes('--apply')

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const H = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

async function rest(path, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers: { ...H, ...(init?.headers || {}) } })
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status}: ${await res.text()}`)
  return res
}

function parseComment(specialRequests, tag) {
  const m = (specialRequests || '').match(new RegExp(`<!-- ${tag}:(.*?) -->`))
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

/** Sum of the booking-stage payment events recorded on this one booking. */
function ownBookingStageTotal(specialRequests) {
  const events = parseComment(specialRequests, 'PAYMENT_EVENTS')
  if (!Array.isArray(events)) return null
  const total = events
    .filter((e) => e?.stage === 'booking')
    .reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return total > 0 ? Math.round(total * 100) / 100 : null
}

function writeAmountPaid(specialRequests, paymentData, amountPaid) {
  const updated = { ...paymentData, amountPaid }
  return specialRequests.replace(
    /<!-- PAYMENT_DATA:.*? -->/,
    `<!-- PAYMENT_DATA:${JSON.stringify(updated)} -->`
  )
}

async function main() {
  console.log(APPLY ? 'Running in APPLY mode — will write changes.' : 'Running in DRY-RUN mode — no writes. Pass --apply to write.')

  const res = await rest(
    `/bookings?special_requests=like.*GROUP_DATA*&select=id,total_price,status,special_requests,created_at&order=created_at.asc`
  )
  const rows = await res.json()
  console.log(`Found ${rows.length} booking(s) carrying GROUP_DATA.\n`)

  // Bucket members by group
  const groups = new Map()
  for (const b of rows) {
    const gd = parseComment(b.special_requests, 'GROUP_DATA')
    const gid = gd?.groupId
    if (!gid) continue
    if (!groups.has(gid)) groups.set(gid, { reference: gd.groupReference || gid, members: [] })
    groups.get(gid).members.push(b)
  }

  const results = { groups: 0, repaired: 0, alreadyCorrect: 0, singleRoom: 0, noPaymentData: 0, errors: 0 }

  for (const [gid, group] of groups.entries()) {
    if (group.members.length < 2) {
      results.singleRoom++
      continue
    }
    results.groups++

    const subtotal = group.members.reduce((s, m) => s + (Number(m.total_price) || 0), 0)
    // The group-wide figure was stamped identically on every member, so the
    // largest stored value is the amount the guest actually handed over.
    const groupPaid = group.members.reduce((max, m) => {
      const pd = parseComment(m.special_requests, 'PAYMENT_DATA')
      return Math.max(max, Number(pd?.amountPaid) || 0)
    }, 0)

    console.log(`\nGroup ${group.reference} (${gid}) — ${group.members.length} rooms, room total ${subtotal.toFixed(2)}, recorded payment ${groupPaid.toFixed(2)}`)

    for (const m of group.members) {
      try {
        const pd = parseComment(m.special_requests, 'PAYMENT_DATA')
        if (!pd) {
          results.noPaymentData++
          continue
        }
        const stored = Number(pd.amountPaid) || 0

        const own = ownBookingStageTotal(m.special_requests)
        const target = own != null
          ? own
          : subtotal > 0
            ? Math.round(((Number(m.total_price) || 0) / subtotal) * groupPaid * 100) / 100
            : stored

        if (Math.abs(target - stored) < 0.01) {
          console.log(`  OK    ${m.id.slice(0, 8)}…  amountPaid ${stored.toFixed(2)} already correct`)
          results.alreadyCorrect++
          continue
        }

        console.log(`  FIX   ${m.id.slice(0, 8)}…  room ${Number(m.total_price).toFixed(2)}  amountPaid ${stored.toFixed(2)} -> ${target.toFixed(2)}  (${own != null ? 'own payment events' : 'prorated'})`)
        if (APPLY) {
          await rest(`/bookings?id=eq.${m.id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ special_requests: writeAmountPaid(m.special_requests, pd, target) }),
          })
        }
        results.repaired++
      } catch (err) {
        console.error(`  ERROR ${m.id} — ${err.message}`)
        results.errors++
      }
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Multi-room groups inspected:            ${results.groups}`)
  console.log(`Members repaired${APPLY ? ':                        ' : ' (would repair):          '}${results.repaired}`)
  console.log(`Members already correct:                ${results.alreadyCorrect}`)
  console.log(`Single-room groups skipped:             ${results.singleRoom}`)
  console.log(`Members without PAYMENT_DATA:           ${results.noPaymentData}`)
  console.log(`Errors:                                 ${results.errors}`)
}

main()
