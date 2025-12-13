import React, { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Calendar, LayoutDashboard, List, History, Settings, MessageSquare, Tag, BarChart3, ReceiptText, ChevronDown, Sparkles, Users, LogOut, TrendingUp, FileText } from 'lucide-react'
import { useStaffRole } from '@/hooks/use-staff-role'
import { canAccessRoute } from '@/lib/rbac'
import { blink } from '@/blink/client'
import type { StaffRole } from '@/lib/rbac'

type StaffSidebarProps = {
  email?: string | null
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
  { label: 'Calendar', to: '/staff/calendar', icon: Calendar, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Rooms', to: '/staff/properties', icon: LayoutDashboard, minRole: ['owner', 'admin', 'manager'] },
  { label: 'Bookings', to: '/staff/bookings', icon: List, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Guests', to: '/staff/guests', icon: Users, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Housekeeping', to: '/staff/housekeeping', icon: Sparkles, minRole: ['owner', 'admin', 'manager', 'staff'] },
  { label: 'Channels', to: '/staff/channels', icon: MessageSquare, minRole: ['owner', 'admin', 'manager'] },
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
  { label: 'Employees', to: '/staff/employees', icon: Users, minRole: ['owner', 'admin'] },
  { label: 'Price list', to: '/staff/set-prices', icon: Tag, minRole: ['owner', 'admin'] },
  { label: 'Invoices', to: '/staff/invoices', icon: ReceiptText, minRole: ['owner', 'admin'] },
  { label: 'Analytics', to: '/staff/analytics', icon: TrendingUp, minRole: ['owner', 'admin'] },
  { label: 'Activity Logs', to: '/staff/activity-logs', icon: FileText, minRole: ['owner', 'admin'] },
  { label: 'Settings', to: '/staff/settings', icon: Settings, minRole: ['owner', 'admin'] },
]

export function StaffSidebar({ email }: StaffSidebarProps) {
  const { role, canManageEmployees, loading: isLoadingStaff } = useStaffRole()
  
  const [priceOpen, setPriceOpen] = useState(false)
  const submenuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  
  // While loading, show all items to prevent navigation flicker
  // Once loaded, filter based on role
  const visibleNavItems = isLoadingStaff || !role 
    ? navItems // Show all items while loading
    : navItems.filter(item => {
        if (!item.minRole) return true
        return item.minRole.includes(role)
      })
  
  // Filter price list items based on user role
  const visiblePriceListItems = isLoadingStaff || !role
    ? priceListItems // Show all items while loading
    : priceListItems.filter(item => {
        if (!item.minRole) return true
        return item.minRole.includes(role)
      })
  
  // Filter admin items based on user role
  // Show admin items for admin/owner, OR while loading to prevent flicker
  const visibleAdminItems = isLoadingStaff || !role || email === 'admin@amplodge.com'
    ? adminItems // Show admin items while loading or for admin email
    : adminItems.filter(item => item.minRole.includes(role))
  
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

  return (
    <aside className="hidden md:flex w-64 h-screen flex-col bg-[#0B1220] text-white/90">

      <div className="px-4 py-5 border-b border-white/10">
        <p className="text-xs uppercase tracking-widest text-white/60">Application</p>
        <p className="mt-2 text-sm text-white/80 truncate" title={email || ''}>{email || 'Staff'}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {/* Main navigation items */}
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.disabled ? '#' : item.to}
            aria-disabled={item.disabled}
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

      <div className="p-4 border-t border-white/10 text-[11px] text-white/60">
        © AMP Lodge
      </div>
    </aside>
  )
}

export default StaffSidebar
