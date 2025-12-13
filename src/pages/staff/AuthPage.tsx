import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { blink } from '../../blink/client'
import { activityLogService } from '@/services/activity-log-service'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Calendar, Users, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  // Check auth state but don't auto-redirect - require manual login
  useEffect(() => {
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      // Don't auto-redirect - let user manually authenticate
      // This ensures explicit login process
    })
    return unsubscribe
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      console.log('🚀 [AuthPage] Starting optimized authentication...')
      
      if (mode === 'signin') {
        await blink.auth.signInWithEmail(email, password)
        console.log('✅ [AuthPage] Sign in successful')
        
        // Initialize activity logging with current user
        const user = await blink.auth.me()
        if (user) {
          activityLogService.setCurrentUser(user.id)
          // Log the login activity
          await activityLogService.logUserLogin(user.id, {
            email: user.email,
            role: 'staff', // Will be updated by role detection
          }).catch(err => console.error('Failed to log login activity:', err))
        }
        
        toast.success('Welcome back!')
        navigate('/staff/dashboard', { replace: true })
      } else {
        await blink.auth.signUp({ email, password })
        console.log('✅ [AuthPage] Sign up successful')
        toast.success('Account created successfully!')
        navigate('/staff/dashboard', { replace: true })
      }
    } catch (error: any) {
      console.error('❌ [AuthPage] Authentication failed:', error)
      toast.error(error.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center">
        {/* Left side - Branding */}
        <div className="hidden lg:block space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg overflow-hidden">
                <img src="/amp.png" alt="AMP Lodge" className="w-full h-full object-contain" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">AMP Lodge</h1>
                <p className="text-muted-foreground">Property Management System</p>
              </div>
            </div>
            <p className="text-lg text-foreground/80">
              Manage your properties, bookings, and guests in one powerful platform
            </p>
          </div>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Calendar className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Smart Calendar</h3>
                <p className="text-sm text-muted-foreground">
                  Visual booking calendar with drag-and-drop management
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Guest Management</h3>
                <p className="text-sm text-muted-foreground">
                  Keep track of all your guests and their booking history
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Revenue Analytics</h3>
                <p className="text-sm text-muted-foreground">
                  Real-time insights into your property performance
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right side - Auth form */}
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle>{mode === 'signin' ? 'Welcome back' : 'Create account'}</CardTitle>
            <CardDescription>
              {mode === 'signin'
                ? 'Enter your credentials to access your dashboard'
                : 'Get started with your property management system'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Sign up'}
              </Button>

              <div className="text-center text-sm">
                {mode === 'signin' ? (
                  <p className="text-muted-foreground">
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('signup')}
                      className="text-primary hover:underline font-medium"
                    >
                      Sign up
                    </button>
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('signin')}
                      className="text-primary hover:underline font-medium"
                    >
                      Sign in
                    </button>
                  </p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
