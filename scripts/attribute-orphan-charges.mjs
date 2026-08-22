#!/usr/bin/env node
/**
 * Proposes a staff member for booking charges that record none.
 *
 * The guest folio dialog never stamped who added a charge (fixed 2026-08-22),
 * so those rows carry created_by = null. They show as "Unassigned" and are
 * counted in the hotel's total but against nobody in particular.
 *
 * There is no record of who actually added them — charges are not written to
 * the activity log — so this cannot be resolved from evidence. What it can do
 * is infer: a charge on a booking was almost certainly added by whoever was
 * serving that guest, which is the staff member who checked them in, else who
 * created the booking, else who checked them out.
 *
 * That is a judgement, not a fact, which is why it is inference and why the
 * script prints what it would do and stops. Read the proposal, decide whether
 * the inference holds for your hotel, and only then pass --apply. Charges whose
 * booking names nobody either are left alone.
 *
 * Usage:
 *   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
 *     node scripts/attribute-orphan-charges.mjs [--apply] [--since 2026-01-01]
 */

const APPLY = process.argv.includes('--apply')
const sinceArg = process.argv.indexOf('--since')
const SINCE = sinceArg > -1 ? process.argv[sinceArg + 1] : ''

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
async function all(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const res = await rest(path, { headers: { Range: `${from}-${from + 999}` } })
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

const money = (n) => Number(n).toFixed(2)

async function main() {
  console.log(APPLY ? 'Running in APPLY mode — will write created_by onto these charges.' : 'Running in DRY-RUN mode — no writes. Read the proposal before passing --apply.')
  if (SINCE) console.log(`Only charges created on or after ${SINCE}.`)
  console.log('')

  const [charges, bookings, staffRows] = await Promise.all([
    all('/booking_charges?select=id,booking_id,description,amount,created_by,created_at&order=created_at.desc'),
    all('/bookings?select=id,check_in_by,check_in_by_name,created_by,created_by_name,check_out_by,check_out_by_name'),
    all('/staff?select=id,user_id,name'),
  ])

  const nameOf = new Map()
  for (const s of staffRows) {
    if (s.user_id) nameOf.set(s.user_id, s.name)
    if (s.id) nameOf.set(s.id, s.name)
  }
  const bookingById = new Map(bookings.map((b) => [b.id, b]))

  const orphans = charges.filter((c) => !c.created_by && (!SINCE || (c.created_at || '') >= SINCE))
  if (orphans.length === 0) {
    console.log('Every charge already records who added it. Nothing to do.')
    return
  }

  const results = { proposed: 0, unresolved: 0, applied: 0, errors: 0 }
  const perStaff = new Map()
  let unresolvedTotal = 0

  for (const c of orphans) {
    const b = bookingById.get(c.booking_id)
    const candidate = b?.check_in_by || b?.created_by || b?.check_out_by || ''
    const via = b?.check_in_by ? 'checked the guest in'
      : b?.created_by ? 'took the booking'
      : b?.check_out_by ? 'checked the guest out'
      : ''
    const name = nameOf.get(candidate) || b?.check_in_by_name || b?.created_by_name || b?.check_out_by_name || candidate.slice(0, 8)

    if (!candidate) {
      console.log(`  LEAVE  ${(c.created_at || '').slice(0, 10)}  ${money(c.amount).padStart(9)}  ${c.description} — its booking names nobody either`)
      results.unresolved++
      unresolvedTotal += Number(c.amount) || 0
      continue
    }

    console.log(`  ${APPLY ? 'SET   ' : 'WOULD '} ${(c.created_at || '').slice(0, 10)}  ${money(c.amount).padStart(9)}  ${String(c.description).slice(0, 28).padEnd(30)} -> ${name} (${via})`)
    perStaff.set(name, (perStaff.get(name) || 0) + (Number(c.amount) || 0))
    results.proposed++

    if (APPLY) {
      try {
        await rest(`/booking_charges?id=eq.${c.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ created_by: candidate }),
        })
        results.applied++
      } catch (err) {
        console.error(`         ERROR — ${err.message}`)
        results.errors++
      }
    }
  }

  console.log('\n--- Where the money would move ---')
  for (const [name, amount] of [...perStaff].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(24)} +GHS ${money(amount)}`)
  }
  if (unresolvedTotal > 0) console.log(`  ${'(stays unassigned)'.padEnd(24)}  GHS ${money(unresolvedTotal)}`)

  console.log('\n--- Summary ---')
  console.log(`Charges with no staff recorded : ${orphans.length}`)
  console.log(`${APPLY ? 'Attributed' : 'Would attribute'}                : ${results.proposed}`)
  console.log(`Left alone (booking names nobody): ${results.unresolved}`)
  if (APPLY) console.log(`Errors                          : ${results.errors}`)

  console.log('\nThis is an inference, not a record: nothing captured who actually added')
  console.log('these charges. It moves money onto real people\'s revenue figures, so only')
  console.log('apply it if "whoever was serving that guest" is how your hotel works.')
}

main()
