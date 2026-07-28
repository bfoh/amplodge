import { ReactNode, useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useStaffRole } from '@/hooks/use-staff-role'
import { canAccessRoute } from '@/lib/rbac'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { auth } from '@/lib/db'

interface ProtectedRouteProps {
  children: ReactNode
}

/**
 * ProtectedRoute — gates staff portal access.
 *
 * CRITICAL PERF FIX: Previously this component reset `isAuthorized` to null
 * on every `location.pathname` change, which forced the "Verifying access..."
 * spinner to re-appear on every sidebar click. That caused multi-second delays
 * on every page transition in Ghana (high-latency network).
 *
 * Now: once the user identity is verified, authorization persists across route
 * changes within the same session. We only re-check when the user's identity
 * or role actually changes (logout, role update, etc.).
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { role, isLoading, userId } = useStaffRole()
  const navigate = useNavigate()
  const location = useLocation()

  // `true` = authorized, `false` = denied (redirect already fired), `null` = pending first check
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)

  // Track which userId+role combo we last authorized against so we don't
  // re-run the (potentially async) check on every render.
  const lastAuthKey = useRef<string | null>(null)

  const checkAccess = useCallback(async () => {
    // Build a stable key from the identity facts that matter.
    const authKey = `${userId ?? 'none'}:${role ?? 'none'}`

    // If we already checked this exact identity, skip.
    if (lastAuthKey.current === authKey) return

    // --- No user ID → redirect to login ---
    if (!userId) {
      const returnTo = encodeURIComponent(location.pathname + location.search)
      navigate(`/staff/login?returnTo=${returnTo}`, { replace: true })
      lastAuthKey.current = authKey
      setIsAuthorized(false)
      return
    }

    // --- User ID but no role → admin fallback, then deny ---
    if (!role) {
      try {
        const user = await auth.me()
        if (user?.email === import.meta.env.VITE_ADMIN_EMAIL) {
          console.log('✅ [ProtectedRoute] Admin user detected (fallback)')
          lastAuthKey.current = authKey
          setIsAuthorized(true)
          return
        }
      } catch (e) {
        console.error('❌ [ProtectedRoute] Auth verify failed:', e)
      }

      toast.error('Access denied', { description: 'No staff role found for your account.' })
      navigate('/staff/login', { replace: true })
      lastAuthKey.current = authKey
      setIsAuthorized(false)
      return
    }

    // --- Has role → authorized for the staff portal ---
    // Individual route-level RBAC (e.g. /staff/hr is owner-only) is checked
    // per-navigation below in a separate lightweight effect, not here.
    console.log(`✅ [ProtectedRoute] Identity verified: ${role} (userId: ${userId?.slice(0, 8)}…)`)
    lastAuthKey.current = authKey
    setIsAuthorized(true)
  }, [userId, role, navigate, location.pathname, location.search])

  // Run the identity check whenever auth state settles.
  useEffect(() => {
    if (isLoading) return
    checkAccess()
  }, [isLoading, checkAccess])

  // Lightweight per-route RBAC check — runs synchronously, no spinners.
  // If the user navigates to a route their role can't access, bounce them
  // to dashboard immediately instead of showing a loading screen.
  useEffect(() => {
    if (!role || !isAuthorized) return

    // The parent route is /staff — the ProtectedRoute wraps <AppLayout>.
    // Child paths are /staff/dashboard, /staff/calendar, etc.
    // canAccessRoute expects the full path.
    const path = location.pathname
    if (!canAccessRoute(path, role)) {
      console.log(`❌ [ProtectedRoute] Route denied for ${role}: ${path}`)
      toast.error('Access denied', { description: 'You do not have permission to access this page.' })
      navigate('/staff/dashboard', { replace: true })
    }
  }, [location.pathname, role, isAuthorized, navigate])

  // Reset when user logs out (userId goes from something → null)
  useEffect(() => {
    if (!isLoading && !userId && lastAuthKey.current && lastAuthKey.current !== 'none:none') {
      lastAuthKey.current = null
      setIsAuthorized(null)
    }
  }, [userId, isLoading])

  // --- Render ---

  if (isLoading || isAuthorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/30">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    )
  }

  if (!isAuthorized) {
    return null
  }

  return <>{children}</>
}
