/**
 * Adding an employee writes their staff row on the server.
 *
 * The staff row (and so the role) used to be inserted from the browser, which
 * needed a policy letting any signed-in account write any staff row, and so
 * promote itself to owner. 20261106120000_staff_role_lockdown.sql removes that;
 * this checks create-employee now does the job, with the same role rules as
 * update-employee: admins only, and only the owner hands out the owner role.
 */
import { authUsers, passwordResets, tables, tokens } from './fake-supabase-js'
import { handler } from '../../netlify/functions/create-employee.js'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'

const person = (id: string, email: string, role: string) => {
  authUsers.push({ id, email })
  tokens[`tok-${role}`] = id
  return { id: `staff-${role}`, user_id: id, name: role, email, role }
}
tables.staff = [
  person('u-owner', 'owner@amp.test', 'owner'),
  person('u-admin', 'admin@amp.test', 'admin'),
  person('u-staff', 'desk@amp.test', 'staff'),
]
tables.users = []

const call = async (token: string | null, body: Record<string, unknown>) => {
  const res: any = await handler({
    httpMethod: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ password: 'User@123', name: 'New Person', ...body }),
  } as any)
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') }
}
const staffFor = (email: string) => (tables.staff || []).filter((s) => s.email === email)

const ID1 = '0b5f6d3e-1c2a-4b7e-9f00-000000000001'
const ID2 = '0b5f6d3e-1c2a-4b7e-9f00-000000000002'

// Who may call it at all.
check('no token: 401', (await call(null, { email: 'a@amp.test', role: 'staff' })).status, 401)
check('a receptionist: 403', (await call('tok-staff', { email: 'a@amp.test', role: 'staff' })).status, 403)
check('...and no account was made', authUsers.some((u) => u.email === 'a@amp.test'), false)

// An admin adds a manager: one account, one staff row under the id the page chose.
let r = await call('tok-admin', { email: 'mgr@amp.test', role: 'manager', staffId: ID1 })
check('admin adds a manager: 200', r.status, 200)
check('the staff row carries the page\'s id, role and the new account', staffFor('mgr@amp.test').map((s) => [s.id, s.role, s.user_id === r.body.user?.id]), [[ID1, 'manager', true]])
check('the row comes back to the page', r.body.staff?.id, ID1)

// The owner role.
r = await call('tok-admin', { email: 'boss2@amp.test', role: 'owner' })
check('admin cannot create an owner: 403', r.status, 403)
check('...before any account is made', authUsers.some((u) => u.email === 'boss2@amp.test'), false)
r = await call('tok-owner', { email: 'boss2@amp.test', role: 'owner', staffId: ID2 })
check('the owner can: 200', [r.status, staffFor('boss2@amp.test').map((s) => s.role)], [200, ['owner']])

// Bad input is refused before anything is written.
check('unknown role: 400', (await call('tok-admin', { email: 'x@amp.test', role: 'superuser' })).status, 400)
check('staffId that is not a UUID: 400', (await call('tok-admin', { email: 'x@amp.test', role: 'staff', staffId: 'abc' })).status, 400)
check('no name: 400', (await call('tok-admin', { email: 'x@amp.test', role: 'staff', name: '  ' })).status, 400)
check('...none of those made an account', authUsers.some((u) => u.email === 'x@amp.test'), false)

// Role defaults to the least privilege.
r = await call('tok-admin', { email: 'plain@amp.test' })
check('no role given: a staff row with role staff', [r.status, staffFor('plain@amp.test').map((s) => s.role)], [200, ['staff']])

// An account that already exists: recovered, and given a row only if it has none.
authUsers.push({ id: 'u-orphan', email: 'orphan@amp.test' })
r = await call('tok-admin', { email: 'orphan@amp.test', role: 'staff' })
check('existing account with no staff row: recovered and given one', [r.status, r.body.recovered, staffFor('orphan@amp.test').length], [200, true, 1])
r = await call('tok-admin', { email: 'desk@amp.test', role: 'admin' })
check('existing employee: 409, and their role is not touched', [r.status, staffFor('desk@amp.test').map((s) => s.role)], [409, ['staff']])
check('...nor their password reset to the default', passwordResets.includes('u-staff'), false)
check('the recovered account (no staff row) did get the default password', passwordResets.includes('u-orphan'), true)

console.log(failures ? `FAILURE: ${failures} failed` : 'ALL PASS create-employee: admins only, the server writes the staff row, only the owner makes owners')
process.exit(failures ? 1 : 0)
