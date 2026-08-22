#!/usr/bin/env node
/**
 * Gives a staff row to every account that holds revenue without one.
 *
 * Revenue is attributed to whoever took the money, by the id stored on the
 * booking. That works whether or not the person has a row in the `staff` table
 * — but with no row there is no name to show, so their figures appear under a
 * raw id or a bare email on the HR and Analytics pages. As of 2026-08-22 five
 * accounts were in that state, between them holding GHS 23,795.
 *
 * For each one this script pulls the name the app already knows: the auth
 * account's metadata name, else the name stamped on their payment events, else
 * the booking's created_by_name, else the email's local part. It then proposes
 * a `staff` row with role `staff`.
 *
 * It will NOT merge anybody. Two accounts belonging to one person (a second
 * sign-up, say) are reported as suspected duplicates for you to judge — merging
 * would mean rewriting the staff id on historical bookings, which is not
 * something a script should decide.
 *
 * Dry-run by default; prints exactly what it would insert.
 *
 * Usage:
 *   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
 *     node scripts/reconcile-staff-accounts.mjs [--apply] [--role staff] \
 *       [--name <id-prefix>="Full Name" ...]
 */

const APPLY = process.argv.includes('--apply')
const roleArg = process.argv.indexOf('--role')
const ROLE = roleArg > -1 ? process.argv[roleArg + 1] : 'staff'

// --name <id-or-prefix>="Full Name", repeatable. The names the app stamped on
// bookings are whatever the account was set up with, which is often a fragment;
// this is how you write the real one.
const NAME_OVERRIDES = new Map()
process.argv.forEach((arg, i) => {
  if (arg !== '--name') return
  const pair = process.argv[i + 1] || ''
  const at = pair.indexOf('=')
  if (at > 0) NAME_OVERRIDES.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
})
const overrideFor = (id) => {
  for (const [key, value] of NAME_OVERRIDES) if (id === key || id.startsWith(key)) return value
  return ''
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}
if (!['staff', 'manager', 'admin', 'owner'].includes(ROLE)) {
  console.error(`--role must be staff, manager, admin or owner (got ${ROLE})`)
  process.exit(1)
}

const H = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

/** PostgREST caps a response at 1000 rows, so page through. */
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

