import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { blink } from '@/blink/client'
import { RoomType, Room } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CalendarIcon, Check, ArrowLeft } from 'lucide-react'
import { format, differenceInDays } from 'date-fns'
import { toast } from 'sonner'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { bookingEngine, LocalBooking } from '@/services/booking-engine'
import { sendTransactionalEmail } from '@/services/email-service'
import { sendBookingConfirmationSMS } from '@/services/sms-service'

export function OnsiteBookingPage() {
  const db = (blink.db as any)
  const { currency } = useCurrency()
  const navigate = useNavigate()
  const [user, setUser] = useState<any>(null)
  const [step, setStep] = useState(1)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [properties, setProperties] = useState<any[]>([])
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>('')
  const [selectedRoomId, setSelectedRoomId] = useState<string>('')
  const [checkIn, setCheckIn] = useState<Date>()
  const [checkOut, setCheckOut] = useState<Date>()
  const [numGuests, setNumGuests] = useState(1)
  const [guestInfo, setGuestInfo] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    specialRequests: ''
  })
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mobile_money' | 'card'>('cash')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user)
      if (!state.user && !state.isLoading) {
        navigate('/staff')
      }
    })
    return unsubscribe
  }, [navigate])

  useEffect(() => {
    if (user) {
      loadData()
    }
  }, [user])

  const loadData = async () => {
    try {
      const [typesData, roomsData, propertiesData, bookingsData] = await Promise.all([
        db.roomTypes.list(),
        db.rooms.list(),
        db.properties.list({ orderBy: { createdAt: 'desc' } }),
        db.bookings.list({ limit: 500 })
      ])
      const normalize = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
      const filteredTypes = (typesData as RoomType[]).filter((t: any) => {
        const n = normalize(t.name)
        return n && !n.includes('executive suite')
      })

      // Process properties data to match room types
      const propertiesWithPrices = propertiesData.map((prop: any) => {
        const matchingType =
          filteredTypes.find((rt) => rt.id === prop.propertyTypeId) ||
          filteredTypes.find((rt) => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
        return {
          ...prop,
          roomTypeName: matchingType?.name || prop.propertyType || '',
          displayPrice: matchingType?.basePrice ?? 0
        }
      })

      // Process bookings to resolve roomId to roomNumber
      const processedBookings = bookingsData.map((booking: any) => {
        const room = roomsData.find((r: any) => r.id === booking.roomId)
        return {
          ...booking,
          roomNumber: room?.roomNumber || 'Unknown'
        }
      })

      setRoomTypes(filteredTypes)
      setRooms(roomsData)
      setProperties(propertiesWithPrices)
      setBookings(processedBookings)
    } catch (error) {
      console.error('Failed to load data:', error)
    }
  }

  const selectedRoomType = roomTypes.find(rt => rt.id === selectedRoomTypeId)
  const selectedRoom = rooms.find(r => r.id === selectedRoomId)

  const isOverlap = (aStart?: Date, aEnd?: Date, bStartIso?: string, bEndIso?: string) => {
    if (!aStart || !aEnd || !bStartIso || !bEndIso) return false
    const aS = aStart.getTime()
    const aE = aEnd.getTime()
    const bS = new Date(bStartIso).getTime()
    const bE = new Date(bEndIso).getTime()
    return aS < bE && bS < aE
  }

  // Calculate available rooms for a specific room type and date range
  const getAvailableRoomCount = (roomTypeId: string, checkInDate?: Date, checkOutDate?: Date) => {
    // Use properties data to match backend data source
    const propertiesOfType = properties.filter(prop => {
      const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
        roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
      return matchingType?.id === roomTypeId
    })

    // If no dates provided, just return total properties of this type
    if (!checkInDate || !checkOutDate) {
      return propertiesOfType.length
    }

    // Filter out properties that have overlapping bookings
    const availableProperties = propertiesOfType.filter(property => {
      const hasOverlappingBooking = bookings.some(booking => {
        // Skip cancelled bookings
        if (booking.status === 'cancelled') return false

        // Check if this booking is for the same room (match by room number)
        if (booking.roomNumber !== property.roomNumber) return false

        // Check if booking status indicates it's active
        if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

        // Check if dates overlap
        return isOverlap(checkInDate, checkOutDate, booking.checkIn, booking.checkOut)
      })

      return !hasOverlappingBooking
    })

    return availableProperties.length
  }

  const isBooked = (roomNumber: string) => {
    return bookings.some((b: any) =>
      b.roomNumber === roomNumber && ['reserved', 'confirmed', 'checked-in'].includes(b.status) &&
      isOverlap(checkIn, checkOut, b.checkIn, b.checkOut)
    )
  }

  const availableRooms = rooms.filter(
    r => r.roomTypeId === selectedRoomTypeId && r.status === 'available' && (!checkIn || !checkOut || !isBooked(r.roomNumber))
  )

  // Auto-assign first available room when a room type is selected
  useEffect(() => {
    if (!selectedRoomTypeId) {
      setSelectedRoomId('')
      return
    }
    const first = availableRooms.find(r => r.roomTypeId === selectedRoomTypeId)
    setSelectedRoomId(first?.id || '')
  }, [selectedRoomTypeId, rooms, bookings, checkIn, checkOut])

  // Calculate price based on current room type pricing
  const nights = checkIn && checkOut ? differenceInDays(checkOut, checkIn) : 0
  const pricePerNight = selectedRoomType?.basePrice || 0
  const totalPrice = nights > 0 ? nights * Number(pricePerNight) : 0

  // Generate a proper booking reference
  const generateBookingReference = (bookingId: string | null) => {
    if (!bookingId) return 'BOOKING'

    // Extract the last 8 characters and convert to uppercase
    const shortId = bookingId.slice(-8).toUpperCase()

    // Format as AMP-XXXX-XXXX (e.g., AMP-A1B2C3D4)
    return `AMP-${shortId.slice(0, 4)}-${shortId.slice(4, 8)}`
  }

  const handleBooking = async () => {
    if (!checkIn || !checkOut || !selectedRoomId || !guestInfo.name || !guestInfo.email) {
      toast.error('Please fill in all required fields')
      return
    }

    // Check if the selected room is still available for the selected dates
    if (!selectedRoom) {
      toast.error('Selected room not found. Please refresh and try again.')
      return
    }

    // Double-check room availability to prevent double bookings
    if (isBooked(selectedRoom.roomNumber)) {
      toast.error('This room is no longer available for the selected dates. Please refresh the page and try again.')
      return
    }

    setLoading(true)
    try {
      // Save to local PouchDB first (works offline)
      const localBooking: Omit<LocalBooking, '_id' | 'createdAt' | 'updatedAt' | 'synced'> = {
        guest: {
          fullName: guestInfo.name,
          email: guestInfo.email,
          phone: guestInfo.phone,
          address: guestInfo.address
        },
        roomType: selectedRoomType?.name || '',
        roomNumber: selectedRoom?.roomNumber || '',
        dates: {
          checkIn: checkIn.toISOString(),
          checkOut: checkOut.toISOString()
        },
        numGuests,
        amount: totalPrice,
        status: 'confirmed',
        source: 'reception',
        payment: {
          method: paymentMethod,
          status: 'completed',
          amount: totalPrice,
          reference: `PAY-${Date.now()}`,
          paidAt: new Date().toISOString()
        }
      }

      const savedBooking = await bookingEngine.createBooking(localBooking)

      // bookingEngine.createBooking() already handles all remote database operations
      // including guest resolution and booking creation, so we don't need to create
      // another booking here.
      const bookingId = savedBooking._id.replace('booking_', 'booking-')

      if (bookingEngine.getOnlineStatus()) {
        // Mark local booking as synced
        await bookingEngine.updateBooking(savedBooking._id, { synced: true })

        const onsiteEmailPayload = {
          to: guestInfo.email,
          from: 'bookings@amplodge.org',
          subject: 'Booking Confirmation - AMP Lodge',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <div style="text-align: center; margin-bottom: 40px;">
                <h1 style="color: #8B6F47; font-family: 'Playfair Display', serif; font-size: 32px; margin: 0 0 8px 0;">AMP Lodge</h1>
                <p style="color: #666; font-size: 16px; margin: 0;">Your Serene and Affordable Hotel</p>
              </div>
              
              <div style="background: #F5F1E8; padding: 24px; border-radius: 12px; margin-bottom: 32px;">
                <h2 style="color: #2C2416; font-size: 24px; margin: 0 0 16px 0;">Booking Confirmed!</h2>
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0;">
                  Dear ${guestInfo.name},<br><br>
                  Thank you for choosing AMP Lodge. Your reservation has been confirmed.
                </p>
              </div>
              
              <div style="background: white; border: 1px solid #E5E5E5; border-radius: 12px; padding: 24px; margin-bottom: 32px;">
                <h3 style="color: #2C2416; font-size: 18px; margin: 0 0 16px 0; border-bottom: 2px solid #8B6F47; padding-bottom: 8px;">Reservation Details</h3>
                
                <div style="margin-bottom: 16px;">
                  <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Booking Reference</p>
                  <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${generateBookingReference(bookingId)}</p>
                </div>
                
                <div style="margin-bottom: 16px;">
                  <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Room Type</p>
                  <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${selectedRoomType?.name}</p>
                </div>
                
                <div style="margin-bottom: 16px;">
                  <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Room Number</p>
                  <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${selectedRoom?.roomNumber}</p>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                  <div>
                    <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Check-in</p>
                    <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${format(checkIn, 'MMM dd, yyyy')}</p>
                    <p style="color: #666; font-size: 14px; margin: 0;">After 3:00 PM</p>
                  </div>
                  <div>
                    <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Check-out</p>
                    <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${format(checkOut, 'MMM dd, yyyy')}</p>
                    <p style="color: #666; font-size: 14px; margin: 0;">Before 11:00 AM</p>
                  </div>
                </div>
                
                <div style="margin-bottom: 16px;">
                  <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Number of Nights</p>
                  <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${nights} night${nights > 1 ? 's' : ''}</p>
                </div>
                
                <div style="margin-bottom: 16px;">
                  <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Number of Guests</p>
                  <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${numGuests} guest${numGuests > 1 ? 's' : ''}</p>
                </div>
                
                ${guestInfo.specialRequests ? `
                <div style="margin-bottom: 16px;">
                  <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Special Requests</p>
                  <p style="color: #2C2416; font-size: 16px; margin: 0;">${guestInfo.specialRequests}</p>
                </div>
                ` : ''}
                
                <div style="border-top: 2px solid #E5E5E5; padding-top: 16px; margin-top: 16px;">
                  <p style="color: #2C2416; font-size: 18px; font-weight: 700; margin: 0;">Total Amount: <span style="color: #8B6F47; font-size: 24px;">${formatCurrencySync(totalPrice, currency)}</span></p>
                  <p style="color: #666; font-size: 14px; margin: 8px 0 0 0;">Payment Method: ${paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'mobile_money' ? 'Mobile Money' : 'Credit/Debit Card'}</p>
                  <p style="color: #22c55e; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">✓ Payment Received</p>
                </div>
              </div>
              
              <div style="text-align: center; padding-top: 24px; border-top: 1px solid #E5E5E5;">
                <p style="color: #666; font-size: 14px; margin: 0 0 16px 0;">
                  We look forward to welcoming you to AMP Lodge!
                </p>
                <p style="color: #999; font-size: 12px; margin: 0;">
                  This is an automated confirmation. For inquiries, contact us at info@amplodge.org
                </p>
              </div>
            </div>
          `,
          text: `
AMP Lodge - Booking Confirmation

Dear ${guestInfo.name},

Thank you for choosing AMP Lodge. Your reservation has been confirmed.

Booking Reference: ${generateBookingReference(bookingId)}
Room Type: ${selectedRoomType?.name}
Room Number: ${selectedRoom?.roomNumber}
Check-in: ${format(checkIn, 'MMM dd, yyyy')} (After 3:00 PM)
Check-out: ${format(checkOut, 'MMM dd, yyyy')} (Before 11:00 AM)
Number of Nights: ${nights}
Number of Guests: ${numGuests}
${guestInfo.specialRequests ? `Special Requests: ${guestInfo.specialRequests}` : ''}

Total Amount: ${formatCurrencySync(totalPrice, currency)}
Payment Method: ${paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'mobile_money' ? 'Mobile Money' : 'Credit/Debit Card'}
Payment Status: Received

We look forward to welcoming you to AMP Lodge!

For inquiries, contact us at info@amplodge.org
          `
        }

        sendTransactionalEmail(onsiteEmailPayload, 'Onsite booking confirmation').then(result => {
          if (!result.success) {
            console.error('[OnsiteBookingPage] Onsite confirmation email failed:', result.error)
          }
        })

        // Send SMS/WhatsApp confirmation (if phone number provided)
        if (guestInfo.phone) {
          sendBookingConfirmationSMS({
            phone: guestInfo.phone,
            guestName: guestInfo.name,
            roomNumber: selectedRoom?.roomNumber || '',
            checkIn: checkIn.toISOString(),
            checkOut: checkOut.toISOString(),
            bookingId: bookingId
          }).catch(err => console.error('[OnsiteBookingPage] SMS confirmation failed:', err))
        }
      }

      toast.success('Walk-in booking completed successfully!')
      navigate('/staff/dashboard')
    } catch (error) {
      console.error('Booking failed:', error)
      toast.error('Booking failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Authenticating...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      {/* Header */}
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/staff/dashboard')}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold">Walk-in Booking</h1>
              <p className="text-sm text-muted-foreground">Create onsite reservation</p>
            </div>
            <div className="w-32" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base transition-all duration-300 ${step >= s ? 'bg-gradient-to-br from-primary to-accent text-white shadow-lg' : 'bg-white border-2 border-secondary text-muted-foreground'
                  }`}
              >
                {step > s ? <Check className="w-6 h-6" /> : s}
              </div>
              {s < 4 && (
                <div
                  className={`w-12 sm:w-20 h-1 mx-2 rounded-full transition-all duration-300 ${step > s ? 'bg-gradient-to-r from-primary to-accent' : 'bg-secondary'}`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <Card className="border-primary/10 shadow-xl bg-white">
          <CardHeader className="pb-6">
            <CardTitle className="text-3xl font-serif mb-2">
              {step === 1 && 'Select Dates'}
              {step === 2 && 'Choose Room'}
              {step === 3 && 'Guest Details'}
              {step === 4 && 'Confirm & Process Payment'}
            </CardTitle>
            <CardDescription className="text-base">
              {step === 1 && 'When will the guest stay?'}
              {step === 2 && 'Select an available room'}
              {step === 3 && 'Enter guest information'}
              {step === 4 && 'Review booking and collect payment'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Step 1: Dates */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Check-in Date</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {checkIn ? format(checkIn, 'PPP') : 'Select date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={checkIn}
                          onSelect={setCheckIn}
                          disabled={(date) => {
                            const today = new Date()
                            today.setHours(0, 0, 0, 0)
                            return date < today
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Check-out Date</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {checkOut ? format(checkOut, 'PPP') : 'Select date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={checkOut}
                          onSelect={setCheckOut}
                          disabled={(date) => !checkIn || date <= checkIn}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Number of Guests</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={numGuests}
                    onChange={(e) => setNumGuests(parseInt(e.target.value))}
                  />
                </div>
              </div>
            )}

            {/* Step 2: Room Selection */}
            {step === 2 && (
              <div className="space-y-4">
                {roomTypes.map((roomType) => {
                  const available = getAvailableRoomCount(roomType.id, checkIn, checkOut)
                  return (
                    <div
                      key={roomType.id}
                      onClick={() => available > 0 && setSelectedRoomTypeId(roomType.id)}
                      className={`p-4 border rounded-lg cursor-pointer transition-all ${selectedRoomTypeId === roomType.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-primary/50'
                        } ${available === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg">{roomType.name}</h3>
                          <p className="text-sm text-muted-foreground">{roomType.description}</p>
                          <p className="text-sm mt-2">
                            <span className="font-medium">Capacity:</span> {roomType.capacity} guests
                          </p>
                          <p className="text-sm">
                            <span className="font-medium">Available:</span> {available} rooms
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-primary">{formatCurrencySync(roomType.basePrice, currency)}</p>
                          <p className="text-sm text-muted-foreground">per night</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Step 3: Guest Info */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Full Name *</label>
                  <Input
                    required
                    value={guestInfo.name}
                    onChange={(e) => setGuestInfo({ ...guestInfo, name: e.target.value })}
                    placeholder="Enter guest's full name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email *</label>
                  <Input
                    type="text"
                    required
                    value={guestInfo.email}
                    onChange={(e) => setGuestInfo({ ...guestInfo, email: e.target.value })}
                    placeholder="guest@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Phone</label>
                  <Input
                    type="tel"
                    value={guestInfo.phone}
                    onChange={(e) => setGuestInfo({ ...guestInfo, phone: e.target.value })}
                    placeholder="+233 XX XXX XXXX"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Address</label>
                  <Input
                    value={guestInfo.address}
                    onChange={(e) => setGuestInfo({ ...guestInfo, address: e.target.value })}
                    placeholder="Guest's address"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Special Requests</label>
                  <Textarea
                    rows={4}
                    value={guestInfo.specialRequests}
                    onChange={(e) => setGuestInfo({ ...guestInfo, specialRequests: e.target.value })}
                    placeholder="Any special requirements or requests?"
                  />
                </div>
              </div>
            )}

            {/* Step 4: Confirmation & Payment */}
            {step === 4 && (
              <div className="space-y-6">
                <div className="bg-secondary/50 p-6 rounded-lg space-y-4">
                  <div className="flex justify-between">
                    <span className="font-medium">Room:</span>
                    <span>{selectedRoomType?.name} - Room {selectedRoom?.roomNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Check-in:</span>
                    <span>{checkIn && format(checkIn, 'PPP')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Check-out:</span>
                    <span>{checkOut && format(checkOut, 'PPP')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Nights:</span>
                    <span>{nights}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Guests:</span>
                    <span>{numGuests}</span>
                  </div>
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-lg">Total Amount:</span>
                      <span className="text-primary text-2xl font-bold">{formatCurrencySync(totalPrice, currency)}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-secondary/50 p-6 rounded-lg">
                  <h3 className="font-semibold mb-2">Guest Information</h3>
                  <p className="text-sm">{guestInfo.name}</p>
                  <p className="text-sm">{guestInfo.email}</p>
                  {guestInfo.phone && <p className="text-sm">{guestInfo.phone}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Payment Method *</label>
                  <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">💵 Cash</SelectItem>
                      <SelectItem value="mobile_money">📱 Mobile Money</SelectItem>
                      <SelectItem value="card">💳 Credit/Debit Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between mt-8">
              <Button
                variant="outline"
                onClick={() => step === 1 ? navigate('/staff/dashboard') : setStep(step - 1)}
              >
                {step === 1 ? 'Cancel' : 'Back'}
              </Button>
              {step < 4 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={
                    (step === 1 && (!checkIn || !checkOut)) ||
                    (step === 2 && !selectedRoomTypeId) ||
                    (step === 3 && (!guestInfo.name || !guestInfo.email))
                  }
                >
                  Next
                </Button>
              ) : (
                <Button onClick={handleBooking} disabled={loading}>
                  {loading ? 'Processing...' : 'Complete Booking & Collect Payment'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
