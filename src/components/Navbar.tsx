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
    <nav className="sticky top-0 z-50 w-[94%] max-w-7xl mx-auto mt-3 rounded-2xl bg-gradient-to-r from-white/95 via-white/98 to-white/95 backdrop-blur-xl border border-primary/10 shadow-xl shadow-black/5 transition-all duration-300">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[64px] sm:h-[72px]">
          {/* Logo */}
          <Link to="/#hero" className="flex items-center space-x-2 group">
            <img 
              src="/amp.png" 
              alt="AMP Lodge" 
              className="h-8 w-auto sm:h-12 transition-transform duration-300 group-hover:scale-105" 
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`relative px-4 py-2 text-sm font-medium transition-all duration-300 rounded-xl ${
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
          <div className="flex items-center gap-3 md:hidden">
             <Link to="/booking" className="sm:hidden">
              <Button 
                size="sm" 
                className="h-9 px-4 text-xs bg-primary text-white font-semibold rounded-lg shadow-sm"
              >
                Book
              </Button>
            </Link>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-2 rounded-lg hover:bg-primary/10 transition-all duration-300 text-secondary-foreground/80 hover:text-primary active:scale-95"
              aria-label="Toggle menu"
            >
              {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <div className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out border-t border-primary/10 bg-gradient-to-b from-white/98 to-secondary/98 backdrop-blur-md rounded-b-2xl ${isOpen ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`}>
        <div className="px-4 py-6 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              onClick={() => setIsOpen(false)}
              className={`block px-4 py-3.5 text-base font-medium transition-all duration-300 rounded-xl ${
                isActive(link.path) 
                  ? 'text-primary bg-primary/10 shadow-inner' 
                  : 'text-secondary-foreground/80 hover:text-primary hover:bg-primary/5'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-4 px-2">
            <Link to="/booking" onClick={() => setIsOpen(false)} className="block">
              <Button 
                className="w-full h-12 text-base bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-white shadow-lg font-bold rounded-xl" 
                size="lg"
              >
                Book Now
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
