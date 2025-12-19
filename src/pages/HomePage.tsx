import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { blink } from '@/blink/client'
import { RoomType } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Bed, Coffee, Wifi, Car, Utensils, Dumbbell, PlayCircle, Users, DollarSign } from 'lucide-react'
import { CTASection } from '@/components/ui/cta-with-glow'
import { formatCurrencySync } from '@/lib/utils'

import { useCurrency } from '@/hooks/use-currency'
import { ReviewsCarousel } from '@/components/landing/ReviewsCarousel'

export function HomePage() {
  const db = (blink.db as any)
  const { currency } = useCurrency()
  const amenities = [
    { icon: Bed, label: 'Luxury Rooms' },
    { icon: Wifi, label: 'Free WiFi' },
    { icon: Utensils, label: 'Fine Dining' },
    { icon: Coffee, label: 'Café & Bar' },
    { icon: Car, label: 'Free Parking' },
    { icon: Dumbbell, label: 'Fitness Center' }
  ]

  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const location = useLocation()

  // Original AMP Lodge room images from Firebase Storage
  const originalRoomImages: Record<string, string> = {
    'deluxe room': 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126952__6eca0552.jpg?alt=media&token=7eef0142-a5f2-4464-bfe7-03ac326e8125',
    'executive suite': 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126885__9daf4942.jpg?alt=media&token=3cc7cdf2-0aa6-4bcb-b4fb-b53cbda42670',
    'standard room': 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126955__a81cd5a2.jpg?alt=media&token=bd934225-17a9-40b5-aa26-5d7f753e33a0',
    'family room': 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635127046__b3813c4a.jpg?alt=media&token=4661db91-76d6-4406-aa45-763924bb2647',
  }
  // Default fallback if no match found
  const defaultImage = 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126968__549b9c12.jpg?alt=media&token=e394d361-a2f7-4da7-8287-accf09c773d7'

  useEffect(() => {
    // Load a few room types for the landing section
    const load = async () => {
      try {
        const types = await db.roomTypes.list()
        // Filter and keep all room types (show up to 3)
        const filtered = (types as RoomType[]).filter(t => t.name)

        // Use original Firebase images as fallback
        const typesWithImages = filtered.map(rt => ({
          ...rt,
          imageUrl: rt.imageUrl || originalRoomImages[rt.name.toLowerCase()] || defaultImage
        }))

        setRoomTypes(typesWithImages.slice(0, 3))
      } catch (e) {
        console.error('Failed to load room types for home:', e)
      } finally {
        setLoadingRooms(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    // Smooth scroll to section when hash changes (/#rooms or /#location)
    if (location.hash) {
      const id = location.hash.replace('#', '')
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [location.hash])

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section id="hero" className="relative min-h-[90svh] sm:min-h-screen flex items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center before:absolute before:inset-0 before:bg-gradient-to-b before:from-black/40 before:via-black/20 before:to-black/50"
          style={{
            backgroundImage: `url('https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126960__33431230.jpg?alt=media&token=be2c31b0-dce3-4eb6-9de9-022beeb03dd7')`,
            filter: 'brightness(1.1) contrast(1.08)'
          }}
        />
        <div className="relative z-10 text-center px-4 max-w-5xl mx-auto pt-20">
          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-[5.5rem] font-serif font-bold text-white mb-7 drop-shadow-2xl animate-fade-in leading-[1.1] tracking-tight">
            Welcome to AMP Lodge
          </h1>
          <p className="text-xl sm:text-2xl md:text-3xl text-white/95 mb-12 animate-slide-up drop-shadow-lg font-light max-w-3xl mx-auto leading-relaxed">
            Your Premium Retreat in the Heart of Ghana
          </p>
          <div className="flex flex-col sm:flex-row gap-5 justify-center items-center animate-slide-up">
            <Link to="/rooms">
              <Button size="lg" className="text-lg px-12 py-7 bg-gradient-to-r from-primary via-primary to-accent hover:from-primary/95 hover:to-accent/95 shadow-2xl hover:shadow-accent/60 transition-all duration-300 text-white font-semibold rounded-xl">
                Explore Rooms
              </Button>
            </Link>
            <Link to="/virtual-tour">
              <Button size="lg" variant="outline" className="text-lg px-12 py-7 border-2 border-white/90 text-white bg-white/10 backdrop-blur-md hover:bg-white hover:text-primary transition-all duration-300 shadow-xl rounded-xl">
                <PlayCircle className="w-5 h-5 mr-2" />
                Virtual Tour
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Amenities Section */}
      <section className="py-28 bg-gradient-to-b from-background to-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6 tracking-tight">
              Premium Amenities
            </h2>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Experience comfort and luxury with our world-class facilities
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 lg:gap-8">
            {amenities.map((amenity, index) => {
              const Icon = amenity.icon
              return (
                <div
                  key={index}
                  className="group flex flex-col items-center text-center p-7 lg:p-9 rounded-2xl bg-white hover:bg-gradient-to-br hover:from-white hover:to-secondary/50 transition-all duration-300 hover:scale-[1.03] hover:shadow-xl shadow-sm border border-primary/8"
                >
                  <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-full bg-gradient-to-br from-primary/15 to-accent/15 flex items-center justify-center mb-5 transition-all duration-300 group-hover:scale-110 group-hover:from-primary/20 group-hover:to-accent/20">
                    <Icon className="w-8 h-8 lg:w-10 lg:h-10 text-primary" />
                  </div>
                  <p className="font-semibold text-foreground text-sm lg:text-base">{amenity.label}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Our Rooms Section (Landing) */}
      <section id="rooms" className="py-28 bg-gradient-to-b from-secondary/40 to-secondary/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6 tracking-tight">Our Rooms</h2>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              A glimpse of our most-loved room types. Explore comfort and elegance designed for your perfect stay.
            </p>
          </div>

          {loadingRooms ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
              {roomTypes.map((roomType, idx) => (
                <Card key={roomType.id} className="overflow-hidden hover:shadow-2xl transition-all duration-300 border-primary/10 hover:border-primary/25 group flex flex-col h-full bg-white" style={{ transform: `translateZ(${idx * 10}px)` }}>
                  <div className="relative h-72 overflow-hidden">
                    <img
                      src={roomType.imageUrl}
                      alt={roomType.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                      style={{
                        filter: 'blur(0px)',
                        transition: 'transform 0.7s ease, filter 0.3s ease'
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLImageElement).style.filter = 'blur(0.5px)'
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLImageElement).style.filter = 'blur(0px)'
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  </div>
                  <CardHeader className="pb-4 pt-6">
                    <CardTitle className="text-2xl font-serif mb-3 group-hover:text-primary transition-colors">{roomType.name}</CardTitle>
                    <CardDescription className="line-clamp-2 text-base leading-relaxed">{roomType.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-5 flex-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center text-muted-foreground">
                        <Users className="w-5 h-5 mr-2" />
                        <span className="text-sm font-medium">Up to {roomType.capacity} guests</span>
                      </div>
                      <div className="flex items-center text-primary font-bold">
                        <span className="text-3xl">{formatCurrencySync(roomType.basePrice, currency)}</span>
                        <span className="text-sm text-muted-foreground ml-1 font-normal">/night</span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0 mt-auto pb-6">
                    <Link to={`/booking?roomType=${roomType.id}`} className="w-full">
                      <Button className="w-full bg-gradient-to-r from-primary via-primary to-accent hover:from-primary/95 hover:to-accent/95 transition-all duration-300 py-6 text-base font-semibold shadow-md hover:shadow-lg">Book Now</Button>
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}

          <div className="text-center mt-20">
            <Link to="/rooms">
              <Button variant="outline" size="lg" className="px-12 py-7 text-lg border-2 hover:bg-primary hover:text-white hover:border-primary transition-all duration-300 shadow-sm hover:shadow-lg font-semibold">View All Rooms</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Section */}
      <section className="py-24 bg-secondary/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="order-2 md:order-1">
              <h2 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6 leading-tight">
                Experience Comfort and Culture
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed">
                Located at Abuakwa DKC Junction along the Kumasi–Sunyani Road, AMP Lodge offers a peaceful retreat just minutes from the vibrant heart of Kumasi. Enjoy modern comfort surrounded by the charm and hospitality that make Ghana truly special.
              </p>
              <ul className="space-y-4 mb-10">
                <li className="flex items-start text-foreground text-base md:text-lg">
                  <div className="w-2 h-2 rounded-full bg-accent mr-4 mt-2 flex-shrink-0" />
                  <span>Spacious, air-conditioned rooms with contemporary amenities</span>
                </li>
                <li className="flex items-start text-foreground text-base md:text-lg">
                  <div className="w-2 h-2 rounded-full bg-accent mr-4 mt-2 flex-shrink-0" />
                  <span>On-site restaurant serving delicious local and continental dishes</span>
                </li>
                <li className="flex items-start text-foreground text-base md:text-lg">
                  <div className="w-2 h-2 rounded-full bg-accent mr-4 mt-2 flex-shrink-0" />
                  <span>Relaxing lounge and garden area for unwinding after your day</span>
                </li>
                <li className="flex items-start text-foreground text-base md:text-lg">
                  <div className="w-2 h-2 rounded-full bg-accent mr-4 mt-2 flex-shrink-0" />
                  <span>Easy access to Kumasi’s landmarks, markets, and cultural attractions</span>
                </li>
              </ul>
              <div className="w-full flex justify-center">
                <Link to="/contact">
                  <Button size="lg" className="px-10 py-6 text-lg bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 transition-all duration-300 shadow-lg hover:shadow-xl">Get in Touch</Button>
                </Link>
              </div>
            </div>
            <div className="relative h-[450px] md:h-[550px] rounded-3xl overflow-hidden shadow-2xl order-1 md:order-2 border-4 border-white/50">
              <img
                src="https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F667864912__8dd3d0e9.jpg?alt=media&token=cc9c22e3-ff5d-4a97-970c-1460cf42d333"
                alt="AMP Lodge living room"
                className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Location Section */}
      <section id="location" className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-5">Location</h2>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Find us nestled amidst breathtaking landscapes. We're easy to reach and hard to leave.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-10 lg:gap-12 items-stretch">
            <div className="rounded-2xl overflow-hidden shadow-2xl border-2 border-primary/10 h-full min-h-[420px]">
              <iframe
                title="AMP Lodge Location"
                src="https://www.google.com/maps?q=AMP%20LODGE%2C%20Abuakwa%20DKC%20junction%2C%20Kumasi-Sunyani%20Rd%2C%20Kumasi%2C%20Ghana&output=embed"
                className="w-full h-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            <div className="space-y-6 bg-secondary/40 rounded-2xl p-8 shadow-lg border border-primary/5 h-full">
              <h3 className="text-3xl font-serif font-bold text-foreground">Getting Here</h3>
              <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
                From Kumasi city center or Kejetia Market, drive northwest along the Kumasi–Sunyani Road. Continue past Asrimaso until you reach Abuakwa DKC junction — AMP Lodge is located right at the junction on the Sunyani Road.
              </p>
              <div className="space-y-3 text-foreground/80 text-base md:text-lg">
                <p className="flex items-start">
                  <span className="font-semibold min-w-[100px]">Address:</span>
                  <span>AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana</span>
                </p>
                <p className="flex items-start">
                  <span className="font-semibold min-w-[100px]">Phone:</span>
                  <span>+233 55 500 9697</span>
                </p>
                <p className="flex items-start">
                  <span className="font-semibold min-w-[100px]">Email:</span>
                  <span>hello@amplodge.example</span>
                </p>
              </div>
              <div className="pt-4 flex justify-center md:justify-start">
                <Button asChild variant="outline" size="lg" className="px-8 py-5 text-base border-2 hover:bg-primary hover:text-white hover:border-primary transition-all duration-300">
                  <Link to="/contact">Contact Us</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Guest Reviews Section */}
      <ReviewsCarousel />

      {/* Call to Action */}
      <section className="py-12 bg-gradient-to-br from-primary/10 via-secondary to-accent/10 text-secondary-foreground">
        <CTASection
          title="Ready to Experience Home Away From Home?"
          action={{ text: "Book Your Stay Now", href: "/booking", variant: "default" }}
        />
      </section>
    </div>
  )
}
