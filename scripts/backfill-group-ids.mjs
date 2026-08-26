#!/usr/bin/env node
/**
 * Gives every group booking a real relational record.
 *
 * Group membership was written twice over: as a `GROUP_DATA` comment inside
 * each booking's special_requests, and — from migration 20260801120000 — as a
 * `booking_groups` row plus an indexed `bookings.group_id`. The second one
 * never landed. createBooking returned a locally-invented id rather than the
 * one the database assigned, so the write that sets group_id addressed a row
 * that does not exist and failed silently. As of 2026-08-26, 19 groups
 * covering 78 rooms existed in the comments and not one booking carried
 * group_id.
 *
 * That is fixed going forward (see the commit that adds
 * tests/e2e/group-membership.ts). This script repairs what is already there:
 *
 *   1. Creates the missing `booking_groups` row for each group, keeping the id
 *      the comment already uses so both records name the group identically.
 *   2. Sets `bookings.group_id` on every room whose comment names a group.
 *   3. Names each group's primary room in `primary_booking_id`.
 *
 * Nothing is deleted and no comment is touched: the GROUP_DATA comments stay
 * exactly as they are, so the fallback reader keeps working and this script can
 * be re-run. It is idempotent — a second run reports nothing to do.
 *
 * Bookings are tagged one row at a time on purpose. `bookings` carries a GiST
 * exclusion constraint against overlapping stays, which Postgres re-checks on
 * update; a row that already violates it fails alone and is reported rather
 * than taking the whole batch down.
 *
 * Dry-run by default; prints exactly what it would write.
 *
 * Usage:
 *   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
 *     node scripts/backfill-group-ids.mjs [--apply] [--backup <path>]
 */

const APPLY = process.argv.includes('--apply')
const backupArg = process.argv.indexOf('--backup')
const BACKUP = backupArg > -1 ? process.argv[backupArg + 1] : ''

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

