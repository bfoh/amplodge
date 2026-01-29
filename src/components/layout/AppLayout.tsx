import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import React from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '../ui/sheet'
import { activityLogService } from '@/services/activity-log-service'
import {
  LayoutDashboard,
  Calendar,
  Building2,
  BookOpen,
  Users,
  Network,
  BarChart3,
  Settings,
  Menu,
  LogOut,
  Bell,
  List,
  History,
  Tag,
  Sparkles,
  ChevronDown,
  UserCheck,
  ReceiptText,
  TrendingUp,
  FileText,
  Star,
  Megaphone
} from 'lucide-react'
import { blink } from '../../blink/client'
import { cn } from '../../lib/utils'
import { useStaffRole } from '../../hooks/use-staff-role'

const navigation = [
  { name: 'Dashboard', href: '/staff/dashboard', icon: LayoutDashboard },
  { name: 'Calendar', href: '/staff/calendar', icon: Calendar },
  { name: 'Rooms', href: '/staff/properties', icon: Building2 },
  { name: 'Bookings', href: '/staff/bookings', icon: BookOpen },
  { name: 'Guests', href: '/staff/guests', icon: Users },
  { name: 'Housekeeping', href: '/staff/housekeeping', icon: Sparkles },
  { name: 'Channels', href: '/staff/channels', icon: Network },
  { name: 'Reviews', href: '/staff/reviews', icon: Star },
  { name: 'Marketing', href: '/staff/marketing', icon: Megaphone },
  { name: 'Guest Requests', href: '/staff/requests', icon: Bell }
]

