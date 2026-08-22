#!/usr/bin/env node
/**
 * Works out who recorded a booking charge that saved no staff id.
 *
 * The guest folio dialog never stamped the staff member (fixed 2026-08-22), so
 * those rows carry created_by = null. A person did record every one of them —
 * the question is only which person, and charges are not written to the
 * activity log, so it has to be established from what the log does hold.
 *
 * The evidence is presence: what someone was doing in the app at the moment
 * the charge was saved. The activity log stamps a user id and a timestamp on
 * logins, check-ins, bookings and room changes, so the staff member acting
 * within a couple of minutes of a charge is who was at the terminal.
 *
 * Strength of the match decides whether it is used:
 *
 *   strong   one staff member acting within 10 minutes, nobody else close.
 *            Presence at the terminal — this is the primary signal.
 *   supported nearest within an hour AND the same person who checked that
 *            guest in. Two independent signals agreeing.
 *   weak     nearest within an hour but contradicted by the booking, or two
 *            staff equally close. Reported, not applied, unless --include-weak.
 *   none     nobody acting near it. Falls back to whoever checked the guest in;
 *            left alone if the booking names nobody either.
 *
 * Dry-run by default.
 *
 * Usage:
 *   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
 *     node scripts/attribute-orphan-charges.mjs [--apply] [--since 2026-01-01] [--include-weak]
 */

const APPLY = process.argv.includes('--apply')
const INCLUDE_WEAK = process.argv.includes('--include-weak')
const sinceArg = process.argv.indexOf('--since')
const SINCE = sinceArg > -1 ? process.argv[sinceArg + 1] : ''

const STRONG_WINDOW_MS = 10 * 60 * 1000
const SUPPORTING_WINDOW_MS = 60 * 60 * 1000

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
const mins = (ms) => `${Math.round(ms / 60000)}m`

