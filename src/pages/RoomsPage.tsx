import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { blink } from '@/blink/client'
import { RoomType, Room } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, DollarSign } from 'lucide-react'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { bookingEngine } from '@/services/booking-engine'

export function RoomsPage() {
  const db = (blink.db as any)
  const { currency } = useCurrency()
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [properties, setProperties] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Original AMP Lodge room images from Firebase Storage
  const defaultRoomImages: Record<string, string> = {
    'deluxe room': '/static/images/rooms/deluxe.jpg',
    'executive suite': 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126885__9daf4942.jpg?alt=media&token=3cc7cdf2-0aa6-4bcb-b4fb-b53cbda42670',
    'standard room': 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126955__a81cd5a2.jpg?alt=media&token=bd934225-17a9-40b5-aa26-5d7f753e33a0',
    'family room': '/static/images/rooms/family.jpg',
    'presidential suite': '/static/images/rooms/presidential.jpg',
  }

  // Default fallback image
  const defaultImage = 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126968__549b9c12.jpg?alt=media&token=e394d361-a2f7-4da7-8287-accf09c773d7'

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [])

  useEffect(() => {
    loadRooms()
  }, [])

  const loadRooms = async () => {
    setLoading(true)
    try {
      // Force fresh fetch - use bookingEngine.getAllBookings() for consistent data structure
      const [typesData, roomsData, propertiesData, bookingsData] = await Promise.all([
        db.roomTypes.list({ orderBy: { createdAt: 'asc' } }),
        db.rooms.list({ orderBy: { createdAt: 'asc' } }),
        db.properties.list({ orderBy: { createdAt: 'desc' } }),
        bookingEngine.getAllBookings()
      ])

      // Add fallback images to room types that don't have them
      const typesWithImages = (typesData as RoomType[]).map(rt => ({
        ...rt,
        imageUrl: rt.imageUrl || defaultRoomImages[rt.name.toLowerCase()] || defaultImage
      }))

      // Debug: Log raw data to verify basePrice is being fetched
      console.log('Raw room types data:', typesData)
      console.log('Raw properties data:', propertiesData)

      // Process properties data to match room types
      const propertiesWithPrices = propertiesData.map((prop: any) => {
        const matchingType =
          typesWithImages.find((rt) => rt.id === prop.propertyTypeId) ||
          typesWithImages.find((rt) => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
        return {
          ...prop,
          roomTypeName: matchingType?.name || prop.propertyType || '',
          displayPrice: matchingType?.basePrice ?? 0
        }
      })

      setRoomTypes(typesWithImages)
      setRooms(roomsData as Room[])
      setProperties(propertiesWithPrices)
      setBookings(bookingsData)
    } catch (error) {
      console.error('Failed to load rooms:', error)
    } finally {
      setLoading(false)
    }
  }

  // Helper function to check if dates overlap
  const isDateOverlap = (start1: string, end1: string, start2: string, end2: string) => {
    const date1Start = new Date(start1)
    const date1End = new Date(end1)
    const date2Start = new Date(start2)
    const date2End = new Date(end2)

    return date1Start < date2End && date2Start < date1End
  }

  const getAvailableRoomCount = (typeId: string) => {
    // Use properties data to match backend data source
    const propertiesOfType = properties.filter(prop => {
      const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
        roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
      return matchingType?.id === typeId
    })

    // Get today's date in YYYY-MM-DD format for consistent comparison
    const todayIso = new Date().toISOString().split('T')[0]

    const availableProperties = propertiesOfType.filter(property => {
      // Skip rooms under maintenance
      if (property.status === 'maintenance') return false

      const hasCurrentBooking = bookings.some((booking: any) => {
        // Skip cancelled bookings
        if (booking.status === 'cancelled') return false

        // Only consider active booking statuses (match Dashboard logic)
        if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

        // bookingEngine.getAllBookings() returns dates.checkIn/checkOut structure
        const checkIn = booking.dates?.checkIn
        const checkOut = booking.dates?.checkOut

        // Check if this booking is for the same room
        if (booking.roomNumber !== property.roomNumber) return false

        // Check if booking is currently active: checkIn <= today AND checkOut > today
        const checkInStr = typeof checkIn === 'string' ? checkIn.split('T')[0] : ''
        const checkOutStr = typeof checkOut === 'string' ? checkOut.split('T')[0] : ''

        const isActive = checkInStr <= todayIso && checkOutStr > todayIso

        if (isActive) {
          console.log(`[RoomsPage] Room ${property.roomNumber} blocked by booking: status=${booking.status}, checkIn=${checkInStr}, checkOut=${checkOutStr}, today=${todayIso}`)
        }

        return isActive
      })

      return !hasCurrentBooking
    })

    console.log(`[RoomsPage] Type ${typeId}: ${propertiesOfType.length} total, ${availableProperties.length} available`)
    return availableProperties.length
  }

  if (loading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading rooms...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-20">
      {/* Header */}
      <section className="bg-gradient-to-br from-primary/10 via-secondary to-accent/10 py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-foreground mb-6 tracking-tight">Our Rooms</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Discover your perfect accommodation among our carefully curated selection of luxury rooms
          </p>
        </div>
      </section>

      {/* Room Types */}
      <section className="py-20 bg-gradient-to-b from-background to-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
            {roomTypes.map((roomType) => {
              const availableCount = getAvailableRoomCount(roomType.id)
              // Ensure amenities is a string before splitting
              const amenitiesStr = typeof roomType.amenities === 'string' ? roomType.amenities : ''
              const amenitiesList = amenitiesStr.length > 0 ? amenitiesStr.split(',').map(a => a.trim()).filter(a => a) : []

              return (
                <Card key={roomType.id} className="overflow-hidden hover:shadow-2xl transition-all duration-300 flex flex-col h-full border-primary/10 hover:border-primary/25 bg-white group">
                  <div className="relative h-72 overflow-hidden">
                    <img
                      src={roomType.imageUrl}
                      alt={roomType.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    />
                    {availableCount > 0 && (
                      <div className="absolute top-4 right-4 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-semibold shadow-lg">
                        {availableCount} Available
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  </div>
                  <CardHeader className="pb-4 pt-6">
                    <CardTitle className="text-2xl font-serif mb-3 group-hover:text-primary transition-colors">{roomType.name}</CardTitle>
                    <CardDescription className="leading-relaxed text-base">{roomType.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 pb-5">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center text-muted-foreground">
                        <Users className="w-5 h-5 mr-2" />
                        <span className="text-sm font-medium">Up to {roomType.capacity} guests</span>
                      </div>
                      <div className="flex items-center text-primary font-bold">
                        <span className="text-3xl">{formatCurrencySync(roomType.basePrice, currency)}</span>
                        <span className="text-sm text-muted-foreground ml-1 font-normal">/night</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-foreground">Amenities:</p>
                      <div className="flex flex-wrap gap-2">
                        {amenitiesList.slice(0, 3).map((amenity, index) => (
                          <span
                            key={index}
                            className="text-xs bg-secondary/80 text-secondary-foreground px-3 py-1.5 rounded-lg font-medium"
                          >
                            {amenity}
                          </span>
                        ))}
                        {amenitiesList.length > 3 && (
                          <span className="text-xs text-muted-foreground px-3 py-1.5 font-medium">
                            +{amenitiesList.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="mt-auto pb-6">
                    <Link to={`/booking?roomType=${roomType.id}`} className="w-full">
                      <Button className="w-full py-6 text-base font-semibold shadow-md hover:shadow-lg bg-gradient-to-r from-primary via-primary to-accent hover:from-primary/95 hover:to-accent/95 transition-all duration-300" disabled={availableCount === 0}>
                        {availableCount > 0 ? 'Book Now' : 'Fully Booked'}
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