function parseEvents(specialRequests) {
  const m = (specialRequests || '').match(/<!-- PAYMENT_EVENTS:(.*?) -->/)
  if (!m) return []
  try {
    const parsed = JSON.parse(m[1])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
const money = (n) => Number(n).toFixed(2)

/** A readable name from an email local part: "ohemaaboamah321" → "Ohemaaboamah". */
function nameFromEmail(email) {
  const local = (email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim()
  return local ? titleCase(local) : ''
}

async function main() {
  console.log(APPLY ? 'Running in APPLY mode — will create staff rows.' : 'Running in DRY-RUN mode — no writes. Pass --apply to create the rows.')
  console.log(`Role for new rows: ${ROLE}\n`)

  const [staffRows, bookings, charges, sales] = await Promise.all([
    all('/staff?select=id,user_id,name,email,role'),
    all('/bookings?select=id,status,total_price,created_at,created_by,created_by_name,check_in_by,check_in_by_name,check_out_by,check_out_by_name,special_requests'),
    all('/booking_charges?select=id,created_by,amount,created_at'),
    all('/standalone_sales?select=id,staff_id,staff_name,amount,sale_date'),
  ])
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=500`, { headers: H })
  const authJson = await authRes.json()
  const authUsers = Array.isArray(authJson?.users) ? authJson.users : Array.isArray(authJson) ? authJson : []

  const knownIds = new Set(staffRows.flatMap((s) => [s.id, s.user_id].filter(Boolean)))
  const authById = new Map(authUsers.map((u) => [u.id, u]))

  // Everyone who has taken money, and what we know them by.
  const seen = new Map() // id → { names:Set, bookings:number, revenue:number, first:string, last:string }
  const note = (id, name, amount, when) => {
    if (!id || knownIds.has(id)) return
    if (!seen.has(id)) seen.set(id, { names: new Set(), bookings: 0, revenue: 0, first: '', last: '' })
    const e = seen.get(id)
    if (name && name.trim() && !name.includes('@')) e.names.add(name.trim())
    if (amount) { e.bookings++; e.revenue += Number(amount) || 0 }
    const day = (when || '').slice(0, 10)
    if (day) {
      if (!e.first || day < e.first) e.first = day
      if (!e.last || day > e.last) e.last = day
    }
  }

  for (const b of bookings) {
    if (b.status === 'cancelled') continue
    const worth = Number(b.total_price || 0)
    note(b.created_by, b.created_by_name, worth, b.created_at)
    note(b.check_in_by, b.check_in_by_name, 0, b.created_at)
    note(b.check_out_by, b.check_out_by_name, 0, b.created_at)
    for (const e of parseEvents(b.special_requests)) note(e.staffId, e.staffName, 0, e.paidAt)
  }
  for (const c of charges) note(c.created_by, '', Number(c.amount || 0), c.created_at)
  for (const s of sales) note(s.staff_id, s.staff_name, Number(s.amount || 0), s.sale_date)

  // Ids that are not real accounts (a literal "Staff"/"system" fallback) are noise.
  const candidates = [...seen.entries()]
    .filter(([id]) => /^[0-9a-f-]{36}$/i.test(id))
    .sort((a, b) => b[1].revenue - a[1].revenue)

  if (candidates.length === 0) {
    console.log('Every account that holds revenue already has a staff row. Nothing to do.')
    return
  }

  const results = { created: 0, skipped: 0, errors: 0 }
  const duplicates = []

  for (const [id, info] of candidates) {
    const user = authById.get(id)
    const email = user?.email || ''
    const metaName = user?.user_metadata?.full_name || user?.user_metadata?.name || ''
    // Longest stamped name wins — "Boamah Priscilla" over "Boamah".
    let stampedName = [...info.names].sort((a, b) => b.length - a.length)[0] || ''
    const emailName = nameFromEmail(email)
    // A stamped name that is just the start of the email address is a fragment,
    // not a name: "let" for leticiaagyemang12@ is the account's display name
    // never having been filled in. Prefer what the address itself says.
    const local = (email || '').split('@')[0].toLowerCase()
    if (stampedName && local.startsWith(stampedName.toLowerCase()) && stampedName.length < local.length) {
      stampedName = ''
    }
    const override = overrideFor(id)
    const name = (override || metaName || stampedName || emailName || `Staff ${id.slice(0, 8)}`).trim()
    const source = override ? ' (you supplied it)'
      : metaName ? ' (from the account)'
      : stampedName ? ' (from their bookings)'
      : emailName ? ' (guessed from the email — pass --name to correct it)'
      : ''

    console.log(`${id}`)
    console.log(`   name     : ${name}${source}`)
    console.log(`   email    : ${email || '— no auth account found —'}`)
    console.log(`   activity : ${info.bookings} bookings/charges worth GHS ${money(info.revenue)}${info.first ? `, ${info.first} → ${info.last}` : ''}`)

    // Flag anyone who looks like an existing staff member under a second account.
    const firstName = name.split(/\s+/)[0].toLowerCase()
    const near = staffRows.filter((s) => {
      const n = (s.name || '').toLowerCase()
      return firstName.length > 2 && n.includes(firstName)
    })
    if (near.length) {
      duplicates.push({ id, name, email, matches: near.map((s) => `${s.name} <${s.email}>`) })
      console.log(`   ⚠ similar to existing staff: ${near.map((s) => `${s.name} <${s.email}>`).join(', ')}`)
      console.log(`     Not merged — check whether this is the same person before acting.`)
    }

    if (!email) {
      console.log('   SKIP — no auth account behind this id, so there is nobody to name.\n')
      results.skipped++
      continue
    }

    console.log(`   -> staff row: { name: "${name}", email: "${email}", role: "${ROLE}", user_id: "${id}" }`)
    if (APPLY) {
      try {
        await rest('/staff', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: id, name, email, role: ROLE }),
        })
        console.log('   CREATED')
        results.created++
      } catch (err) {
        console.error(`   ERROR — ${err.message}`)
        results.errors++
      }
    } else {
      results.created++
    }
    console.log('')
  }

  console.log('--- Summary ---')
  console.log(`Staff rows ${APPLY ? 'created' : 'to create'}: ${results.created}`)
  console.log(`Skipped (no auth account)  : ${results.skipped}`)
  console.log(`Errors                     : ${results.errors}`)
  if (duplicates.length) {
    console.log(`\nPossible duplicates of existing staff — decide these yourself:`)
    for (const d of duplicates) console.log(`  ${d.name} <${d.email}>  resembles  ${d.matches.join(', ')}`)
    console.log('\nIf one of these IS an existing staff member under a second account, do not')
    console.log('create the row: their old bookings would still point at the other id. Revenue')
    console.log('follows the id on the booking, so two ids means two sets of figures.')
  }
  if (!APPLY) {
    console.log('\nTo correct a name before creating the rows:')
    console.log('  node scripts/reconcile-staff-accounts.mjs --name d0917dac="Blessing Asare" --name 1e1455e9="Leticia Agyemang"')
  }
  console.log('\nRevenue attribution does not change either way — this only gives the figures a name.')
}

main()
