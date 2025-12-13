import { MapPin, Phone, Mail } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="bg-gradient-to-b from-secondary/50 to-secondary border-t border-primary/10 mt-auto">
      <div className="w-[94%] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

          {/* Contact Info */}
          <div>
            <h3 className="font-serif font-semibold text-foreground mb-5 text-lg"><Link to="/contact" className="hover:text-primary transition-colors">Contact Us</Link></h3>
            <div className="space-y-4">
              <div className="flex items-start space-x-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0 text-primary" />
                <span className="leading-relaxed">AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana</span>
              </div>
              <div className="flex items-center space-x-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Phone className="w-5 h-5 flex-shrink-0 text-primary" />
                <span>+233 55 500 9697</span>
              </div>
              <div className="flex items-center space-x-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Mail className="w-5 h-5 flex-shrink-0 text-primary" />
                <span>info@amplodge.org</span>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-serif font-semibold text-foreground mb-5 text-lg">Quick Links</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><a href="/rooms" className="hover:text-primary hover:translate-x-1 inline-block transition-all duration-200">Our Rooms</a></li>
              <li><a href="/gallery" className="hover:text-primary hover:translate-x-1 inline-block transition-all duration-200">Gallery</a></li>
              <li><a href="/contact" className="hover:text-primary hover:translate-x-1 inline-block transition-all duration-200">Contact</a></li>
              <li><a href="/booking" className="hover:text-primary hover:translate-x-1 inline-block transition-all duration-200">Book Now</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-primary/10 mt-10 pt-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 text-sm text-muted-foreground">
            <div className="flex flex-col items-start gap-4">
              <Link to="/" aria-label="Go to Home" className="hover:opacity-80 transition-opacity"><img src="/amp.png" alt="AMP Lodge" className="h-11 w-auto sm:h-14" /></Link>
              <p className="max-w-xs text-left leading-relaxed">Experience luxury in the heart of the Garden City of Ghana</p>
            </div>
            <p className="text-center md:text-right">&copy; {new Date().getFullYear()} AMP Lodge. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
