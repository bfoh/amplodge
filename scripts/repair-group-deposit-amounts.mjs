#!/usr/bin/env node
/**
 * Repairs PAYMENT_DATA.amountPaid on group-booking member rows.
 *
 * OnsiteBookingPage wrote the WHOLE payment onto every room booked in one
 * sitting (fixed 2026-08-21), so a 5-room batch that paid a GHS 1,000 deposit
 * stored "amountPaid: 1000" five times. Every consumer reading a member's
 * amountPaid — check-in balance, invoices, reservations — therefore saw the
 * payment once per room.
 *
 * The unit of duplication is the BATCH (the rooms booked together), not the
 * group: rooms added to the same group days later were a separate payment and
 * must not be pooled with it. A batch here is member rows of one group sharing
 * one stored amount, created within 30 minutes of each other. An amount that
 * appears on only one room is already that room's own figure and is left alone.
 *
 * Per room, the repaired figure is:
 *   · the sum of that booking's own booking-stage PAYMENT_EVENTS, when present
 *     (a real per-room share — no reconstruction needed)
 *   · otherwise its share of the batch payment, by room price, with the
 *     rounding residual given to the largest room so the batch total is exact
 *
 * Rows carrying no PAYMENT_DATA are never given one — this script only
 * corrects figures that are already recorded. Dry-run by default; prints every
 * change and a per-batch check that no money is created or destroyed, and does
 * not touch the database until you pass --apply.
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

/** Rooms booked in one sitting land within seconds of each other. */
const BATCH_GAP_MS = 30 * 60 * 1000

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
  const staged = events.filter((e) => e?.stage === 'booking')
  if (!staged.length) return null
  return Math.round(staged.reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100
}

function writeAmountPaid(specialRequests, paymentData, amountPaid) {
  const updated = { ...paymentData, amountPaid }
  return specialRequests.replace(
    /<!-- PAYMENT_DATA:.*? -->/,
    `<!-- PAYMENT_DATA:${JSON.stringify(updated)} -->`
  )
}

const money = (n) => Number(n).toFixed(2)
const at = (b) => new Date(b.created_at || 0).getTime() || 0

/**
 * Split the batch's rows into sittings, then hand each row its share.
 * Returns bookingId → share. Sittings of one row are omitted.
 */
function shareByBatch(rows, amount) {
  const shares = new Map()
  const sorted = [...rows].sort((a, b) => at(a) - at(b))

  let sitting = []
  const flush = () => {
    if (sitting.length > 1) {
      const subtotal = sitting.reduce((s, r) => s + (Number(r.total_price) || 0), 0)
      if (subtotal > 0) {
        let assigned = 0
        for (const r of sitting) {
          const share = Math.round(((Number(r.total_price) || 0) / subtotal) * amount * 100) / 100
          shares.set(r.id, share)
          assigned += share
        }
        // Rounding residual goes to the largest room so the batch total is exact.
        const residual = Math.round((amount - assigned) * 100) / 100
        if (residual !== 0) {
          const biggest = sitting.reduce((a, b) => (Number(b.total_price) > Number(a.total_price) ? b : a))
          shares.set(biggest.id, Math.round((shares.get(biggest.id) + residual) * 100) / 100)
        }
      }
    }
    sitting = []
  }
  for (const row of sorted) {
    const prev = sitting[sitting.length - 1]
    if (prev && at(row) - at(prev) > BATCH_GAP_MS) flush()
    sitting.push(row)
  }
  flush()
  return shares
}

