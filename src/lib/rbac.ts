// Role-Based Access Control (RBAC) Utilities

export type StaffRole = 'staff' | 'manager' | 'admin' | 'owner'

export interface Permission {
  resource: string
  actions: ('create' | 'read' | 'update' | 'delete')[]
}

// Define permissions for each role
export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: [
    { resource: '*', actions: ['create', 'read', 'update', 'delete'] }
  ],
  admin: [
    { resource: 'employees', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'bookings', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'properties', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'guests', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'reports', actions: ['read'] },
    { resource: 'analytics', actions: ['read'] },
    { resource: 'activity-logs', actions: ['read'] },
    { resource: 'invoices', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'housekeeping', actions: ['read', 'update'] },
    { resource: 'settings', actions: ['read', 'update'] },
    { resource: 'pricing', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'reviews', actions: ['read', 'update', 'delete'] }
  ],
  manager: [
    { resource: 'bookings', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'properties', actions: ['create', 'read', 'update'] },
    { resource: 'guests', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'reports', actions: ['read'] },
    { resource: 'analytics', actions: ['read'] },
    { resource: 'activity-logs', actions: ['read'] },
    { resource: 'invoices', actions: ['read'] },
    { resource: 'employees', actions: ['read'] },
    { resource: 'housekeeping', actions: ['read', 'update'] }
  ],
  staff: [
    { resource: 'bookings', actions: ['create', 'read', 'update'] },
    { resource: 'guests', actions: ['read', 'update'] },
    { resource: 'housekeeping', actions: ['read', 'update'] }
  ]
}

// Define route access by role
export const ROUTE_ACCESS: Record<string, StaffRole[]> = {
  '/staff/dashboard': ['owner', 'admin', 'manager', 'staff'],
  '/staff/bookings': ['owner', 'admin', 'manager', 'staff'],
  '/staff/onsite': ['owner', 'admin', 'manager', 'staff'],
  '/staff/guests': ['owner', 'admin', 'manager', 'staff'],
  '/staff/properties': ['owner', 'admin', 'manager'],
  '/staff/housekeeping': ['owner', 'admin', 'manager', 'staff'],
  '/staff/calendar': ['owner', 'admin', 'manager', 'staff'],
  '/staff/analytics': ['owner', 'admin', 'manager'],
  '/staff/activity-logs': ['owner', 'admin', 'manager'],
  '/staff/invoices': ['owner', 'admin', 'manager'],
  '/staff/employees': ['owner', 'admin', 'manager'],
  '/staff/cleanup': ['owner', 'admin'],
  '/staff/settings': ['owner', 'admin', 'manager'],
  '/staff/channels': ['owner', 'admin', 'manager'],
  '/staff/meals': ['owner', 'admin', 'manager', 'staff'],
  '/staff/services': ['owner', 'admin', 'manager'],
  '/staff/local-tax': ['owner', 'admin'],
  '/staff/set-prices': ['owner', 'admin'],
  '/staff/reservations': ['owner', 'admin', 'manager', 'staff'],
  '/staff/reservations/history': ['owner', 'admin', 'manager', 'staff'],
  '/staff/end-of-day': ['owner', 'admin'],
  '/staff/reviews': ['owner', 'admin', 'manager', 'staff'],
  '/staff/marketing': ['owner', 'admin', 'manager', 'staff'],
  '/staff/requests': ['owner', 'admin', 'manager', 'staff']
}

// Navigation items visibility by role
export interface NavItem {
  path: string
  label: string
  icon?: string
  minRole: StaffRole[]
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/staff/dashboard', label: 'Dashboard', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { path: '/staff/bookings', label: 'Bookings', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { path: '/staff/reservations', label: 'Reservations', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { path: '/staff/onsite', label: 'Onsite Booking', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { path: '/staff/calendar', label: 'Calendar', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { path: '/staff/guests', label: 'Guests', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { path: '/staff/reviews', label: 'Reviews', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { path: '/staff/housekeeping', label: 'Housekeeping', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { path: '/staff/invoices', label: 'Invoices', minRole: ['owner', 'admin'] },
  { path: '/staff/properties', label: 'Properties', minRole: ['owner', 'admin', 'manager'] },
  { path: '/staff/employees', label: 'Employees', minRole: ['owner', 'admin'] },
  { path: '/staff/activity-logs', label: 'Activity Logs', minRole: ['owner', 'admin'] },
  { path: '/staff/settings', label: 'Settings', minRole: ['owner', 'admin'] },
  { path: '/staff/marketing', label: 'Marketing', minRole: ['owner', 'admin', 'manager', 'staff'] }
]