async function main() {
  console.log(APPLY ? 'Running in APPLY mode — will write created_by onto these charges.' : 'Running in DRY-RUN mode — no writes.')
  if (SINCE) console.log(`Only charges created on or after ${SINCE}.`)
  console.log(INCLUDE_WEAK ? 'Weak matches WILL be applied (--include-weak).' : 'Weak matches are reported but not applied.')
  console.log('')

  const [charges, bookings, staffRows, logs] = await Promise.all([
    all('/booking_charges?select=id,booking_id,description,amount,created_by,created_at&order=created_at.desc'),
    all('/bookings?select=id,check_in_by,check_in_by_name,created_by,created_by_name,check_out_by,check_out_by_name'),
    all('/staff?select=id,user_id,name'),
    all('/activity_logs?select=user_id,action,entity_type,created_at&order=created_at.desc'),
  ])

  const nameOf = new Map()
  // booking_charges.created_by is a foreign key to staff.id, so an auth user id
  // (which is what the activity log and the booking columns hold) has to be
  // translated to the staff row before it can be written.
  const staffRowIdFor = new Map()
  for (const s of staffRows) {
    if (s.user_id) { nameOf.set(s.user_id, s.name); staffRowIdFor.set(s.user_id, s.id) }
    if (s.id) { nameOf.set(s.id, s.name); staffRowIdFor.set(s.id, s.id) }
  }
  const displayName = (id, fallback = '') => nameOf.get(id) || fallback || (id ? `${id.slice(0, 8)}…` : '')
  const bookingById = new Map(bookings.map((b) => [b.id, b]))

  // Activity by real people, newest first, as (time, user) pairs.
  const activity = logs
    .filter((l) => l.user_id && l.user_id !== 'system' && l.user_id !== 'unknown')
    .map((l) => ({ at: new Date(l.created_at).getTime(), user: l.user_id, what: `${l.entity_type}/${l.action}` }))
    .filter((l) => !isNaN(l.at))
    .sort((a, b) => a.at - b.at)

  /** Who was in the app around this moment, nearest first. */
  function whoWasAround(when) {
    const t = new Date(when).getTime()
    if (isNaN(t)) return []
    const nearest = new Map() // user → closest gap
    for (const a of activity) {
      const gap = Math.abs(a.at - t)
      if (gap > SUPPORTING_WINDOW_MS) continue
      if (!nearest.has(a.user) || gap < nearest.get(a.user).gap) nearest.set(a.user, { gap, what: a.what })
    }
    return [...nearest.entries()]
      .map(([user, v]) => ({ user, ...v }))
      .sort((a, b) => a.gap - b.gap)
  }

  const orphans = charges.filter((c) => !c.created_by && (!SINCE || (c.created_at || '') >= SINCE))
  if (orphans.length === 0) {
    console.log('Every charge already records who added it. Nothing to do.')
    return
  }

  const decisions = []
  for (const c of orphans) {
    const around = whoWasAround(c.created_at)
    const b = bookingById.get(c.booking_id)
    const bookingStaff = b?.check_in_by || b?.created_by || b?.check_out_by || ''
    const nearest = around[0]
    const runnerUp = around[1]

    let staffId = '', strength = 'none', why = ''
    if (nearest && nearest.gap <= STRONG_WINDOW_MS && (!runnerUp || runnerUp.gap > STRONG_WINDOW_MS)) {
      staffId = nearest.user
      strength = 'strong'
      why = `in the app ${mins(nearest.gap)} away (${nearest.what})`
    } else if (nearest && nearest.user === bookingStaff) {
      staffId = nearest.user
      strength = 'supported'
      why = `${mins(nearest.gap)} away and checked this guest in`
    } else if (nearest) {
      staffId = nearest.user
      strength = 'weak'
      why = runnerUp && runnerUp.gap <= STRONG_WINDOW_MS
        ? `${mins(nearest.gap)} away, but ${displayName(runnerUp.user)} was ${mins(runnerUp.gap)} away too`
        : `${mins(nearest.gap)} away, but ${displayName(bookingStaff) || 'nobody'} handled the booking`
    } else if (bookingStaff) {
      staffId = bookingStaff
      strength = 'none'
      why = 'nobody was in the app near it — falling back to who checked the guest in'
    }
    decisions.push({ charge: c, staffId, strength, why })
  }

  const willApply = (d) => d.staffId && (d.strength !== 'weak' || INCLUDE_WEAK)

  for (const d of decisions) {
    const { charge: c } = d
    const tag = !d.staffId ? 'LEAVE ' : willApply(d) ? (APPLY ? 'SET   ' : 'WOULD ') : 'HOLD  '
    console.log(`  ${tag} ${(c.created_at || '').slice(0, 16)}  ${money(c.amount).padStart(9)}  ${String(c.description).slice(0, 24).padEnd(26)} ${d.staffId ? '-> ' + displayName(d.staffId) : '(nobody to attribute it to)'}`)
    console.log(`         ${d.strength.padEnd(9)} ${d.why}`)
  }

  const perStaff = new Map()
  const byStrength = { strong: 0, supported: 0, weak: 0, none: 0 }
  let held = 0, left = 0
  for (const d of decisions) {
    byStrength[d.strength] = (byStrength[d.strength] || 0) + 1
    if (!d.staffId) { left++; continue }
    if (!willApply(d)) { held++; continue }
    const name = displayName(d.staffId)
    perStaff.set(name, (perStaff.get(name) || 0) + (Number(d.charge.amount) || 0))
  }

  console.log('\n--- Where the money goes ---')
  for (const [name, amount] of [...perStaff].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(24)} +GHS ${money(amount)}`)
  }

  let applied = 0, errors = 0
  if (APPLY) {
    for (const d of decisions) {
      if (!willApply(d)) continue
      const staffRowId = staffRowIdFor.get(d.staffId)
      if (!staffRowId) {
        console.error(`  SKIP  ${d.charge.id} — ${displayName(d.staffId)} has no staff row to point at`)
        errors++
        continue
      }
      try {
        await rest(`/booking_charges?id=eq.${d.charge.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ created_by: staffRowId }),
        })
        applied++
      } catch (err) {
        console.error(`  ERROR ${d.charge.id} — ${err.message}`)
        errors++
      }
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Charges with no staff recorded : ${orphans.length}`)
  console.log(`  strong (presence at the app) : ${byStrength.strong}`)
  console.log(`  supported (presence + booking): ${byStrength.supported}`)
  console.log(`  weak (evidence disagrees)    : ${byStrength.weak}${INCLUDE_WEAK ? ' — applied' : ' — held back'}`)
  console.log(`  no activity nearby           : ${byStrength.none}`)
  console.log(`${APPLY ? 'Attributed' : 'Would attribute'}                : ${APPLY ? applied : decisions.filter(willApply).length}`)
  console.log(`Held back for review           : ${held}`)
  console.log(`Left alone (nobody to name)    : ${left}`)
  if (APPLY && errors) console.log(`Errors                         : ${errors}`)
  if (!INCLUDE_WEAK && held > 0) {
    console.log('\nThe held-back rows have evidence pointing two ways. Read them above; pass')
    console.log('--include-weak to accept the nearest-person reading for those too.')
  }
}

main()
