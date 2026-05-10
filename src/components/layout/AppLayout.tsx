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
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 border-none bg-transparent">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <StaffSidebar 
                email={currentUser?.email} 
                className="flex flex-col h-full bg-[#0B1220] text-white/90" 
                onNavigate={closeMobileMenu}
              />
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

        <OfflineIndicator />
        <div className="flex-1 overflow-auto pt-16 lg:pt-0">
          <div className="px-4 lg:px-6 py-4 lg:py-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