export function AppLayout() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const [reservationsOpen, setReservationsOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [scrollPosition, setScrollPosition] = useState(0)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Use the same hook that's working in EmployeesPage
  const { role, canManageEmployees, loading: isLoadingStaff } = useStaffRole()

  // Remember last known admin state to prevent flicker
  const lastKnownAdminStateRef = React.useRef<boolean>(false)

  // Fallback: Get current user directly as backup
  useEffect(() => {
    const getUser = async () => {
      try {
        const user = await blink.auth.me()
        setCurrentUser(user)
        console.log('🎨 [AppLayout] Current user:', user?.email)

        // If admin email, remember it
        if (user?.email === import.meta.env.VITE_ADMIN_EMAIL) {
          lastKnownAdminStateRef.current = true
        }
      } catch (error) {
        console.error('🎨 [AppLayout] Error getting user:', error)
      }
    }
    getUser()
  }, [])

  // Update last known admin state when role loads
  useEffect(() => {
    if (!isLoadingStaff && (role === 'admin' || role === 'owner' || canManageEmployees)) {
      lastKnownAdminStateRef.current = true
    }
  }, [isLoadingStaff, role, canManageEmployees])

  // Determine if user is admin - STABLE during loading to prevent flicker
  const isAdmin = React.useMemo(() => {
    // 1. User email is admin (highest priority)
    if (currentUser?.email === import.meta.env.VITE_ADMIN_EMAIL) {
      return true
    }

    // 2. While loading, use last known state to prevent flicker
    if (isLoadingStaff && lastKnownAdminStateRef.current) {
      return true
    }

    // 3. After loading, check actual permissions
    if (!isLoadingStaff && role && (role === 'admin' || role === 'owner' || canManageEmployees)) {
      return true
    }

    // 4. Default to false only if we're sure (not loading and no admin indicators)
    if (!isLoadingStaff && !role && !canManageEmployees) {
      return false
    }

    // 5. During loading with no previous admin state, default to false
    return false
  }, [currentUser?.email, isLoadingStaff, canManageEmployees, role])

  console.log('🎨 [AppLayout] Admin section state:', {
    role,
    canManageEmployees,
    isLoadingStaff,
    currentUserEmail: currentUser?.email,
    isAdmin,
    lastKnownAdminState: lastKnownAdminStateRef.current,
    timestamp: new Date().toISOString()
  })

  const handleLogout = async () => {
    try {
      // Log the logout activity before signing out
      const user = await blink.auth.me()
      if (user) {
        await activityLogService.logUserLogout(user.id, { email: user.email }).catch(err =>
          console.error('Failed to log logout activity:', err)
        )
      }
    } catch (error) {
      console.error('Failed to get current user for logout logging:', error)
    }

    await blink.auth.logout()
  }

  // Functions to preserve scroll position when dropdowns open
  const saveScrollPosition = () => {
    if (scrollAreaRef.current) {
      const currentScrollTop = scrollAreaRef.current.scrollTop
      setScrollPosition(currentScrollTop)
      console.log('📍 [AppLayout] Saved scroll position:', currentScrollTop, 'scrollAreaRef exists:', !!scrollAreaRef.current)
    } else {
      console.log('📍 [AppLayout] Cannot save scroll position - scrollAreaRef is null')
    }
  }

  const restoreScrollPosition = () => {
    console.log('📍 [AppLayout] Attempting to restore scroll position:', scrollPosition, 'scrollAreaRef exists:', !!scrollAreaRef.current)
    if (scrollAreaRef.current && scrollPosition > 0) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (scrollAreaRef.current) {
          scrollAreaRef.current.scrollTop = scrollPosition
          console.log('📍 [AppLayout] Restored scroll position to:', scrollPosition, 'actual scrollTop:', scrollAreaRef.current.scrollTop)
        }
      })
    }
  }

  const handleReservationsToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('📍 [AppLayout] Reservations toggle clicked, current scrollTop:', scrollAreaRef.current?.scrollTop)

    // Store current scroll position before state change
    const currentScroll = scrollAreaRef.current?.scrollTop || 0
    setScrollPosition(currentScroll)

    setReservationsOpen((v) => !v)

    // Immediately restore scroll position
    setTimeout(() => {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTop = currentScroll
        console.log('📍 [AppLayout] Immediate scroll restoration to:', currentScroll)
      }
    }, 0)
  }

  const handlePriceToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('📍 [AppLayout] Price toggle clicked, current scrollTop:', scrollAreaRef.current?.scrollTop)

    // Store current scroll position before state change
    const currentScroll = scrollAreaRef.current?.scrollTop || 0
    setScrollPosition(currentScroll)

    setPriceOpen((v) => !v)

    // Immediately restore scroll position
    setTimeout(() => {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTop = currentScroll
        console.log('📍 [AppLayout] Immediate scroll restoration to:', currentScroll)
      }
    }, 0)
  }

  // Restore scroll position after dropdown state changes
  useLayoutEffect(() => {
    console.log('📍 [AppLayout] useLayoutEffect triggered, reservationsOpen:', reservationsOpen, 'priceOpen:', priceOpen, 'scrollPosition:', scrollPosition)
    restoreScrollPosition()
  }, [reservationsOpen, priceOpen])

  // Multiple restoration attempts with different timings
  useEffect(() => {
    if (scrollPosition > 0) {
      // First attempt - immediate
      const immediateId = setTimeout(() => {
        if (scrollAreaRef.current && scrollPosition > 0) {
          scrollAreaRef.current.scrollTop = scrollPosition
          console.log('📍 [AppLayout] Immediate backup restoration to:', scrollPosition)
        }
      }, 0)

      // Second attempt - after 10ms
      const shortId = setTimeout(() => {
        if (scrollAreaRef.current && scrollPosition > 0) {
          scrollAreaRef.current.scrollTop = scrollPosition
          console.log('📍 [AppLayout] Short delay backup restoration to:', scrollPosition)
        }
      }, 10)

      // Third attempt - after 50ms
      const longId = setTimeout(() => {
        if (scrollAreaRef.current && scrollPosition > 0) {
          scrollAreaRef.current.scrollTop = scrollPosition
          console.log('📍 [AppLayout] Long delay backup restoration to:', scrollPosition)
        }
      }, 50)

      return () => {
        clearTimeout(immediateId)
        clearTimeout(shortId)
        clearTimeout(longId)
      }
    }
  }, [reservationsOpen, priceOpen, scrollPosition])

  const currentTitle = (() => {
    const nav = navigation.find((item) => item.href === location.pathname)?.name
    if (nav) return nav
    if (location.pathname.startsWith('/staff/reservations/history')) return 'History'
    if (location.pathname.startsWith('/staff/reservations')) return 'Reservations'
    if (location.pathname === '/staff/set-prices') return 'Set prices'
    if (location.pathname === '/staff/analytics') return 'Analytics'
    if (location.pathname === '/staff/reviews') return 'Guest Reviews'
    if (location.pathname === '/staff/marketing') return 'Marketing Center'
    if (location.pathname === '/staff/requests') return 'Service Requests'
    return 'Dashboard'
  })()

  const SidebarContent = () => (
    <>
      <div className="flex items-end gap-4 px-6 border-b h-[72px]">
        <div className="w-16 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-transparent">
          <img src="/amp.png" alt="AMP Lodge" className="w-full h-full object-contain" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-lg truncate">AMP Lodge</h2>
          <p className="text-xs text-muted-foreground truncate leading-none">Property Management</p>
        </div>
      </div>

      <ScrollArea ref={scrollAreaRef} className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
                )}
              >
                <Icon className={cn("w-5 h-5 flex-shrink-0 transition-transform duration-200", isActive && "scale-110")} />
                <span>{item.name}</span>
              </Link>
            )
          })}

          {/* Reservations collapsible */}
          <div className="mt-4">
            <button
              type="button"
              onClick={handleReservationsToggle}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out group',
                reservationsOpen
                  ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
              )}
            >
              <List className={cn("w-5 h-5 transition-transform duration-200", reservationsOpen && "scale-110")} />
              <span className="flex-1 text-left">Reservations</span>
              <ChevronDown className={cn('w-4 h-4 transition-transform duration-300', reservationsOpen ? 'rotate-180' : 'rotate-0')} />
            </button>
            {reservationsOpen && (
              <div className="mt-2 space-y-1 pl-1">
                <Link
                  to="/staff/reservations"
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ml-4 border-l-2 pl-4',
                    location.pathname === '/staff/reservations'
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  )}
                >
                  <span className="text-[13px]">Reservation list</span>
                </Link>
                <Link
                  to="/staff/reservations/history"
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ml-4 border-l-2 pl-4',
                    location.pathname.startsWith('/staff/reservations/history')
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  )}
                >
                  <span className="text-[13px]">History</span>
                </Link>
              </div>
            )}
          </div>

          {/* Admin Section - Show for admin users */}
          {isAdmin && (
            <div className="mt-6 pt-6 border-t border-border/50">
              <p className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold opacity-70 mb-1">Admin</p>
              <Link
                to="/staff/employees"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out',
                  location.pathname === '/staff/employees'
                    ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
                )}
              >
                <UserCheck className="w-5 h-5 flex-shrink-0" />
                <span>Employees</span>
              </Link>

              {/* Price list collapsible - Admin only */}
              <div className="mt-1">
                <button
                  type="button"
                  onClick={handlePriceToggle}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out group',
                    priceOpen
                      ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
                  )}
                >
                  <Tag className={cn("w-5 h-5 transition-transform duration-200", priceOpen && "scale-110")} />
                  <span className="flex-1 text-left">Price list</span>
                  <ChevronDown className={cn('w-4 h-4 transition-transform duration-300', priceOpen ? 'rotate-180' : 'rotate-0')} />
                </button>
                {priceOpen && (
                  <div className="mt-2 space-y-1 pl-1">
                    <Link
                      to="/staff/set-prices"
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ml-4 border-l-2 pl-4',
                        location.pathname === '/staff/set-prices'
                          ? 'border-primary text-primary bg-primary/5'
                          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                      )}
                    >
                      <span className="text-[13px]">Set prices</span>
                    </Link>
                  </div>
                )}
              </div>

              <Link
                to="/staff/invoices"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out',
                  location.pathname === '/staff/invoices'
                    ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
                )}
              >
                <ReceiptText className="w-5 h-5 flex-shrink-0" />
                <span>Invoices</span>
              </Link>
              <Link
                to="/staff/analytics"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out',
                  location.pathname === '/staff/analytics'
                    ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
                )}
              >
                <TrendingUp className="w-5 h-5 flex-shrink-0" />
                <span>Analytics</span>
              </Link>
              <Link
                to="/staff/activity-logs"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out',
                  location.pathname === '/staff/activity-logs'
                    ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
                )}
              >
                <FileText className="w-5 h-5 flex-shrink-0" />
                <span>Activity Logs</span>
              </Link>
              <Link
                to="/staff/email-diagnostics"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out',
                  location.pathname === '/staff/email-diagnostics'
                    ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
                )}
              >
                <Network className="w-5 h-5 flex-shrink-0" />
                <span>Email Diagnostics</span>
              </Link>
              <Link
                to="/staff/settings"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out',
                  location.pathname === '/staff/settings'
                    ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-black/5 translate-x-1'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
                )}
              >
                <Settings className="w-5 h-5 flex-shrink-0" />
                <span>Settings</span>
              </Link>
            </div>
          )}
        </nav>
      </ScrollArea>

      <div className="border-t p-4 bg-sidebar/50 backdrop-blur-sm">
        <Button
          onClick={handleLogout}
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </Button>
      </div>
    </>
  )

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 border-r border-border/60 bg-sidebar shadow-xl z-20">
        <SidebarContent />
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <div className="flex flex-col h-full">
                <SidebarContent />
              </div>
            </SheetContent>
          </Sheet>
          <h1 className="font-semibold">{currentTitle}</h1>
        </div>
        <Button variant="ghost" size="icon">
          <Bell className="w-5 h-5" />
        </Button>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="lg:flex items-end justify-between px-6 border-b hidden h-[72px]">
          <h1 className="text-2xl font-bold">{currentTitle}</h1>
          <Button variant="outline" size="icon">
            <Bell className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto pt-16 lg:pt-0">
          <div className="px-4 lg:px-6 py-4 lg:py-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
