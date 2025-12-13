import { ReactNode } from 'react'
import { usePermissions } from '@/hooks/use-permissions'

interface PermissionProps {
  children: ReactNode
  /** Resource to check permission for */
  resource?: string
  /** Action to check permission for */
  action?: 'create' | 'read' | 'update' | 'delete'
  /** Route to check access for */
  route?: string
  /** Role to check against (user must have this role) */
  role?: 'staff' | 'manager' | 'admin' | 'owner'
  /** Minimum role required (user must have this role or higher) */
  minRole?: 'staff' | 'manager' | 'admin' | 'owner'
  /** Target role for management checks */
  targetRole?: string
  /** Check if user can manage target role */
  canManage?: boolean
  /** Check if user can assign target role */
  canAssign?: boolean
  /** Custom permission check function */
  check?: () => boolean
  /** Fallback content to show when permission denied */
  fallback?: ReactNode
}

/**
 * Permission wrapper component for declarative permission checks
 * Only renders children if permission check passes
 * 
 * @example
 * // Check resource permission
 * <Permission resource="employees" action="delete">
 *   <DeleteButton />
 * </Permission>
 * 
 * @example
 * // Check route access
 * <Permission route="/staff/employees">
 *   <EmployeesLink />
 * </Permission>
 * 
 * @example
 * // Check specific role
 * <Permission role="admin">
 *   <AdminPanel />
 * </Permission>
 * 
 * @example
 * // Check minimum role
 * <Permission minRole="manager">
 *   <ReportsLink />
 * </Permission>
 * 
 * @example
 * // Check if can manage a staff member
 * <Permission canManage targetRole={employee.role}>
 *   <EditButton />
 * </Permission>
 * 
 * @example
 * // Custom check with fallback
 * <Permission check={() => someCondition} fallback={<p>Access denied</p>}>
 *   <SensitiveContent />
 * </Permission>
 */
export function Permission({
  children,
  resource,
  action,
  route,
  role: requiredRole,
  minRole,
  targetRole,
  canManage: checkCanManage,
  canAssign: checkCanAssign,
  check,
  fallback = null,
}: PermissionProps) {
  const permissions = usePermissions()

  // Don't render while loading
  if (permissions.loading) {
    return <>{fallback}</>
  }

  let hasPermission = true

  // Custom check function
  if (check) {
    hasPermission = check()
  }
  // Resource + action check
  else if (resource && action) {
    hasPermission = permissions.can(resource, action)
  }
  // Route access check
  else if (route) {
    hasPermission = permissions.canAccess(route)
  }
  // Exact role check
  else if (requiredRole) {
    hasPermission = permissions.role === requiredRole
  }
  // Minimum role check
  else if (minRole) {
    const roleHierarchy = { staff: 1, manager: 2, admin: 3, owner: 4 }
    const userLevel = permissions.role ? roleHierarchy[permissions.role] : 0
    const minLevel = roleHierarchy[minRole]
    hasPermission = userLevel >= minLevel
  }
  // Can manage check
  else if (checkCanManage && targetRole) {
    hasPermission = permissions.canManage(targetRole)
  }
  // Can assign check
  else if (checkCanAssign && targetRole) {
    hasPermission = permissions.canAssign(targetRole)
  }

  // Render children if permission check passes, otherwise render fallback
  return hasPermission ? <>{children}</> : <>{fallback}</>
}

/**
 * Multiple permission checks with OR logic
 * Renders children if ANY permission check passes
 */
export function PermissionAny({
  children,
  checks,
  fallback = null,
}: {
  children: ReactNode
  checks: Array<{ resource: string; action: 'create' | 'read' | 'update' | 'delete' }>
  fallback?: ReactNode
}) {
  const permissions = usePermissions()

  if (permissions.loading) {
    return <>{fallback}</>
  }

  const hasPermission = permissions.canAny(checks)

  return hasPermission ? <>{children}</> : <>{fallback}</>
}

/**
 * Multiple permission checks with AND logic
 * Renders children only if ALL permission checks pass
 */
export function PermissionAll({
  children,
  checks,
  fallback = null,
}: {
  children: ReactNode
  checks: Array<{ resource: string; action: 'create' | 'read' | 'update' | 'delete' }>
  fallback?: ReactNode
}) {
  const permissions = usePermissions()

  if (permissions.loading) {
    return <>{fallback}</>
  }

  const hasPermission = permissions.canAll(checks)

  return hasPermission ? <>{children}</> : <>{fallback}</>
}

