import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import type { StaffRole } from '@/lib/rbac'
import { activityLogService } from '@/services/activity-log-service'

export function StaffLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)

  // Password change dialog state
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    // Only check auth state to show loading state, but don't auto-redirect
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser(session.user)
        // Don't auto-redirect - let user manually login
      } else {
        setUser(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const getRoleDashboard = (role: StaffRole): string => {
    // All roles go to main dashboard for now
    // Could be customized per role in future
    return '/staff/dashboard'
  }

  const checkStaffAccess = async (userId: string) => {
    try {
      const { data: staff } = await supabase
        .from('staff')
        .select('*')
        .eq('user_id', userId)
        .limit(1)

      if (staff && staff.length > 0) {
        const staffRole = staff[0].role as StaffRole
        const dashboardPath = getRoleDashboard(staffRole)
        navigate(dashboardPath)
      }
    } catch (error) {
      console.error('Failed to check staff access:', error)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      console.log('🚀 [StaffLoginPage] Starting login process...')

      // Perform login with Supabase
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (authError) {
        console.error('❌ [StaffLoginPage] Auth error:', authError)
        const isNetworkError = authError.message?.toLowerCase().includes('fetch') ||
          authError.message?.toLowerCase().includes('network') ||
          authError.message?.toLowerCase().includes('abort') ||
          authError.message?.toLowerCase().includes('timeout') ||
          authError.message?.toLowerCase().includes('signal') ||
          authError.name === 'AuthRetryableFetchError' ||
          authError.name === 'AbortError'
        toast.error(
          isNetworkError
            ? 'Cannot reach the server. The service may be temporarily unavailable — please try again in a moment.'
            : authError.message || 'Login failed'
        )
        setLoading(false)
        return
      }

      const currentUser = authData.user
      if (!currentUser) {
        toast.error('Login failed - no user returned')
        setLoading(false)
        return
      }

      console.log('✅ [StaffLoginPage] User authenticated, checking staff access...')

      // Get staff record from Supabase
      const { data: staffResults, error: staffError } = await supabase
        .from('staff')
        .select('*')
        .eq('user_id', currentUser.id)
        .limit(1)

      if (staffError || !staffResults || staffResults.length === 0) {
        await supabase.auth.signOut()
        toast.error('You do not have staff access')
        setLoading(false)
        return
      }

      const staff = staffResults[0]

      // Check first_login flag - try multiple sources
      console.log('🔍 [StaffLoginPage] Checking first_login flag...')

      let isFirstLogin = false

      // First, try the users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('first_login')
        .eq('id', currentUser.id)
        .single()

      console.log('🔍 [StaffLoginPage] User data:', userData, 'error:', userError)

      if (userData && !userError) {
        isFirstLogin = userData.first_login === 1 || String(userData.first_login) === '1' || userData.first_login === true
        console.log('🔍 [StaffLoginPage] first_login from users table:', userData.first_login, '-> isFirstLogin:', isFirstLogin)
      } else if (userError) {
        // If no users record exists, this is likely a first login - create the record
        console.log('🔍 [StaffLoginPage] No users record found, creating one with first_login=1...')

        const { error: insertError } = await supabase
          .from('users')
          .insert({
            id: currentUser.id,
            email: currentUser.email,
            first_login: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })

        if (!insertError) {
          console.log('🔍 [StaffLoginPage] Created users record with first_login=1')
          isFirstLogin = true
        } else {
          console.warn('🔍 [StaffLoginPage] Failed to create users record:', insertError)
          // Still treat as first login for safety
          isFirstLogin = true
        }
      }

      console.log('🔐 [StaffLoginPage] isFirstLogin final value:', isFirstLogin)

      if (isFirstLogin) {
        console.log('🔐 [StaffLoginPage] First login detected, showing password change dialog')
        setShowPasswordChange(true)
        setLoading(false)
        return
      }

      // Role-based redirect
      const staffRole = staff.role as StaffRole
      const dashboardPath = getRoleDashboard(staffRole)

      // Log the login activity
      try {
        await activityLogService.logUserLogin(currentUser.id, {
          email: currentUser.email || '',
          role: staffRole,
          staffName: staff.name,
          loginAt: new Date().toISOString()
        })
      } catch (logError) {
        console.error('Failed to log login activity:', logError)
        // Don't fail the login if logging fails
      }

      console.log('🎉 [StaffLoginPage] Login successful, redirecting...')
      toast.success(`Welcome back, ${staff.name}!`)

      // Initialize activity logging with current user
      activityLogService.setCurrentUser(currentUser.id)

      navigate(returnTo ? decodeURIComponent(returnTo) : dashboardPath)
    } catch (error: any) {
      console.error('❌ [StaffLoginPage] Login failed:', error)
      toast.error(error.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters long')
      return
    }

    setChangingPassword(true)

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser?.id) {
        toast.error('Authentication error')
        return
      }

      // Change password using Supabase
      const { error: passwordError } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (passwordError) {
        throw passwordError
      }

      // Update first_login flag
      await supabase.from('users').update({
        first_login: 0
      }).eq('id', currentUser.id)

      toast.success('Password changed successfully!')
      setShowPasswordChange(false)
      navigate(returnTo ? decodeURIComponent(returnTo) : '/staff/dashboard')
    } catch (error: any) {
      console.error('Password change failed:', error)
      toast.error(error.message || 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  // Show login form regardless of auth state - require manual login

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-24 h-24 rounded-lg overflow-hidden flex items-center justify-center mx-auto mb-6">
            <img src="/amp.png" alt="AMP Lodge" className="w-full h-full object-contain" />
          </div>
          <CardTitle className="text-3xl font-serif">Staff Portal</CardTitle>
          <CardDescription>Sign in to access the management system</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@amplodge.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                Password
              </label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
          <div className="mt-6 text-center">
            <a href="/" className="text-sm text-muted-foreground hover:text-primary">
              ← Back to main site
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Password Change Dialog */}
      <Dialog open={showPasswordChange} onOpenChange={(open) => {
        if (!open) {
          toast.error('You must change your password to continue')
        }
      }}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Change Your Password</DialogTitle>
            <DialogDescription>
              For security, please create a new password. This is required on your first login.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min 8 characters)"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use at least 8 characters with a mix of letters, numbers, and symbols
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={changingPassword}>
              {changingPassword ? 'Changing Password...' : 'Change Password'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
