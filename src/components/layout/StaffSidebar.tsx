import React, { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { 
  Calendar, 
  LayoutDashboard, 
  List, 
  History, 
  Settings, 
  MessageSquare, 
  Tag, 
  BarChart3, 
  ReceiptText, 
  ChevronDown, 
  Sparkles, 
  Users, 
  LogOut, 
  TrendingUp, 
  FileText, 
  Package,
  PlusCircle,
  Star,
  Megaphone,
  Briefcase,
  Home
} from 'lucide-react'
import { useStaffRole } from '@/hooks/use-staff-role'
import { useIsAdmin } from '@/hooks/use-is-admin'
import { canAccessRoute } from '@/lib/rbac'
import { db, auth } from '@/lib/db'
import type { StaffRole } from '@/lib/rbac'
import { SyncStatusBadge } from '@/components/SyncStatusBadge'
import { activityLogService } from '@/services/activity-log-service'
import { cn } from '@/lib/utils'

type StaffSidebarProps = {
  email?: string | null
  className?: string
  onNavigate?: () => void
}

interface NavItem {
  label: string
  to: string
  icon?: React.ComponentType<{ className?: string }>
  disabled?: boolean
  badge?: string | number
  indent?: boolean
  minRole?: StaffRole[] // Roles that can see this item
}

// Main navigation items with role-based access
const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/staff/dashboard', icon: LayoutDashboard, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Calendar', to: '/staff/calendar', icon: Calendar, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Rooms', to: '/staff/properties', icon: Home, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Bookings', to: '/staff/bookings', icon: List, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Reservations', to: '/staff/reservations', icon: History, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Onsite Booking', to: '/staff/onsite', icon: PlusCircle, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Guests', to: '/staff/guests', icon: Users, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Housekeeping', to: '/staff/housekeeping', icon: Sparkles, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Channels', to: '/staff/channels', icon: MessageSquare, minRole: ['owner', 'admin', 'manager'] },
  { label: 'My Revenue', to: '/staff/my-revenue', icon: BarChart3, minRole: ['owner', 'admin', 'manager', 'staff'] },
]

