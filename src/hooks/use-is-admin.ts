import { useStaffRole } from './use-staff-role'

/**
 * Returns true when current staff has admin or owner role.
 * Replaces hardcoded `email === 'admin@amplodge.com'` checks (BUG-0033).
 *
 * Usage:
 *   const { isAdmin, isLoading } = useIsAdmin()
 *   if (isLoading) return <Skeleton />
 *   if (!isAdmin) return <NotAuthorized />
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { role, isLoading } = useStaffRole()
  return {
    isAdmin: role === 'admin' || role === 'owner',
    isLoading: isLoading,
  }
}
