/**
 * Who may see what the hotel has earned.
 *
 * The dashboard showed an all-time Total Revenue card to everyone with a
 * staff login. Reception quotes room prices all day, but the hotel's takings
 * are management information — and the card was the first thing on the screen.
 *
 * The dashboard now hides it behind the same permission that gates the
 * Analytics page and the reports, so this suite guards that rule rather than
 * the card: granting `analytics` to `staff` would put the figure back on every
 * front-desk screen, and nothing else would say so.
 */
import { hasPermission, canAccessRoute, ROLE_PERMISSIONS, type StaffRole } from '@/lib/rbac'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

/** What the dashboard asks before drawing the Total Revenue card. */
const canSeeRevenue = (role: StaffRole) => hasPermission(role, 'analytics', 'read')

check('reception does not see the takings', canSeeRevenue('staff'), false)
check('a manager does', canSeeRevenue('manager'), true)
check('an admin does', canSeeRevenue('admin'), true)
check('the owner does', canSeeRevenue('owner'), true)

// The card is drawn from the same permission the pages behind it use; if these
// ever disagree, the dashboard is showing something a role cannot open.
check('and it matches who may open Analytics', canAccessRoute('/staff/analytics', 'staff'), false)
check('for a manager too', canAccessRoute('/staff/analytics', 'manager'), true)

// Reports are the other place the figure appears in full.
check('reception cannot read reports', hasPermission('staff', 'reports', 'read'), false)

// A wildcard is how the owner gets everything; nobody else may hold one.
const wildcards = (Object.keys(ROLE_PERMISSIONS) as StaffRole[])
  .filter(r => ROLE_PERMISSIONS[r].some(p => p.resource === '*'))
check('only the owner holds a wildcard', wildcards, ['owner'])

// Staff keep the job they actually do.
check('reception still takes bookings', hasPermission('staff', 'bookings', 'create'), true)
check('and still works the rooms board', hasPermission('staff', 'housekeeping', 'update'), true)
check('and still sees their own revenue page', canAccessRoute('/staff/my-revenue', 'staff'), true)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