/**
 * Check if a role has access to a specific route
 */
export function canAccessRoute(route: string, userRole: StaffRole): boolean {
  const allowedRoles = ROUTE_ACCESS[route]

  // Debug logging for History route specifically
  if (route.includes('reservations/history')) {
    console.log('🔍 [RBAC] Checking route access:', {
      route,
      userRole,
      allowedRoles,
      hasAccess: allowedRoles ? allowedRoles.includes(userRole) : false
    })
  }

  if (!allowedRoles) return false
  return allowedRoles.includes(userRole)
}

/**
 * Check if a role has permission for a specific action on a resource
 */
export function hasPermission(
  userRole: StaffRole,
  resource: string,
  action: 'create' | 'read' | 'update' | 'delete'
): boolean {
  const permissions = ROLE_PERMISSIONS[userRole]

  // Check for wildcard permission (owner)
  if (permissions.some(p => p.resource === '*')) return true

  // Check specific resource permission
  const resourcePermission = permissions.find(p => p.resource === resource)
  if (!resourcePermission) return false

  return resourcePermission.actions.includes(action)
}

/**
 * Get all accessible routes for a role
 */
export function getAccessibleRoutes(userRole: StaffRole): string[] {
  return Object.entries(ROUTE_ACCESS)
    .filter(([_, roles]) => roles.includes(userRole))
    .map(([route]) => route)
}

/**
 * Get visible navigation items for a role
 */
export function getVisibleNavItems(userRole: StaffRole): NavItem[] {
  return NAV_ITEMS.filter(item => item.minRole.includes(userRole))
}

/**
 * Check if a user can manage a specific staff member
 * - Owners can manage everyone
 * - Admins can manage everyone except owners
 * - Others cannot manage anyone
 */
export function canManageStaff(actorRole: StaffRole, targetRole: StaffRole): boolean {
  if (actorRole === 'owner') return true
  if (actorRole === 'admin' && targetRole !== 'owner') return true
  return false
}

/**
 * Get role hierarchy level (higher number = more power)
 */
export function getRoleLevel(role: StaffRole): number {
  const levels: Record<StaffRole, number> = {
    staff: 1,
    manager: 2,
    admin: 3,
    owner: 4
  }
  return levels[role] || 0
}

/**
 * Check if actor can assign a role to someone
 * - Owners can assign any role
 * - Admins can assign up to admin level
 * - Others cannot assign roles
 */
export function canAssignRole(actorRole: StaffRole, targetRole: StaffRole): boolean {
  const actorLevel = getRoleLevel(actorRole)
  const targetLevel = getRoleLevel(targetRole)

  if (actorRole === 'owner') return true
  if (actorRole === 'admin' && targetLevel < 4) return true
  return false
}

/**
 * Get role display name
 */
export function getRoleDisplay(role: StaffRole): string {
  const roleMap: Record<StaffRole, string> = {
    staff: 'Staff',
    manager: 'Manager',
    admin: 'Admin',
    owner: 'Owner'
  }
  return roleMap[role] || role
}

/**
 * Get role description
 */
export function getRoleDescription(role: StaffRole): string {
  const descriptions: Record<StaffRole, string> = {
    staff: 'Basic operations - bookings, guests, housekeeping',
    manager: 'Limited management - all staff features plus reports',
    admin: 'Full access - manage employees and system settings',
    owner: 'Full system access - highest level of control'
  }
  return descriptions[role] || ''
}
