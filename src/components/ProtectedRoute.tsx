import { ReactNode, useEffect, useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useStaffRole } from '@/hooks/use-staff-role'
import { canAccessRoute, ROUTE_ACCESS } from '@/lib/rbac'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { blink } from '@/blink/client'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { role, loading, userId } = useStaffRole()
  const navigate = useNavigate()
  const location = useLocation()
  const [hasChecked, setHasChecked] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const previousPathRef = useRef<string>('')
  const isCheckingRef = useRef(false)

  useEffect(() => {
    // Reset hasChecked when location changes to a different path
    if (previousPathRef.current !== location.pathname) {
      previousPathRef.current = location.pathname
      setHasChecked(false)
      setRetryCount(0)
      isCheckingRef.current = false
    }
  }, [location.pathname])

  useEffect(() => {
    // Prevent multiple simultaneous checks
    if (isCheckingRef.current) {
      return
    }

    // Don't do anything while still loading
    if (loading) {
      console.log('⏳ [ProtectedRoute] Still loading auth state...')
      return
    }

    isCheckingRef.current = true

    // If no userId at all, redirect to login
    if (!userId) {
      console.log('❌ [ProtectedRoute] No userId found, redirecting to login')
      navigate('/staff/login', { replace: true })
      setHasChecked(true)
      isCheckingRef.current = false
      return
    }

    // If we have a userId but no role yet, wait a bit more (role might be loading)
    if (userId && !role && retryCount < 3) {
      console.log(`🔄 [ProtectedRoute] User exists but role not loaded yet. Retry ${retryCount + 1}/3`)
      const timer = setTimeout(() => {
        isCheckingRef.current = false
        setRetryCount(prev => prev + 1)
      }, 500)
      return () => clearTimeout(timer)
    }

    // If we have userId but still no role after retries, check if it's the admin user
    if (userId && !role && retryCount >= 3) {
      console.log('⚠️ [ProtectedRoute] No role found after retries, checking if admin user')
      // For admin users, allow access even if role detection fails
      blink.auth.me().then(user => {
        if (user?.email === 'admin@amplodge.com') {
          console.log('✅ [ProtectedRoute] Admin user detected, allowing access without role')
          setHasChecked(true)
          isCheckingRef.current = false
        } else {
          console.log('❌ [ProtectedRoute] Non-admin user without role, redirecting to login')
          toast.error('Access denied', {
            description: 'No staff role found for your account. Please contact your administrator.'
          })
          navigate('/staff/login', { replace: true })
          setHasChecked(true)
          isCheckingRef.current = false
        }
      }).catch(() => {
        console.error('❌ [ProtectedRoute] Failed to verify user')
        navigate('/staff/login', { replace: true })
        setHasChecked(true)
        isCheckingRef.current = false
      })
      return
    }

    // If we have a role, check route access
    if (role) {
      const currentPath = location.pathname
      
      // Debug logging for History route specifically
      if (currentPath.includes('reservations/history')) {
        console.log('🔍 [ProtectedRoute] Checking History route access:', {
          currentPath,
          userRole: role,
          allowedRoles: ROUTE_ACCESS[currentPath],
          canAccess: canAccessRoute(currentPath, role)
        })
      }
      
      // Check if route access is defined for this path
      if (!canAccessRoute(currentPath, role)) {
        console.log(`❌ [ProtectedRoute] Access denied for ${role} to ${currentPath}`)
        toast.error('Access denied', {
          description: 'You do not have permission to access this page.'
        })
        navigate('/staff/dashboard', { replace: true })
        setHasChecked(true)
        isCheckingRef.current = false
        return
      }
      
      console.log(`✅ [ProtectedRoute] Access granted for ${role} to ${currentPath}`)
      setHasChecked(true)
      isCheckingRef.current = false
    }
  }, [role, loading, userId, navigate, retryCount, location.pathname])

  // Show loading while checking auth
  if (loading || !hasChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/30">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
