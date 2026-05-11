import { useState, useEffect } from 'react'
import React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Button } from '../ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '../ui/sheet'
import { Menu, Bell } from 'lucide-react'
import { auth } from '@/lib/db'
import { OfflineIndicator } from '../OfflineIndicator'
import { StaffSidebar } from './StaffSidebar'

export function AppLayout() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)

  useEffect(() => {
    const getUser = async () => {
      try {
        const user = await auth.me()
        setCurrentUser(user)
      } catch (error) {
        console.error('🎨 [AppLayout] Error getting user:', error)
      }
    }
    getUser()
  }, [])

  const currentTitle = (() => {
    const path = location.pathname
    if (path.startsWith('/staff/reservations/history')) return 'History'
    if (path.startsWith('/staff/reservations')) return 'Reservations'
    if (path === '/staff/calendar') return 'Calendar'
    if (path === '/staff/properties') return 'Rooms'
    if (path === '/staff/bookings') return 'Bookings'
    if (path === '/staff/guests') return 'Guests'
    if (path === '/staff/housekeeping') return 'Housekeeping'
    if (path === '/staff/channels') return 'Channels'
    if (path === '/staff/inventory') return 'Inventory'
    if (path === '/staff/employees') return 'Employees'
    if (path === '/staff/hr') return 'Human Resources'
    if (path === '/staff/set-prices') return 'Set prices'
    if (path === '/staff/invoices') return 'Invoices'
    if (path === '/staff/analytics') return 'Analytics'
    if (path === '/staff/activity-logs') return 'Activity Logs'
    if (path === '/staff/email-diagnostics') return 'Email Diagnostics'
    if (path === '/staff/settings') return 'Settings'
    if (path === '/staff/reviews') return 'Guest Reviews'
    if (path === '/staff/marketing') return 'Marketing Center'
    if (path === '/staff/requests') return 'Service Requests'
    if (path === '/staff/my-revenue') return 'My Revenue'
    return 'Dashboard'
  })()

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <StaffSidebar 
        email={currentUser?.email} 
        className="hidden lg:flex flex-col w-64 border-r border-border/60 bg-[#0B1220] shadow-xl z-20 text-white/90" 
      />

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-[60px] border-b bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 shadow-sm transition-all duration-300">
        <div className="flex items-center gap-2">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-primary/5 active:scale-95 transition-all">
                <Menu className="w-5 h-5 text-foreground/80" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0 border-none bg-transparent">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <StaffSidebar 
                email={currentUser?.email} 
                className="flex flex-col h-full bg-[#0B1220] text-white/90 shadow-2xl" 
                onNavigate={closeMobileMenu}
              />
            </SheetContent>
          </Sheet>
          <h1 className="text-lg font-bold tracking-tight text-foreground/90 truncate max-w-[200px]">{currentTitle}</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-primary/5 active:scale-95 transition-all">
            <Bell className="w-5 h-5 text-foreground/70" />
          </Button>
          {currentUser?.avatar_url ? (
            <img src={currentUser.avatar_url} alt="Profile" className="w-8 h-8 rounded-full border border-primary/10" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
              <span className="text-[10px] font-bold text-primary">{(currentUser?.email?.[0] || 'A').toUpperCase()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="lg:flex items-center justify-between px-8 border-b hidden h-[72px] bg-white/50 backdrop-blur-sm">
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1220]">{currentTitle}</h1>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" className="rounded-full h-10 w-10 border-primary/10 hover:bg-primary/5 transition-all">
              <Bell className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <OfflineIndicator />
        <div className="flex-1 overflow-auto pt-[60px] lg:pt-0 scroll-smooth">
          <div className="px-4 lg:px-8 py-6 lg:py-10 max-w-[1600px] mx-auto w-full">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