// Price list submenu items - Admin only
const priceListItems: NavItem[] = [
  { label: 'Set prices', to: '/staff/set-prices', minRole: ['owner', 'admin'] },
  { label: 'Additional services', to: '/staff/services', minRole: ['owner', 'admin', 'manager'] },
  { label: 'Meals', to: '/staff/meals', minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Local tax', to: '/staff/local-tax', minRole: ['owner', 'admin'] },
]

// Admin-only items that appear after expandable menus
const adminItems: Array<{
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  minRole: StaffRole[]
}> = [
    { label: 'Inventory', to: '/staff/inventory', icon: Package, minRole: ['owner', 'admin', 'manager'] },
    { label: 'Employees', to: '/staff/employees', icon: Users, minRole: ['owner', 'admin', 'manager'] },
    { label: 'HR', to: '/staff/hr', icon: Briefcase, minRole: ['owner', 'admin'] },
    { label: 'Invoices', to: '/staff/invoices', icon: ReceiptText, minRole: ['owner', 'admin', 'manager'] },
    { label: 'Analytics', to: '/staff/analytics', icon: TrendingUp, minRole: ['owner', 'admin', 'manager'] },
    { label: 'Marketing', to: '/staff/marketing', icon: Megaphone, minRole: ['owner', 'admin', 'manager', 'staff'] },
    { label: 'Guest Reviews', to: '/staff/reviews', icon: Star, minRole: ['owner', 'admin', 'manager', 'staff'] },
    { label: 'Service Requests', to: '/staff/requests', icon: MessageSquare, minRole: ['owner', 'admin', 'manager', 'staff'] },
    { label: 'Activity Logs', to: '/staff/activity-logs', icon: FileText, minRole: ['owner', 'admin', 'manager'] },
    { label: 'Settings', to: '/staff/settings', icon: Settings, minRole: ['owner', 'admin', 'manager'] },
  ]

export function StaffSidebar({ email, className, onNavigate }: StaffSidebarProps) {
  const { role, canManageEmployees, isLoading: isLoadingStaff } = useStaffRole()
  const { isAdmin } = useIsAdmin()
  const navigate = useNavigate()

  const [priceOpen, setPriceOpen] = useState(false)
  const submenuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // While loading, show all items to prevent navigation flicker
  // Once loaded, filter based on role (case-insensitive)
  const normalizedRole = role?.toLowerCase()
  
  const visibleNavItems = isLoadingStaff || !normalizedRole
    ? navItems // Show all items while loading
    : navItems.filter(item => {
      if (!item.minRole) return true
      return item.minRole.some(r => r.toLowerCase() === normalizedRole)
    })

  // Filter price list items based on user role
  const visiblePriceListItems = isLoadingStaff || !normalizedRole
    ? priceListItems // Show all items while loading
    : priceListItems.filter(item => {
      if (!item.minRole) return true
      return item.minRole.some(r => r.toLowerCase() === normalizedRole)
    })

  // Filter admin items by role. While loading, show all to prevent flicker
  const visibleAdminItems = isLoadingStaff || !normalizedRole || isAdmin
    ? adminItems
    : adminItems.filter(item => item.minRole.some(r => r.toLowerCase() === normalizedRole))

  // DIAGNOSTIC LOGGING
  useEffect(() => {
    console.log('[StaffSidebar Diagnostic]', {
      role,
      normalizedRole,
      isAdmin,
      isLoadingStaff,
      visibleNavItemsCount: visibleNavItems.length,
      visibleAdminItemsCount: visibleAdminItems.length,
      visibleNavLabels: visibleNavItems.map(i => i.label)
    })
  }, [role, normalizedRole, isAdmin, isLoadingStaff, visibleNavItems, visibleAdminItems])

  // Show price list section if user can access any price list items
  const showPriceListSection = visiblePriceListItems.length > 0

  // Close submenu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        priceOpen &&
        submenuRef.current &&
        buttonRef.current &&
        !submenuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setPriceOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [priceOpen])

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setPriceOpen((v) => !v)
    } else if (e.key === 'Escape' && priceOpen) {
      setPriceOpen(false)
      buttonRef.current?.focus()
    }
  }

  const handleLogout = async () => {
    try {
      const user = await auth.me()
      if (user) {
        await activityLogService.logUserLogout(user.id, { email: user.email }).catch(err =>
          console.error('Failed to log logout activity:', err)
        )
      }
    } catch (error) {
      console.error('Failed to get current user for logout logging:', error)
    }
    console.log('🔄 [StaffSidebar] Logging out user...')
    await auth.logout()
    navigate('/staff/login')
  }

  return (
    <aside className={cn(className, "flex h-full flex-col bg-[#0B1220] text-white/90 shadow-2xl transition-all duration-300")}>

      <div className="px-6 py-10 border-b border-white/5 flex flex-col items-center shrink-0">
        <div className="w-20 h-20 mb-5 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center overflow-hidden border border-white/10 shadow-2xl group transition-transform duration-500 hover:scale-105">
           <img 
            src="/amp.png" 
            alt="AMP Lodge" 
            className="w-14 h-14 object-contain transition-transform group-hover:rotate-3 duration-700" 
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const parent = e.currentTarget.parentElement;
              if (parent) {
                const icon = document.createElement('div');
                icon.className = 'w-12 h-12 flex items-center justify-center text-primary';
                icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-home"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
                parent.appendChild(icon);
              }
            }}
          />
        </div>
        <h2 className="text-xl font-serif font-bold text-white tracking-tight">AMP Lodge</h2>
        <p className="text-[10px] uppercase tracking-[0.25em] text-primary/60 font-semibold mt-1.5">Management Portal</p>
        {email && (
          <div className="mt-5 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 max-w-full">
            <p className="text-[10px] text-white/40 truncate w-full text-center" title={email}>
              {email}
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {/* Main navigation items */}
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.disabled ? '#' : item.to}
            aria-disabled={item.disabled}
            onClick={onNavigate}
            className={({ isActive }) => [
              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              item.indent ? 'ml-7' : '',
              item.disabled ? 'opacity-40 pointer-events-none' : 'hover:bg-white/10',
              isActive ? 'bg-white/10 text-white' : 'text-white/80'
            ].join(' ')}
          >
            <item.icon className="h-4 w-4" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge !== undefined && (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] px-1 text-white">
                {item.badge || '1'}
              </span>
            )}
          </NavLink>
        ))}

        {/* Price list collapsible - only show if user has access to any items */}
        {showPriceListSection && (
          <div>
            <button
              ref={buttonRef}
              type="button"
              onClick={() => setPriceOpen((v) => !v)}
              onKeyDown={handleKeyDown}
              aria-expanded={priceOpen}
              aria-controls="price-submenu"
              className={[
                'w-full group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                'hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20',
                priceOpen ? 'bg-white/10 text-white' : 'text-white/80'
              ].join(' ')}
            >
              <Tag className="h-4 w-4" />
              <span className="flex-1 truncate">Price list</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${priceOpen ? 'rotate-180' : 'rotate-0'}`} />
            </button>

            {priceOpen && (
              <div
                id="price-submenu"
                ref={submenuRef}
                className="mt-1 space-y-1"
                role="menu"
                aria-label="Price list submenu"
              >
                {visiblePriceListItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) => [
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ml-7',
                      'hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20',
                      isActive ? 'bg-white/10 text-white' : 'text-white/80'
                    ].join(' ')}
                    role="menuitem"
                  >
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.to === '/staff/local-tax' && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-rose-500 text-white text-[10px] px-2 py-0.5">NEW</span>
                    )}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin-only items - Employees and Invoices */}
        {visibleAdminItems.length > 0 && (
          <div className="mt-2 pt-2 border-t border-white/10">
            <p className="px-3 py-2 text-xs uppercase tracking-widest text-white/40">Admin</p>
            {visibleAdminItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) => [
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  'hover:bg-white/10',
                  isActive ? 'bg-white/10 text-white' : 'text-white/80'
                ].join(' ')}
              >
                <item.icon className="h-4 w-4" />
                <span className="flex-1 truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className="p-4 border-t border-white/10 space-y-3">
        <div className="bg-white/5 rounded-lg p-2">
          <SyncStatusBadge />
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
        >
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
        <div className="text-center text-[10px] text-white/40 pt-2">
          © AMP Lodge
        </div>
      </div>
    </aside>
  )
}

export default StaffSidebar
