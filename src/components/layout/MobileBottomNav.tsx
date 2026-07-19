import React from 'react'
import { NavLink } from 'react-router-dom'
import { 
  LayoutDashboard,
  Calendar,
  ShoppingCart,
  List,
  History
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function MobileBottomNav() {
  const navItems = [
    { label: 'Dash', to: '/staff/dashboard', icon: LayoutDashboard },
    { label: 'Calendar', to: '/staff/calendar', icon: Calendar },
    { label: 'Sell', to: '/staff/log-sale', icon: ShoppingCart },
    { label: 'Bookings', to: '/staff/bookings', icon: List },
    { label: 'History', to: '/staff/reservations', icon: History },
  ]

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-xl border-t border-border/50 pb-safe shadow-[0_-1px_10px_rgba(0,0,0,0.05)] transition-all duration-300">
      <nav className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn(
              "flex flex-col items-center justify-center gap-1 w-full h-full transition-all duration-200",
              isActive 
                ? "text-primary scale-110" 
                : "text-muted-foreground hover:text-foreground active:scale-90"
            )}
          >
            <item.icon className={cn("w-5 h-5 transition-transform")} />
            <span className="text-[10px] font-medium tracking-tight leading-none">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
