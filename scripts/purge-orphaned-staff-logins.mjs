#!/usr/bin/env node
/**
 * Deletes the login accounts of employees who were already removed.
 *
 * Deleting an employee used to happen in two halves: the browser deleted the
 * `staff` row, and a Netlify function deleted the auth account. Nothing checked
 * whether the second half worked, so when it did not, the employee vanished
 * from the Employees page while their account stayed live. On 2026-09-15 three
 * such accounts were left in production.
 *
 * The code path is fixed (netlify/functions/delete-employee.js does all of it
 * in one place now, and reports what it did). This clears up what the old one
 * left behind.
 *
 * An account qualifies only if it holds NO staff row and NO guest-facing
 * purpose. Guests do not have auth accounts in this system — the guest portal
 * works off booking tokens — so anything here with no staff row is a staff
 * login that outlived its employee. Each one is still printed in full before
 * anything happens, because deleting a login cannot be undone.
 *
 * Dry-run by default; prints exactly what it would delete.
 *
 * Usage:
 *   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
 *     node scripts/purge-orphaned-staff-logins.mjs [--apply] [--keep <email> ...]
 */

const APPLY = process.argv.includes('--apply')
const KEEP = new Set(
  process.argv.reduce((acc, arg, i) => (arg === '--keep' ? [...acc, (process.argv[i + 1] || '').toLowerCase()] : acc), [])
)

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

async function listAuthUsers() {
  const out = []
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H })
    if (!res.ok) throw new Error(`admin/users -> ${res.status}: ${await res.text()}`)
    const { users = [] } = await res.json()
    out.push(...users)
    if (users.length < 200) break
  }
  return out
}

const staff = await (await rest('/staff?select=id,user_id,name,email')).json()
const staffUserIds = new Set(staff.map((s) => s.user_id).filter(Boolean))
const authUsers = await listAuthUsers()

const orphans = authUsers.filter((u) => !staffUserIds.has(u.id) && !KEEP.has((u.email || '').toLowerCase()))

console.log(`${staff.length} staff rows, ${authUsers.length} auth accounts.`)
console.log(`${orphans.length} account(s) with no staff row:\n`)

for (const u of orphans) {
  console.log(`  ${u.email || '(no email)'}`)
  console.log(`    id           ${u.id}`)
  console.log(`    created      ${(u.created_at || '').slice(0, 10)}`)
  console.log(`    last sign-in ${(u.last_sign_in_at || 'never').slice(0, 10)}`)
}

if (orphans.length === 0) {
  console.log('Nothing to do.')
  process.exit(0)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to delete these logins.')
  console.log('Keep one with:  --keep someone@example.com')
  process.exit(0)
}

console.log('\nDeleting...')
let deleted = 0
for (const u of orphans) {
  // The profile row first: leaving it behind is harmless, but leaving it while
  // the login is gone is just litter.
  try {
    await rest(`/users?id=eq.${u.id}`, { method: 'DELETE' })
  } catch (err) {
    console.warn(`  ${u.email}: profile row not removed — ${err.message}`)
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H })
  if (res.ok || res.status === 404) {
    console.log(`  deleted ${u.email}`)
    deleted++
  } else {
    console.error(`  FAILED ${u.email}: ${res.status} ${await res.text()}`)
  }
}
console.log(`\n${deleted} of ${orphans.length} deleted.`)
