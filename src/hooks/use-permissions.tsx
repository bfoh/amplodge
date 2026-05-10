import { useStaffRole } from './use-staff-role'
import { hasPermission, canAccessRoute, canManageStaff, canAssignRole, getRoleLevel } from '@/lib/rbac'
import type { StaffRole } from '@/lib/rbac'

type Action = 'create' | 'read' | 'update' | 'delete'

/**
 * Enhanced hook for permission checking
 * Provides convenient methods to check various permissions based on current user role
 */
export function usePermissions() {
  const { role, isLoading, isOwner, isAdmin, isManager, isStaff, canManageEmployees } = useStaffRole()

  /**
   * Check if current user has permission for a specific action on a resource
   * Returns false if no role, but provides isLoading to the consumer
   */
  function can(resource: string, action: Action): boolean {
    if (isLoading || !role) return false
    return hasPermission(role, resource, action)
  }

  /**
   * Check if current user can access a specific route
   */
  function canAccess(route: string): boolean {
    if (isLoading || !role) return false
    return canAccessRoute(route, role)
  }

  /**
   * Check if current user can manage a specific staff member
   */
  function canManage(targetRole: string): boolean {
    if (isLoading || !role) return false
    return canManageStaff(role, targetRole as StaffRole)
  }

  /**
   * Check if current user can assign a specific role
   */
  function canAssign(targetRole: string): boolean {
    if (isLoading || !role) return false
    return canAssignRole(role, targetRole as StaffRole)
  }

  /**
   * Check if current user has a higher or equal role level than target
   */
  function hasHigherOrEqualRole(targetRole: string): boolean {
    if (isLoading || !role) return false
    return getRoleLevel(role) >= getRoleLevel(targetRole as StaffRole)
  }

  /**
   * Check if current user has a higher role level than target
   */
  function hasHigherRole(targetRole: string): boolean {
    if (isLoading || !role) return false
    return getRoleLevel(role) > getRoleLevel(targetRole as StaffRole)
  }

  /**
   * Check multiple permissions at once (all must be true)
   */
  function canAll(checks: Array<{ resource: string; action: Action }>): boolean {
    if (isLoading || !role) return false
    return checks.every(check => hasPermission(role, check.resource, check.action))
  }

  /**
   * Check multiple permissions at once (at least one must be true)
   */
  function canAny(checks: Array<{ resource: string; action: Action }>): boolean {
    if (isLoading || !role) return false
    return checks.some(check => hasPermission(role, check.resource, check.action))
  }

  /**
   * Get all resources the user can perform an action on
   */
  function getResourcesForAction(action: Action): string[] {
    if (!role) return []
    return []
  }

  return {
    // Current role info
    role,
    isLoading,
    
    // Role helpers
    isOwner,
    isAdmin,
    isManager,
    isStaff,
    canManageEmployees,
    
    // Permission check functions
    can,
    canAccess,
    canManage,
    canAssign,
    hasHigherOrEqualRole,
    hasHigherRole,
    canAll,
    canAny,
    getResourcesForAction,
    
    // Convenience aliases
    canCreate: (resource: string) => can(resource, 'create'),
    canRead: (resource: string) => can(resource, 'read'),
    canUpdate: (resource: string) => can(resource, 'update'),
    canDelete: (resource: string) => can(resource, 'delete'),
  }
}

