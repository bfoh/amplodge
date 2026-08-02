#!/usr/bin/env node
/**
 * Repairs guests.email for rows corrupted by the booking-engine.ts bug
 * (fixed 2026-08-02): every new guest whose lookup hit a computedGuestId
 * slug threw a Postgres 22P02, fell into the catch block, and got created
 * with `fallback-<uuid>@guest.local` instead of the real email the guest
 * actually gave — even though that real email was already validated and
 * still sits untouched in the booking's own GUEST_SNAPSHOT comment.
 *
 * This script finds every guest with a fallback-* email, pulls their most
 * recent booking, extracts GUEST_SNAPSHOT, and (with --apply) writes the
 * real email back onto the guest row. Dry-run by default — prints what it
 * WOULD change and does not touch the database until you pass --apply.
 *
 * Usage:
 *   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
 *     node scripts/repair-fallback-guest-emails.mjs [--apply]
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

function extractSnapshotEmail(specialRequests) {
  if (!specialRequests) return null
  const m = specialRequests.match(/<!-- GUEST_SNAPSHOT:(.*?) -->/)
  if (!m) return null
  try {
    const snap = JSON.parse(m[1])
    return snap?.email || null
  } catch {
    return null
  }
}

function isUsableEmail(email) {
  if (!email) return false
  if (/^fallback-.*@guest\.local$/i.test(email)) return false
  if (/^guest-.*@guest\.local$/i.test(email)) return false
  return /\S+@\S+\.\S+/.test(email)
}

async function main() {
  console.log(APPLY ? 'Running in APPLY mode — will write changes.' : 'Running in DRY-RUN mode — no writes. Pass --apply to write.')

  const guestsRes = await rest(
    `/guests?email=like.fallback-*&select=id,name,email,phone&order=created_at.asc`
  )
  const guests = await guestsRes.json()
  console.log(`Found ${guests.length} guest(s) with fallback emails.\n`)

  const results = { repaired: 0, noBooking: 0, noSnapshot: 0, snapshotAlsoFallback: 0, errors: 0 }

  for (const guest of guests) {
    try {
      const bookingsRes = await rest(
        `/bookings?guest_id=eq.${guest.id}&select=id,special_requests,created_at&order=created_at.desc&limit=1`
      )
      const bookings = await bookingsRes.json()
      if (!bookings.length) {
        console.log(`SKIP  ${guest.id}  ${guest.name || '(no name)'} — no bookings found (orphan guest, not repaired here).`)
        results.noBooking++
        continue
      }

      const realEmail = extractSnapshotEmail(bookings[0].special_requests)
      if (!realEmail) {
        console.log(`SKIP  ${guest.id}  ${guest.name || '(no name)'} — booking has no GUEST_SNAPSHOT.`)
        results.noSnapshot++
        continue
      }
      if (!isUsableEmail(realEmail)) {
        console.log(`SKIP  ${guest.id}  ${guest.name || '(no name)'} — snapshot email itself unusable (${realEmail}).`)
        results.snapshotAlsoFallback++
        continue
      }

      console.log(`FIX   ${guest.id}  ${guest.name || '(no name)'} — ${guest.email} -> ${realEmail}`)
      if (APPLY) {
        await rest(`/guests?id=eq.${guest.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ email: realEmail }),
        })
      }
      results.repaired++
    } catch (err) {
      console.error(`ERROR ${guest.id} — ${err.message}`)
      results.errors++
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Repaired${APPLY ? '' : ' (would repair)'}: ${results.repaired}`)
  console.log(`No booking (orphan):                   ${results.noBooking}`)
  console.log(`No GUEST_SNAPSHOT:                      ${results.noSnapshot}`)
  console.log(`Snapshot email also unusable:           ${results.snapshotAlsoFallback}`)
  console.log(`Errors:                                 ${results.errors}`)
}

main()