async function main() {
  console.log(APPLY ? 'Running in APPLY mode — will write changes.' : 'Running in DRY-RUN mode — no writes. Pass --apply to write.')

  const res = await rest(
    `/bookings?special_requests=like.*GROUP_DATA*&select=id,total_price,status,special_requests,created_at&order=created_at.asc`
  )
  const rows = await res.json()
  console.log(`Found ${rows.length} booking(s) carrying GROUP_DATA.\n`)

  const groups = new Map()
  for (const b of rows) {
    const gd = parseComment(b.special_requests, 'GROUP_DATA')
    if (!gd?.groupId) continue
    if (!groups.has(gd.groupId)) groups.set(gd.groupId, { reference: gd.groupReference || gd.groupId, members: [] })
    groups.get(gd.groupId).members.push(b)
  }

  const results = { groups: 0, repaired: 0, alreadyCorrect: 0, singleRoom: 0, noPaymentData: 0, lone: 0, errors: 0, mismatches: 0 }

  for (const [gid, group] of groups.entries()) {
    if (group.members.length < 2) {
      results.singleRoom++
      continue
    }
    results.groups++

    // Rows with their own payment events need no reconstruction.
    const eventRows = group.members.filter((m) => ownBookingStageTotal(m.special_requests) != null)
    const plainRows = group.members.filter((m) => ownBookingStageTotal(m.special_requests) == null)

    // Bucket the remaining rows by the amount stamped on them, then by sitting.
    const byAmount = new Map()
    for (const m of plainRows) {
      const pd = parseComment(m.special_requests, 'PAYMENT_DATA')
      const amount = Number(pd?.amountPaid) || 0
      if (!pd || amount <= 0) continue
      if (!byAmount.has(amount)) byAmount.set(amount, [])
      byAmount.get(amount).push(m)
    }

    const targets = new Map()
    for (const m of eventRows) targets.set(m.id, ownBookingStageTotal(m.special_requests))
    const batchChecks = []
    for (const [amount, members] of byAmount.entries()) {
      const shares = shareByBatch(members, amount)
      if (!shares.size) {
        results.lone += members.length
        continue
      }
      let sum = 0
      for (const [id, share] of shares.entries()) {
        targets.set(id, share)
        sum += share
      }
      batchChecks.push({ amount, count: shares.size, sum: Math.round(sum * 100) / 100 })
    }

    const changes = group.members.filter((m) => {
      const pd = parseComment(m.special_requests, 'PAYMENT_DATA')
      if (!pd || !targets.has(m.id)) return false
      return Math.abs(targets.get(m.id) - (Number(pd.amountPaid) || 0)) >= 0.01
    })

    if (!changes.length && !batchChecks.length) continue

    console.log(`\nGroup ${group.reference} (${gid}) — ${group.members.length} rooms`)
    for (const c of batchChecks) {
      const ok = Math.abs(c.sum - c.amount) < 0.01
      if (!ok) results.mismatches++
      console.log(`  batch of ${c.count} rooms recorded ${money(c.amount)} → shares total ${money(c.sum)}  ${ok ? 'balanced' : '*** MISMATCH ***'}`)
    }

    for (const m of group.members) {
      try {
        const pd = parseComment(m.special_requests, 'PAYMENT_DATA')
        if (!pd) {
          results.noPaymentData++
          continue
        }
        const stored = Number(pd.amountPaid) || 0
        if (!targets.has(m.id)) continue
        const target = targets.get(m.id)
        const source = ownBookingStageTotal(m.special_requests) != null ? 'own payment events' : 'batch share'

        if (Math.abs(target - stored) < 0.01) {
          results.alreadyCorrect++
          continue
        }

        console.log(`  FIX   ${m.id.slice(0, 8)}…  room ${money(m.total_price).padStart(9)}  amountPaid ${money(stored).padStart(9)} -> ${money(target).padStart(9)}  (${source})`)
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
  console.log(`Rows stamped only once (left alone):    ${results.lone}`)
  console.log(`Single-room groups skipped:             ${results.singleRoom}`)
  console.log(`Members without PAYMENT_DATA:           ${results.noPaymentData}`)
  console.log(`Batch totals that did NOT balance:      ${results.mismatches}`)
  console.log(`Errors:                                 ${results.errors}`)

  if (results.mismatches > 0) {
    console.error('\nRefusing to call this clean — some batch totals did not balance. Do not apply.')
    process.exitCode = 1
  }
}

main()
