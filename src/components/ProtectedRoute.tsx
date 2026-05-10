import { ReactNode, useEffect, useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useStaffRole } from '@/hooks/use-staff-role'
import { canAccessRoute, ROUTE_ACCESS } from '@/lib/rbac'
import { toast } from 'sonner'
import { Loader2, WifiOff } from 'lucide-react'
import { db, auth } from '@/lib/db'
import { useNetworkStatus } from '@/lib/network-status'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { role, isLoading, userId } = useStaffRole()
  const { isOnline } = useNetworkStatus()
  const navigate = useNavigate()
  const location = useLocation()
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)
  const isCheckingRef = useRef(false)

  useEffect(() => {
    // Skip checking if still loading auth state
    if (isLoading) return

    // Prevent re-checking if we already have a result for this location
    if (isCheckingRef.current) return

    async function checkAccess() {
      isCheckingRef.current = true

      // 1. If no userId, redirect to login
      if (!userId) {
        if (!isOnline) {
          toast.error('Offline', {
            description: 'No cached session. Please connect to the internet and log in.',
          })
          setIsAuthorized(false)
          isCheckingRef.current = false
          return
        }

        console.log('❌ [ProtectedRoute] No userId found, redirecting to login')
        const returnTo = encodeURIComponent(location.pathname + location.search)
        navigate(`/staff/login?returnTo=${returnTo}`, { replace: true })
        setIsAuthorized(false)
        isCheckingRef.current = false
        return
      }

      // 2. If we have a userId but no role, check if it's the admin fallback
      if (!role) {
        try {
          const user = await auth.me()
          if (user?.email === import.meta.env.VITE_ADMIN_EMAIL) {
            console.log('✅ [ProtectedRoute] Admin user detected (fallback)')
            setIsAuthorized(true)
            isCheckingRef.current = false
            return
          }
        } catch (e) {
          console.error('❌ [ProtectedRoute] Auth verify failed:', e)
        }

        console.log('❌ [ProtectedRoute] User without role, redirecting')
        toast.error('Access denied', {
          description: 'No staff role found for your account.'
        })
        navigate('/staff/login', { replace: true })
        setIsAuthorized(false)
        isCheckingRef.current = false
        return
      }

      // 3. If we have a role, check route access
      if (!canAccessRoute(location.pathname, role)) {
        console.log(`❌ [ProtectedRoute] Access denied for ${role} to ${location.pathname}`)
        toast.error('Access denied', {
          description: 'You do not have permission to access this page.'
        })
        navigate('/staff/dashboard', { replace: true })
        setIsAuthorized(false)
        isCheckingRef.current = false
        return
      }

      // 4. Access granted
      console.log(`✅ [ProtectedRoute] Access granted for ${role} to ${location.pathname}`)
      setIsAuthorized(true)
      isCheckingRef.current = false
    }

    checkAccess()
  }, [role, isLoading, userId, isOnline, navigate, location.pathname, location.search])

  // Reset authorization state when path changes significantly
  useEffect(() => {
    setIsAuthorized(null)
    isCheckingRef.current = false
  }, [location.pathname])

  // Show loading while checking auth
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

  // If not authorized (and haven't redirected yet), show nothing or an error
  if (!isAuthorized) {
    return null
  }

  return <>{children}</>
}
