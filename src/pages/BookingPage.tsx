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
import { useBookingCart } from '@/context/BookingCartContext'
import { bookingEngine } from '@/services/booking-engine'
import { OfflineStatusBanner } from '@/components/OfflineStatusBanner'

export function BookingPage() {
  const db = (blink.db as any)
  const { currency } = useCurrency()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // Cart Context
  const { cartItems, addToCart, removeFromCart, clearCart, cartTotal, billingContact, setBillingContact } = useBookingCart()

  const [step, setStep] = useState(1) // 1: Search, 2: Cart/Room Selection, 3: Billing, 4: Guest Assignment, 5: Pay
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [properties, setProperties] = useState<any[]>([])

  // Search State (for adding new rooms)
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>('')
  const [selectedRoomId, setSelectedRoomId] = useState<string>('')
  const [checkIn, setCheckIn] = useState<Date | undefined>()
  const [checkOut, setCheckOut] = useState<Date | undefined>()
  const [numGuests, setNumGuests] = useState(1)

  // Checkout State
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mobile_money' | 'card' | 'not_paid'>('not_paid')
  const [isReceptionBooking, setIsReceptionBooking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bookings, setBookings] = useState<any[]>([])

  // Guest Assignment State (Map of tempId -> Guest Details)
  const [guestAssignments, setGuestAssignments] = useState<Record<string, { name: string, email: string }>>({})

  // Initialize billing contact form if not in context
  const [localBillingContact, setLocalBillingContact] = useState({
    name: billingContact?.fullName || '',
    email: billingContact?.email || '',
    phone: billingContact?.phone || '',
    address: billingContact?.address || '',
    specialRequests: ''
  })


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
        bookingEngine.getAllBookings()
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

      // Process bookings - bookingEngine.getAllBookings() already provides roomNumber
      // Only resolve roomId if roomNumber is missing
      const processedBookings = bookingsData.map((booking: any) => {
        if (booking.roomNumber) {
          return booking // Already has roomNumber from bookingEngine
        }
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

  // Helper function to check if dates overlap using strict YYYY-MM-DD comparison
  // This avoids timezone issues where "Jan 8 00:00" might be != "Jan 8 00:00" in different zones
  const isOverlap = (start1: Date | undefined, end1: Date | undefined, start2: string | Date | undefined, end2: string | Date | undefined) => {
    // Return false if any date is missing
    if (!start1 || !end1 || !start2 || !end2) return false

    // Normalize all inputs to YYYY-MM-DD strings
    const toDateStr = (d: string | Date): string => {
      if (typeof d === 'string') return d.split('T')[0]
      if (d instanceof Date && !isNaN(d.getTime())) {
        return format(d, 'yyyy-MM-dd')
      }
      return ''
    }

    const s1 = toDateStr(start1)
    const e1 = toDateStr(end1)
    const s2 = toDateStr(start2)
    const e2 = toDateStr(end2)

    // If any date string is empty, return false
    if (!s1 || !e1 || !s2 || !e2) return false

    return s1 < e2 && s2 < e1
  }

  // Calculate CURRENT availability for a room type (for display purposes - matches Dashboard)
  // This does NOT change when user selects dates - it shows real-time "rooms available now"
  const getCurrentAvailability = (roomTypeId: string) => {
    const propertiesOfType = properties.filter(prop => {
      const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
        roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
      return matchingType?.id === roomTypeId
    })

    // Get today's date in YYYY-MM-DD format
    const todayIso = new Date().toISOString().split('T')[0]

    const availableProperties = propertiesOfType.filter(property => {
      // Skip rooms under maintenance
      if (property.status === 'maintenance') return false

      // Check if room is currently occupied (TODAY)
      const hasCurrentBooking = bookings.some((booking: any) => {
        if (booking.status === 'cancelled') return false
        if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

        // Use dates.checkIn from bookingEngine
        const checkIn = booking.dates?.checkIn || booking.checkIn
        const checkOut = booking.dates?.checkOut || booking.checkOut

        if (booking.roomNumber !== property.roomNumber) return false

        // Check if booking is active TODAY: checkIn <= today < checkOut
        const checkInStr = typeof checkIn === 'string' ? checkIn.split('T')[0] : ''
        const checkOutStr = typeof checkOut === 'string' ? checkOut.split('T')[0] : ''

        return checkInStr <= todayIso && checkOutStr > todayIso
      })

      return !hasCurrentBooking
    })

    // Subtract rooms of this type that are in cart (regardless of dates)
    const cartCountForType = cartItems.filter(item => item.roomTypeId === roomTypeId).length

    return Math.max(0, availableProperties.length - cartCountForType)
  }

  // Calculate available rooms for a specific date range (used for validation when adding to cart)
  const getAvailableRoomCount = (roomTypeId: string, checkInDate?: Date, checkOutDate?: Date) => {
    // Use properties data to match backend data source
    const propertiesOfType = properties.filter(prop => {
      const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
        roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
      return matchingType?.id === roomTypeId
    })

    // If no dates provided, return current availability
    if (!checkInDate || !checkOutDate) {
      return getCurrentAvailability(roomTypeId)
    }

    const availableProperties = propertiesOfType.filter(property => {
      // 1. Check if room is under maintenance
      if (property.status === 'maintenance') return false

      // 2. Check for overlapping existing bookings
      const hasOverlappingBooking = bookings.some(booking => {
        // Skip cancelled bookings
        if (booking.status === 'cancelled') return false

        // Skip inactive bookings (only consider active statuses)
        if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

        // Handle both data structures: raw DB and normalized
        const bookingCheckIn = booking.checkIn || booking.dates?.checkIn
        const bookingCheckOut = booking.checkOut || booking.dates?.checkOut

        // Check if this booking is for the same room (match by room number)
        if (booking.roomNumber !== property.roomNumber) return false

        // Check if dates overlap
        return isOverlap(checkInDate, checkOutDate, bookingCheckIn, bookingCheckOut)
      })

      if (hasOverlappingBooking) return false

      // 3. Check if room is already in cart
      const isInCart = cartItems.some(item => {
        // Find existing room assignment in cart
        // Cart items might rely on auto-assignment or explicit roomNumber
        // If we implemented 'cart logic' where items aren't assigned a room yet, 
        // we should just check counts.
        // BUT, OnsiteBookingPage assigns roomNumber implicitly or explicitly?
        // Wait, website flow cartItems DO NOT HAVE roomNumber yet usually?
        // Let's check cartItem type.
        // Website BookingPage Cart Items usually just store RoomType + Dates.
        // It does NOT assign a specific Room ID until Checkout (handleFinalCheckout).
        // HOWEVER, to prevent overbooking, we must subtract the count of rooms of this TYPE in cart.

        // CORRECTION: The website flow is "Type Based" until checkout.
        // So we cannot filter by "roomNumber" for cart items if they don't have one.
        // Onsite flow assigns roomNumber immediately. 
        // Website flow (here): item = { roomTypeId, checkIn... }.

        return false // See below for count logic
      })

      return true
    })

    // 4. Subtract count of rooms of this TYPE already in cart for overlapping dates
    // Since website cart items don't hold specific room IDs, we just subtract the quantity used.
    const cartCountForType = cartItems.filter(item =>
      item.roomTypeId === roomTypeId &&
      isOverlap(checkInDate, checkOutDate, item.checkIn, item.checkOut)
    ).length

    return Math.max(0, availableProperties.length - cartCountForType)
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
    return !bookings.some((booking: any) => {
      // Skip cancelled bookings
      if (booking.status === 'cancelled') return false

      // Skip inactive bookings (only consider active statuses)
      if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

      // Check if this booking is for the same room
      if (booking.roomNumber !== roomNumber) return false

      // Handle both data structures: bookingEngine uses dates.checkIn, raw DB uses checkIn
      const bookingCheckIn = booking.dates?.checkIn || booking.checkIn
      const bookingCheckOut = booking.dates?.checkOut || booking.checkOut

      // Check if dates overlap
      return isOverlap(
        checkInDate,
        checkOutDate,
        bookingCheckIn,
        bookingCheckOut
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

  const handleAddToCart = () => {
    if (!checkIn || !checkOut || !selectedRoomTypeId) {
      toast.error('Please select dates and a room type')
      return
    }

    // Find available room for this specific selection
    const available = getAvailableRoomCount(selectedRoomTypeId, checkIn, checkOut)
    if (available === 0) {
      toast.error('No rooms available for these dates')
      return
    }

    // Use the auto-selected room ID or find one
    // In a real app we might want to let them pick specific room numbers, 
    // but for now we trust the auto-assigner or just pick one not in cart

    // Helper to find a room NOT already in cart for these dates
    const roomTypeParams = roomTypes.find(rt => rt.id === selectedRoomTypeId)

    const item = {
      roomTypeId: selectedRoomTypeId,
      roomTypeName: roomTypeParams?.name || 'Unknown Room',
      checkIn: checkIn,
      checkOut: checkOut,
      numGuests: numGuests,
      price: (roomTypeParams?.basePrice || 0) * differenceInDays(checkOut, checkIn)
    }

    addToCart(item)
    toast.success('Room added to reservation')

    // Reset selection for next room
    setSelectedRoomTypeId('')
    setCheckIn(undefined)
    setCheckOut(undefined)
    setNumGuests(1)

    // Move to cart view
    setStep(2)
  }

  const handleFinalCheckout = async () => {
    if (!billingContact) {
      toast.error('Billing contact information is missing')
      return
    }

    setLoading(true)
    try {
      // CRITICAL: Fetch fresh booking data to ensure we have the latest availability
      console.log('[Checkout] Fetching fresh booking data...')
      const freshBookings = await bookingEngine.getAllBookings()
      console.log('[Checkout] Loaded', freshBookings.length, 'bookings from database')

      // Debug: Show all active bookings with their room numbers
      const activeBookings = freshBookings.filter((b: any) =>
        ['reserved', 'confirmed', 'checked-in'].includes(b.status)
      )
      console.log('[Checkout] Active bookings:', activeBookings.map((b: any) => ({
        id: b._id || b.remoteId || b.id,
        roomNumber: b.roomNumber,
        status: b.status,
        checkIn: b.dates?.checkIn || b.checkIn,
        checkOut: b.dates?.checkOut || b.checkOut
      })))

      // Helper function to check room availability against fresh data
      const isRoomAvailableNow = (roomId: string, roomNumber: string, checkInDate: Date, checkOutDate: Date) => {
        // Use ISO string split to match BookingEngine's UTC-based logic
        const checkInStr = checkInDate.toISOString().split('T')[0]
        const checkOutStr = checkOutDate.toISOString().split('T')[0]

        const conflictingBooking = freshBookings.find((booking: any) => {
          if (booking.status === 'cancelled' || !['reserved', 'confirmed', 'checked-in'].includes(booking.status)) {
            return false
          }

          // Match by Room ID (Primary) OR Room Number (Secondary) to be safe
          const isSameRoom = (booking.roomId && String(booking.roomId) === String(roomId)) ||
            (booking.roomNumber && String(booking.roomNumber) === String(roomNumber))

          if (!isSameRoom) return false

          const bCheckIn = (booking.dates?.checkIn || booking.checkIn || '').split('T')[0]
          const bCheckOut = (booking.dates?.checkOut || booking.checkOut || '').split('T')[0]

          // Overlap check: newStart < existingEnd AND newEnd > existingStart
          // String comparison works correctly for YYYY-MM-DD
          return checkInStr < bCheckOut && checkOutStr > bCheckIn
        })

        return !conflictingBooking
      }

      // Prepare booking data from cart items and assignments
      const assignedRoomIds = new Set<string>()

      const bookingsToCreate = cartItems.map(item => {
        // Find all candidates of this room type
        const candidates = properties.filter(p =>
          p.propertyTypeId === item.roomTypeId ||
          (p.roomTypeName && item.roomTypeName && p.roomTypeName.toLowerCase() === item.roomTypeName.toLowerCase())
        )

        console.log(`[Checkout] Looking for room type ${item.roomTypeName}, found ${candidates.length} candidates`)

        // Select a room that is:
        // 1. Not already assigned in this batch
        // 2. Available for the specific dates (using fresh data)
        const room = candidates.find(candidate => {
          if (assignedRoomIds.has(candidate.id)) {
            console.log(`[Checkout] Skipping ${candidate.roomNumber} - already assigned in this batch`)
            return false
          }
          // Pass both ID and Number for robust checking
          return isRoomAvailableNow(candidate.id, candidate.roomNumber, item.checkIn, item.checkOut)
        })

        if (!room) {
          throw new Error(`No available room found for ${item.roomTypeName} on the selected dates. All rooms are occupied or already in your cart.`)
        }

        console.log(`[Checkout] Selected room ${room.roomNumber} for ${item.roomTypeName}`)

        // Mark this room as assigned for this batch
        assignedRoomIds.add(room.id)

        const guestDetail = guestAssignments[item.tempId] || {
          name: billingContact.fullName,
          email: billingContact.email
        }

        return {
          guest: {
            fullName: guestDetail.name,
            email: guestDetail.email,
            phone: billingContact.phone,
            address: billingContact.address
          },
          roomType: item.roomTypeName,
          roomNumber: room.roomNumber,
          dates: {
            checkIn: item.checkIn.toISOString(),
            checkOut: item.checkOut.toISOString()
          },
          numGuests: item.numGuests,
          amount: item.price,
          status: 'confirmed' as const,
          source: isReceptionBooking ? 'reception' as const : 'online' as const,
          payment: {
            method: paymentMethod,
            status: bookingEngine.getOnlineStatus() ? 'completed' as const : 'pending' as const,
            amount: item.price,
            reference: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            paidAt: new Date().toISOString()
          },
          payment_method: paymentMethod
        }
      })

      await bookingEngine.createGroupBooking(bookingsToCreate, billingContact)

      toast.success('Reservation successful!')
      clearCart()
      setStep(1)
      navigate('/?success=true')

    } catch (error: any) {
      console.error('Group booking failed:', error)
      toast.error(`Booking failed: ${error.message || 'Unknown error'}`)
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
          <div className="flex items-center justify-center mb-16 px-4 overflow-x-auto">
            {[1, 2, 3, 4, 5].map((s) => (
              <div key={s} className="flex items-center min-w-fit">
                <div
                  className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base transition-all duration-300 ${step >= s ? 'bg-gradient-to-br from-primary to-accent text-white shadow-lg' : 'bg-white border-2 border-secondary text-muted-foreground'
                    }`}
                >
                  {step > s ? <Check className="w-6 h-6" /> : s}
                </div>
                {s < 5 && (
                  <div
                    className={`w-8 sm:w-16 h-1 mx-2 rounded-full transition-all duration-300 ${step > s ? 'bg-gradient-to-r from-primary to-accent' : 'bg-secondary'}`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* global cart summary (mini) if not on cart page */}
          {step !== 2 && cartItems.length > 0 && (
            <div className="mb-6 flex justify-end">
              <Button variant="outline" onClick={() => setStep(2)}>
                View Cart ({cartItems.length} items) - {formatCurrencySync(cartTotal, currency)}
              </Button>
            </div>
          )}

          {/* Step Content */}
          <Card className="border-primary/10 shadow-xl bg-white">
            <CardHeader className="pb-6">
              <CardTitle className="text-3xl font-serif mb-2">
                {step === 1 && 'Select Room'}
                {step === 2 && 'Your Reservation Cart'}
                {step === 3 && 'Billing Information'}
                {step === 4 && 'Guest Details'}
                {step === 5 && 'Confirm & Pay'}
              </CardTitle>
              <CardDescription className="text-base">
                {step === 1 && 'Add a room to your reservation'}
                {step === 2 && 'Review your selected rooms'}
                {step === 3 && 'Who is paying for this reservation?'}
                {step === 4 && 'Assign guests to each room'}
                {step === 5 && 'Review totals and complete booking'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Step 1: Search & Add Room */}
              {step === 1 && (
                <div className="space-y-6">
                  {/* Date Selection */}
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
                    <label className="block text-sm font-medium mb-2">Number of Guests (for this room)</label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={numGuests}
                      onChange={(e) => setNumGuests(parseInt(e.target.value))}
                    />
                  </div>

                  {/* Room List */}
                  <div className="space-y-4 pt-4 border-t">
                    <h3 className="font-medium text-lg">Available Rooms</h3>
                    {roomTypes.map((roomType) => {
                      // Use getCurrentAvailability for DISPLAY (static, doesn't change with date selection)
                      const available = getCurrentAvailability(roomType.id)
                      const isSelected = selectedRoomTypeId === roomType.id
                      return (
                        <div
                          key={roomType.id}
                          onClick={() => available > 0 && setSelectedRoomTypeId(roomType.id)}
                          className={`p-4 border rounded-lg cursor-pointer transition-all ${isSelected
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
                              {available > 0 && isSelected && (
                                <div className="mt-2 text-primary text-sm font-medium flex items-center justify-end gap-1">
                                  <Check className="w-4 h-4" /> Selected
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button onClick={handleAddToCart} disabled={!selectedRoomTypeId || !checkIn || !checkOut} size="lg">
                      Add Room to Reservation
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Cart Summary */}
              {step === 2 && (
                <div className="space-y-6">
                  {cartItems.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      Your cart is empty.
                      <div className="mt-4">
                        <Button variant="outline" onClick={() => setStep(1)}>Add a Room</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-4">
                        {cartItems.map((item, idx) => (
                          <div key={item.tempId} className="border p-4 rounded-lg flex justify-between items-center bg-secondary/10">
                            <div>
                              <h4 className="font-serif font-bold">{item.roomTypeName}</h4>
                              <p className="text-sm text-muted-foreground">
                                {format(item.checkIn, 'MMM dd')} - {format(item.checkOut, 'MMM dd')} ({differenceInDays(item.checkOut, item.checkIn)} nights)
                              </p>
                              <p className="text-sm">{item.numGuests} Guests</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold">{formatCurrencySync(item.price, currency)}</p>
                              <Button variant="ghost" size="sm" className="text-destructive h-auto p-0 hover:bg-transparent" onClick={() => removeFromCart(item.tempId)}>
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-between items-center border-t pt-4 mt-6">
                        <div className="text-lg font-bold">
                          Total: <span className="text-primary">{formatCurrencySync(cartTotal, currency)}</span>
                        </div>
                        <div className="space-x-4">
                          <Button variant="outline" onClick={() => setStep(1)}>
                            + Add Another Room
                          </Button>
                          <Button onClick={() => setStep(3)}>
                            Proceed to Billing
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Step 3: Billing Contact */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">First & Last Name *</label>
                      <Input
                        required
                        value={localBillingContact.name}
                        onChange={(e) => setLocalBillingContact({ ...localBillingContact, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Email Address *</label>
                      <Input
                        type="email"
                        required
                        value={localBillingContact.email}
                        onChange={(e) => setLocalBillingContact({ ...localBillingContact, email: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Phone Number *</label>
                      <Input
                        required
                        type="tel"
                        value={localBillingContact.phone}
                        onChange={(e) => setLocalBillingContact({ ...localBillingContact, phone: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Billing Address</label>
                      <Input
                        value={localBillingContact.address}
                        onChange={(e) => setLocalBillingContact({ ...localBillingContact, address: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between mt-8">
                    <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                    <Button
                      onClick={() => {
                        if (!localBillingContact.name || !localBillingContact.email || !localBillingContact.phone) {
                          toast.error('Please fill in all required fields')
                          return
                        }
                        setBillingContact({
                          fullName: localBillingContact.name,
                          email: localBillingContact.email,
                          phone: localBillingContact.phone,
                          address: localBillingContact.address
                        })
                        setStep(4)
                      }}
                    >
                      Next: Assign Guests
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Guest Assignment */}
              {step === 4 && (
                <div className="space-y-6">
                  <p className="text-sm text-muted-foreground">Please provide the name of the primary guest for each room.</p>

                  <div className="space-y-6">
                    {cartItems.map((item, idx) => {
                      const assigned = guestAssignments[item.tempId] || { name: '', email: '' }
                      return (
                        <div key={item.tempId} className="border p-6 rounded-lg">
                          <h4 className="font-bold mb-4 flex justify-between">
                            <span>Room {idx + 1}: {item.roomTypeName}</span>
                            <span className="text-sm font-normal text-muted-foreground">
                              {format(item.checkIn, 'MMM dd')} - {format(item.checkOut, 'MMM dd')}
                            </span>
                          </h4>

                          <div className="space-y-4">
                            <div className="flex items-center space-x-2 mb-4">
                              <input
                                type="checkbox"
                                id={`same-${item.tempId}`}
                                className="rounded border-gray-300"
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setGuestAssignments(prev => ({
                                      ...prev,
                                      [item.tempId]: {
                                        name: billingContact?.fullName || '',
                                        email: billingContact?.email || ''
                                      }
                                    }))
                                  }
                                }}
                              />
                              <label htmlFor={`same-${item.tempId}`} className="text-sm cursor-pointer">
                                Same as billing contact ({billingContact?.fullName})
                              </label>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium mb-1">Guest Name</label>
                                <Input
                                  value={assigned.name}
                                  onChange={(e) => setGuestAssignments(prev => ({
                                    ...prev,
                                    [item.tempId]: { ...assigned, name: e.target.value }
                                  }))}
                                  placeholder="Guest Name"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium mb-1">Guest Email (Optional)</label>
                                <Input
                                  value={assigned.email}
                                  onChange={(e) => setGuestAssignments(prev => ({
                                    ...prev,
                                    [item.tempId]: { ...assigned, email: e.target.value }
                                  }))}
                                  placeholder="guest@example.com"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex justify-between mt-8">
                    <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
                    <Button
                      onClick={() => {
                        // Validate that all rooms have at least a name
                        const missing = cartItems.some(item => !guestAssignments[item.tempId]?.name)
                        if (missing) {
                          toast.error('Please assign a guest name for every room')
                          return
                        }
                        setStep(5)
                      }}
                    >
                      Next: Payment
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 5: Final Confirmation */}
              {step === 5 && (
                <div className="space-y-6">
                  <div className="bg-secondary/10 p-6 rounded-lg border border-secondary">
                    <h3 className="font-serif font-bold text-xl mb-4">Review Your Reservation</h3>

                    <div className="space-y-3 mb-6">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Billing Contact:</span>
                        <span className="font-medium">{billingContact?.fullName} ({billingContact?.email})</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Rooms:</span>
                        <span className="font-medium">{cartItems.length}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Guests:</span>
                        <span className="font-medium">{cartItems.reduce((acc, i) => acc + i.numGuests, 0)}</span>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <h4 className="font-bold mb-2">Room Details</h4>
                      {cartItems.map((item, idx) => (
                        <div key={item.tempId} className="flex justify-between text-sm py-1">
                          <span>{idx + 1}. {item.roomTypeName} ({guestAssignments[item.tempId]?.name})</span>
                          <span>{formatCurrencySync(item.price, currency)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-primary/20 pt-4 mt-4 flex justify-between items-center">
                      <span className="font-bold text-xl">Grand Total</span>
                      <span className="font-bold text-2xl text-primary">{formatCurrencySync(cartTotal, currency)}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-3">Payment Method</label>
                    <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not_paid">Not Paid</SelectItem>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="mobile_money">Mobile Money</SelectItem>
                        <SelectItem value="card">Credit/Debit Card</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-2">
                      Payment will be collected at the property.
                    </p>
                  </div>

                  <div className="flex justify-between mt-8">
                    <Button variant="outline" onClick={() => setStep(4)} disabled={loading}>Back</Button>
                    <Button size="lg" onClick={handleFinalCheckout} disabled={loading} className="px-8">
                      {loading ? 'Processing...' : 'Confirm Reservation'}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

