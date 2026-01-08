import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { blink } from '@/blink/client'
import { RoomType, Room } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CalendarIcon, Check } from 'lucide-react'
import { format, differenceInDays, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { bookingEngine, LocalBooking } from '@/services/booking-engine'
import { OfflineStatusBanner } from '@/components/OfflineStatusBanner'
import { sendTransactionalEmail } from '@/services/email-service'
import { sendBookingConfirmationSMS } from '@/services/sms-service'

export function BookingPage() {
  const db = (blink.db as any)
  const { currency } = useCurrency()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
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
  const [isReceptionBooking, setIsReceptionBooking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bookings, setBookings] = useState<any[]>([])
  const [properties, setProperties] = useState<any[]>([])

  // Ensure we always land at the top of the page when navigating here
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [])

  useEffect(() => {
    const initializeData = async () => {
      // Load the data
      await loadData()
    }
    initializeData()
  }, [])

  useEffect(() => {
    const roomTypeParam = searchParams.get('roomType')
    if (roomTypeParam) {
      setSelectedRoomTypeId(roomTypeParam)
    }
  }, [searchParams])

  const loadData = async () => {
    try {
      const [typesData, roomsData, propertiesData, bookingsData] = await Promise.all([
        db.roomTypes.list(),
        db.rooms.list(),
        db.properties.list({ orderBy: { createdAt: 'desc' } }),
        db.bookings.list()
      ])
      const normalize = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
      const filteredTypes = (typesData as RoomType[]).filter(t => {
        const n = normalize((t as any).name)
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

  // Helper function to check if dates overlap
  const isDateOverlap = (start1: string, end1: string, start2: string, end2: string) => {
    const date1Start = new Date(start1)
    const date1End = new Date(end1)
    const date2Start = new Date(start2)
    const date2End = new Date(end2)

    return date1Start < date2End && date2Start < date1End
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

        // Skip inactive bookings (only consider active statuses)
        if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

        // Check if this booking is for the same room (match by room number)
        if (booking.roomNumber !== property.roomNumber) return false

        // Check if dates overlap
        return isDateOverlap(
          checkInDate.toISOString(),
          checkOutDate.toISOString(),
          booking.checkIn,
          booking.checkOut
        )
      })

      return !hasOverlappingBooking
    })

    return availableProperties.length
  }

  const selectedRoomType = roomTypes.find(rt => rt.id === selectedRoomTypeId)
  const selectedRoom = properties.find(p => p.id === selectedRoomId)
  const availableRooms = properties.filter(prop => {
    const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
      roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
    return matchingType?.id === selectedRoomTypeId
  })

  // Check if a specific room is available for given dates
  const isRoomAvailable = (roomNumber: string, checkInDate: Date, checkOutDate: Date) => {
    return !bookings.some(booking => {
      // Skip cancelled bookings
      if (booking.status === 'cancelled') return false

      // Skip inactive bookings (only consider active statuses)
      if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

      // Check if this booking is for the same room
      if (booking.roomNumber !== roomNumber) return false

      // Check if dates overlap
      return isDateOverlap(
        checkInDate.toISOString(),
        checkOutDate.toISOString(),
        booking.checkIn,
        booking.checkOut
      )
    })
  }

  // Find an available room for the selected room type and dates (used in confirmation step)
  const availableRoom = properties.find(prop => {
    const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
      roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())

    if (matchingType?.id !== selectedRoomTypeId) return false

    // If dates are selected, check if this room is available for those dates
    if (checkIn && checkOut) {
      return isRoomAvailable(prop.roomNumber, checkIn, checkOut)
    }

    // If no dates selected, just return the first room of this type
    return true
  })

  // Auto-assign first available room when a room type is selected
  useEffect(() => {
    if (!selectedRoomTypeId) {
      setSelectedRoomId('')
      return
    }

    // Find the first available room of the selected type
    const firstAvailable = properties.find(prop => {
      const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
        roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())

      if (matchingType?.id !== selectedRoomTypeId) return false

      // If dates are selected, check if this room is available for those dates
      if (checkIn && checkOut) {
        return isRoomAvailable(prop.roomNumber, checkIn, checkOut)
      }

      // If no dates selected, just return the first room of this type
      return true
    })

    setSelectedRoomId(firstAvailable?.id || '')
  }, [selectedRoomTypeId, checkIn, checkOut, properties, roomTypes, bookings])

  const nights = checkIn && checkOut ? differenceInDays(checkOut, checkIn) : 0
  const totalPrice = nights > 0 && selectedRoomType ? nights * selectedRoomType.basePrice : 0

  // Generate a proper booking reference
  const generateBookingReference = (bookingId: string | null) => {
    if (!bookingId) return 'BOOKING'

    // Extract the last 8 characters and convert to uppercase
    const shortId = bookingId.slice(-8).toUpperCase()

    // Format as AMP-XXXX-XXXX (e.g., AMP-A1B2C3D4)
    return `AMP-${shortId.slice(0, 4)}-${shortId.slice(4, 8)}`
  }

  const handleBooking = async () => {
    console.log('[BookingPage] handleBooking called with:', {
      checkIn,
      checkOut,
      selectedRoomId,
      selectedRoomTypeId,
      guestInfo: { name: guestInfo.name, email: guestInfo.email },
      selectedRoom,
      selectedRoomType,
      availableRoom,
      properties: properties.length,
      roomTypes: roomTypes.length
    })

    console.log('[BookingPage] Available room types:', roomTypes)
    console.log('[BookingPage] Available properties:', properties)
    console.log('[BookingPage] Selected room type:', selectedRoomType)
    console.log('[BookingPage] Available room:', availableRoom)

    if (!checkIn || !checkOut || !selectedRoomTypeId || !guestInfo.name || !guestInfo.email) {
      console.error('[BookingPage] Missing required fields:', {
        checkIn: !!checkIn,
        checkOut: !!checkOut,
        selectedRoomTypeId: !!selectedRoomTypeId,
        guestName: !!guestInfo.name,
        guestEmail: !!guestInfo.email
      })
      toast.error('Please fill in all required fields')
      return
    }

    // Check if the selected room is still available for the selected dates
    if (!availableRoom) {
      toast.error('No available rooms found for the selected room type and dates. Please try different dates or room type.')
      return
    }

    // Double-check room availability to prevent double bookings
    if (!isRoomAvailable(availableRoom.roomNumber, checkIn, checkOut)) {
      toast.error('This room is no longer available for the selected dates. Please refresh the page and try again.')
      return
    }

    console.log('[BookingPage] Selected room for booking:', availableRoom)

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
        roomNumber: availableRoom.roomNumber || '',
        dates: {
          checkIn: checkIn.toISOString(),
          checkOut: checkOut.toISOString()
        },
        numGuests,
        amount: totalPrice,
        status: 'confirmed',
        source: isReceptionBooking ? 'reception' : 'online',
        payment: {
          method: paymentMethod,
          status: bookingEngine.getOnlineStatus() ? 'completed' : 'pending',
          amount: totalPrice,
          reference: `PAY-${Date.now()}`,
          paidAt: new Date().toISOString()
        }
      }

      const savedBooking = await bookingEngine.createBooking(localBooking)

      // bookingEngine.createBooking() already handles all remote database operations
      // including guest resolution and booking creation, so we don't need to create
      // another booking here. We just need to get the booking ID for email purposes.
      let createdBookingId: string | null = savedBooking._id

      if (bookingEngine.getOnlineStatus()) {
        // The booking was already created by bookingEngine.createBooking()
        // Just mark it as synced
        await bookingEngine.updateBooking(savedBooking._id, { synced: true })

        // Send booking confirmation email (fire-and-forget)
        const bookingEmailPayload = {
          to: guestInfo.email,
          from: 'AMP Lodge Bookings <bookings@updates.amplodge.org>',
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
                <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${generateBookingReference(createdBookingId)}</p>
              </div>
              
              <div style="margin-bottom: 16px;">
                <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Room Type</p>
                <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${selectedRoomType?.name}</p>
              </div>
              
              <div style="margin-bottom: 16px;">
                <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">Room Number</p>
                <p style="color: #2C2416; font-size: 16px; font-weight: 600; margin: 0;">${availableRoom?.roomNumber}</p>
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
                <p style="color: #2C2416; font-size: 18px; font-weight: 700; margin: 0;">Total Amount : <span style="color: #8B6F47; font-size: 24px;">${formatCurrencySync(totalPrice, currency)}</span></p>
              </div>
            </div>
            
            <div style="background: #F5F1E8; padding: 24px; border-radius: 12px; margin-bottom: 32px;">
              <h3 style="color: #2C2416; font-size: 18px; margin: 0 0 16px 0;">What to Expect</h3>
              <ul style="color: #666; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>Check-in starts at 3:00 PM</li>
                <li>Early check-in available upon request (subject to availability)</li>
                <li>Complimentary Wi-Fi throughout the property</li>
                <li>24/7 front desk assistance</li>
                <li>Daily housekeeping service</li>
              </ul>
            </div>
            
            <div style="background: white; border: 1px solid #E5E5E5; border-radius: 12px; padding: 24px; margin-bottom: 32px;">
              <h3 style="color: #2C2416; font-size: 18px; margin: 0 0 16px 0;">Contact Information</h3>
              <p style="color: #666; font-size: 14px; line-height: 1.8; margin: 0;">
                <strong>AMP Lodge</strong><br>
                AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana<br>
                Phone: +233 55 500 9697<br>
                Email: info@amplodge.org
              </p>
            </div>
            
            <div style="text-align: center; padding-top: 24px; border-top: 1px solid #E5E5E5;">
              <p style="color: #666; font-size: 14px; margin: 0 0 16px 0;">
                We look forward to welcoming you to AMP Lodge!
              </p>
              <p style="color: #999; font-size: 12px; margin: 0;">
                This is an automated confirmation. Please do not reply to this email.<br>
                For inquiries, contact us at info@amplodge.org
              </p>
            </div>
          </div>
        `,
          text: `
AMP Lodge - Booking Confirmation

Dear ${guestInfo.name},

Thank you for choosing AMP Lodge. Your reservation has been confirmed.

Booking Reference: ${generateBookingReference(createdBookingId)}
Room Type: ${selectedRoomType?.name}
Room Number: ${availableRoom?.roomNumber}
Check-in: ${format(checkIn, 'MMM dd, yyyy')} (After 3:00 PM)
Check-out: ${format(checkOut, 'MMM dd, yyyy')} (Before 11:00 AM)
Number of Nights: ${nights}
Number of Guests: ${numGuests}
${guestInfo.specialRequests ? `Special Requests: ${guestInfo.specialRequests}` : ''}

Total Amount : ${formatCurrencySync(totalPrice, currency)}

What to Expect:
- Check-in starts at 3:00 PM
- Early check-in available upon request (subject to availability)
- Complimentary Wi-Fi throughout the property
- 24/7 front desk assistance
- Daily housekeeping service

Contact Information:
AMP Lodge
AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana
Phone: +233 55 500 9697
Email: info@amplodge.org

We look forward to welcoming you to AMP Lodge!

This is an automated confirmation. For inquiries, contact us at info@amplodge.org
        `
        }

        sendTransactionalEmail(bookingEmailPayload, 'Guest booking confirmation').then(result => {
          if (!result.success) {
            console.error('[BookingPage] Booking confirmation email failed:', result.error)
          }
        })

        // Send SMS/WhatsApp confirmation (if phone number provided)
        if (guestInfo.phone) {
          sendBookingConfirmationSMS({
            phone: guestInfo.phone,
            guestName: guestInfo.name,
            roomNumber: availableRoom?.roomNumber || '',
            checkIn: checkIn.toISOString(),
            checkOut: checkOut.toISOString(),
            bookingId: createdBookingId || savedBooking._id
          }).then(result => {
            if (!result.success && isReceptionBooking) {
              console.error('[BookingPage] SMS failed:', result.error)
              toast.warning(`Booking confirmed, but SMS failed: ${result.error}`)
            }
          }).catch(err => console.error('[BookingPage] SMS confirmation failed:', err))
        }

        // Send hotel alert for online booking (email + SMS to hotel)
        import('@/services/notifications').then(({ sendOnlineBookingAlert }) => {
          sendOnlineBookingAlert(
            { name: guestInfo.name, email: guestInfo.email, phone: guestInfo.phone || null },
            { roomNumber: availableRoom?.roomNumber || '', roomType: selectedRoomType?.name || '' },
            {
              id: createdBookingId || savedBooking._id,
              checkIn: checkIn.toISOString(),
              checkOut: checkOut.toISOString(),
              totalPrice,
              numGuests
            },
            'online'
          ).catch(err => console.error('[BookingPage] Hotel alert failed:', err))
        })

      }

      const offlineMessage = bookingEngine.getOnlineStatus()
        ? 'Booking confirmed! Check your email for details.'
        : 'Booking saved locally! It will sync when you\'re back online.'

      toast.success(offlineMessage)

      // Refresh data to update room availability before navigating away
      await loadData()

      navigate('/')
    } catch (error: any) {
      console.error('Booking failed:', error)
      const errorMessage = error?.message || 'Unknown error occurred'
      console.error('Full error details:', error)
      toast.error(`Booking failed: ${errorMessage}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <OfflineStatusBanner />
      <div className="min-h-screen pt-20 py-20 bg-gradient-to-b from-secondary/30 to-secondary/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-5xl font-serif font-bold tracking-tight">Book Your Stay</h1>
            {window.location.search.includes('admin=true') && (
              <Button
                variant="outline"
                onClick={() => setIsReceptionBooking(!isReceptionBooking)}
              >
                {isReceptionBooking ? '🏨 Reception Mode' : '💻 Online Mode'}
              </Button>
            )}
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-center mb-16">
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
                {step === 4 && 'Confirm Booking'}
              </CardTitle>
              <CardDescription className="text-base">
                {step === 1 && 'When would you like to stay?'}
                {step === 2 && 'Pick your perfect room'}
                {step === 3 && 'Tell us about yourself'}
                {step === 4 && 'Review and confirm'}
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
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Email *</label>
                    <Input
                      type="text"
                      required
                      value={guestInfo.email}
                      onChange={(e) => setGuestInfo({ ...guestInfo, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Phone</label>
                    <Input
                      type="tel"
                      value={guestInfo.phone}
                      onChange={(e) => setGuestInfo({ ...guestInfo, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Address</label>
                    <Input
                      value={guestInfo.address}
                      onChange={(e) => setGuestInfo({ ...guestInfo, address: e.target.value })}
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
                  <div>
                    <label className="block text-sm font-medium mb-2">Payment Method</label>
                    <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="mobile_money">Mobile Money</SelectItem>
                        <SelectItem value="card">Credit/Debit Card</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Step 4: Confirmation */}
              {step === 4 && (
                <div className="space-y-6">
                  <div className="bg-secondary/50 p-6 rounded-lg space-y-4">
                    <div className="flex justify-between">
                      <span className="font-medium">Room:</span>
                      <span>{selectedRoomType?.name} - Room {availableRoom?.roomNumber}</span>
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
                      <span className="font-bold text-lg">Total Amount : <span className="text-primary">{formatCurrencySync(totalPrice, currency)}</span></span>
                    </div>
                  </div>
                  <div className="bg-secondary/50 p-6 rounded-lg">
                    <h3 className="font-semibold mb-2">Guest Information</h3>
                    <p className="text-sm">{guestInfo.name}</p>
                    <p className="text-sm">{guestInfo.email}</p>
                    {guestInfo.phone && <p className="text-sm">{guestInfo.phone}</p>}
                  </div>
                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex justify-between mt-8">
                <Button
                  variant="outline"
                  onClick={() => setStep(step - 1)}
                  disabled={step === 1}
                >
                  Back
                </Button>
                {step < 4 ? (
                  <Button
                    onClick={() => setStep(step + 1)}
                    disabled={
                      (step === 1 && (!checkIn || !checkOut)) ||
                      (step === 2 && !selectedRoomTypeId)
                    }
                  >
                    Next
                  </Button>
                ) : (
                  <Button onClick={handleBooking} disabled={loading}>
                    {loading ? 'Processing...' : 'Confirm Booking'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
