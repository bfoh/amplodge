import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Button } from './ui/button'

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const location = useLocation()

  const isActive = (path: string) => location.pathname === path

  const navLinks = [
    { path: '/#hero', label: 'Home' },
    { path: '/rooms', label: 'Rooms' },
    { path: '/gallery', label: 'Gallery' },
    { path: '/contact', label: 'Contact' },
    { path: '/#location', label: 'Location' }
  ]

  return (
    <nav className="sticky top-0 z-50 w-[94%] max-w-7xl mx-auto mt-3 rounded-2xl bg-gradient-to-r from-white/95 via-white/98 to-white/95 backdrop-blur-xl border border-primary/10 shadow-xl shadow-black/5">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[72px]">
          {/* Logo */}
          <Link to="/#hero" className="flex items-center space-x-2 group">
            <img 
              src="/amp.png" 
              alt="AMP Lodge" 
              className="h-10 w-auto sm:h-12 transition-transform duration-300 group-hover:scale-105" 
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`relative px-5 py-2.5 text-sm font-medium transition-all duration-300 rounded-xl ${
                  isActive(link.path) 
                    ? 'text-primary bg-primary/8 shadow-sm' 
                    : 'text-foreground/70 hover:text-primary hover:bg-primary/5'
                }`}
              >
                {link.label}
                {isActive(link.path) && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1/3 h-0.5 bg-accent rounded-full" />
                )}
              </Link>
            ))}
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center space-x-4">
            <Link to="/booking">
              <Button 
                size="sm" 
                className="bg-gradient-to-r from-primary via-primary to-accent hover:from-primary/95 hover:to-accent/95 text-white shadow-md hover:shadow-xl transition-all duration-300 px-6 py-2.5 font-semibold"
              >
                Book Now
              </Button>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-primary/10 transition-all duration-300 text-secondary-foreground/80 hover:text-primary"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden border-t border-primary/10 bg-gradient-to-b from-secondary/98 to-background/98 backdrop-blur-md rounded-b-2xl">
          <div className="px-4 py-6 space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setIsOpen(false)}
                className={`block px-4 py-3 text-sm font-medium transition-all duration-300 rounded-lg ${
                  isActive(link.path) 
                    ? 'text-primary bg-primary/10' 
                    : 'text-secondary-foreground/80 hover:text-primary hover:bg-primary/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Link to="/booking" onClick={() => setIsOpen(false)} className="block pt-2">
              <Button 
                className="w-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-white shadow-md" 
                size="sm"
              >
                Book Now
              </Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  )
}