/** PostgREST caps a response at 1000 rows, so page through. */
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseGroupData(specialRequests) {
  const m = (specialRequests || '').match(/<!-- GROUP_DATA:(.*?) -->/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[1])
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** The room a group is billed under: the one marked primary, else the earliest. */
function pickPrimary(members) {
  const marked = members.find((m) => m.data.isPrimaryBooking === true)
  if (marked) return marked
  return [...members].sort((a, b) => {
    const byDate = String(a.row.check_in || '').localeCompare(String(b.row.check_in || ''))
    return byDate !== 0 ? byDate : String(a.row.id).localeCompare(String(b.row.id))
  })[0]
}

async function main() {
  console.log(APPLY
    ? 'Running in APPLY mode — will write to the database.'
    : 'Running in DRY-RUN mode — no writes. Pass --apply to make the changes.')

  const [bookings, groupRows] = await Promise.all([
    all('/bookings?select=id,group_id,check_in,check_out,status,created_by,created_by_name,created_at,special_requests&special_requests=ilike.*GROUP_DATA*'),
    all('/booking_groups?select=id,group_reference,primary_booking_id,status'),
  ])

  const groupById = new Map(groupRows.map((g) => [g.id, g]))
  const groupIdByReference = new Map(groupRows.map((g) => [g.group_reference, g.id]))

  // Gather the rooms of each group as the comments describe them.
  const groups = new Map()
  const unusable = []
  for (const row of bookings) {
    const data = parseGroupData(row.special_requests)
    const groupId = data?.groupId
    if (!groupId) continue
    if (!UUID.test(groupId)) {
      unusable.push({ booking: row.id, groupId, why: 'group id is not a uuid' })
      continue
    }
    if (!groups.has(groupId)) groups.set(groupId, [])
    groups.get(groupId).push({ row, data })
  }

  console.log(`\n${bookings.length} bookings carry a GROUP_DATA comment, across ${groups.size} groups.`)

  const plan = { createGroups: [], tagBookings: [], setPrimary: [], skipped: [] }

  for (const [groupId, members] of groups) {
    const primary = pickPrimary(members)
    const reference = primary.data.groupReference
      || members.map((m) => m.data.groupReference).find(Boolean)
      || ''

    const existing = groupById.get(groupId)

    if (!existing) {
      // A different group row already owning this reference means the two
      // records disagree about which group is which. Not a script's call.
      const clash = reference && groupIdByReference.get(reference)
      if (clash && clash !== groupId) {
        plan.skipped.push({
          groupId, reference, rooms: members.length,
          why: `reference already belongs to booking_groups row ${clash}`,
        })
        continue
      }
      if (!reference) {
        plan.skipped.push({ groupId, reference: '(none)', rooms: members.length, why: 'no group reference in any room' })
        continue
      }
      plan.createGroups.push({
        id: groupId,
        group_reference: reference,
        billing_contact: primary.data.billingContact ?? null,
        additional_charges: primary.data.additionalCharges ?? [],
        discount: primary.data.discount ?? null,
        status: 'active',
        created_by: primary.row.created_by ?? null,
        created_by_name: primary.row.created_by_name ?? null,
        created_at: members.map((m) => m.row.created_at).filter(Boolean).sort()[0] || undefined,
      })
    }

    for (const m of members) {
      if (m.row.group_id === groupId) continue
      if (m.row.group_id && m.row.group_id !== groupId) {
        plan.skipped.push({
          groupId, reference, rooms: 1,
          why: `booking ${m.row.id} is already tagged to a different group (${m.row.group_id})`,
        })
        continue
      }
      plan.tagBookings.push({ id: m.row.id, group_id: groupId, reference })
    }

    if (!existing?.primary_booking_id) {
      plan.setPrimary.push({ groupId, reference, primary_booking_id: primary.row.id, rooms: members.length })
    }
  }

  const line = (n, what) => `  ${String(n).padStart(3)}  ${what}`
  console.log('\nPlan')
  console.log(line(plan.createGroups.length, 'booking_groups rows to create'))
  console.log(line(plan.tagBookings.length, 'bookings to tag with group_id'))
  console.log(line(plan.setPrimary.length, 'groups to have their primary room named'))
  if (plan.skipped.length) console.log(line(plan.skipped.length, 'left alone (listed below)'))
  if (unusable.length) console.log(line(unusable.length, 'comments unusable (listed below)'))

  if (plan.createGroups.length) {
    console.log('\nGroups to create')
    for (const g of plan.createGroups) {
      console.log(`  ${g.group_reference}  ${g.id}  ${groups.get(g.id).length} room(s)  by ${g.created_by_name || g.created_by || 'unknown'}`)
    }
  }
  for (const s of plan.skipped) console.log(`\n  SKIP ${s.reference} (${s.groupId}): ${s.why}`)
  for (const u of unusable) console.log(`\n  SKIP booking ${u.booking}: ${u.why} (${u.groupId})`)

  if (plan.createGroups.length + plan.tagBookings.length + plan.setPrimary.length === 0) {
    console.log('\nNothing to do — every group already has its row, its tags and its primary room.')
    return
  }

  if (BACKUP) {
    const fs = await import('node:fs/promises')
    await fs.writeFile(BACKUP, JSON.stringify({
      takenAt: new Date().toISOString(),
      bookings: bookings.map(({ id, group_id }) => ({ id, group_id })),
      booking_groups: groupRows,
    }, null, 2))
    console.log(`\nBefore-state written to ${BACKUP}`)
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to make these changes.')
    return
  }

  // 1. Group rows first: bookings.group_id is a foreign key onto them.
  let created = 0
  for (const g of plan.createGroups) {
    const { ...body } = g
    if (!body.created_at) delete body.created_at
    try {
      await rest('/booking_groups', { method: 'POST', body: JSON.stringify(body), headers: { Prefer: 'return=minimal' } })
      created++
    } catch (e) {
      console.error(`  FAILED to create group ${g.group_reference}: ${e.message}`)
    }
  }
  console.log(`\nCreated ${created}/${plan.createGroups.length} booking_groups rows.`)

  // 2. Tag the rooms, one at a time — see the note on the exclusion constraint.
  let tagged = 0
  const tagFailures = []
  for (const b of plan.tagBookings) {
    try {
      await rest(`/bookings?id=eq.${b.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ group_id: b.group_id }),
        headers: { Prefer: 'return=minimal' },
      })
      tagged++
    } catch (e) {
      tagFailures.push({ id: b.id, reference: b.reference, error: e.message })
    }
  }
  console.log(`Tagged ${tagged}/${plan.tagBookings.length} bookings with group_id.`)
  for (const f of tagFailures) console.error(`  FAILED ${f.reference} booking ${f.id}: ${f.error}`)

  // 3. Name each group's primary room. Only where the group row now exists and
  //    the room was actually tagged, so the two records cannot disagree.
  const taggedIds = new Set(plan.tagBookings.filter((b) => !tagFailures.some((f) => f.id === b.id)).map((b) => b.id))
  let primaries = 0
  for (const p of plan.setPrimary) {
    const alreadyTagged = bookings.find((b) => b.id === p.primary_booking_id)?.group_id === p.groupId
    if (!alreadyTagged && !taggedIds.has(p.primary_booking_id)) {
      console.error(`  SKIP primary for ${p.reference}: its room was not tagged`)
      continue
    }
    try {
      await rest(`/booking_groups?id=eq.${p.groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ primary_booking_id: p.primary_booking_id }),
        headers: { Prefer: 'return=minimal' },
      })
      primaries++
    } catch (e) {
      console.error(`  FAILED to name primary for ${p.reference}: ${e.message}`)
    }
  }
  console.log(`Named the primary room for ${primaries}/${plan.setPrimary.length} groups.`)

  // Read back, so the report is what the database says rather than what we sent.
  const after = await all('/bookings?select=id,group_id&group_id=not.is.null')
  console.log(`\nBookings now carrying group_id: ${after.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
