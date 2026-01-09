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
import { CalendarIcon, Check, ArrowLeft, Plus, Trash, ShoppingCart, Users, ArrowRight, Minus } from 'lucide-react'
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

  // Cart state for multiple rooms
  interface CartItem {
    id: string // temporary id for the cart item
    roomTypeId: string
    roomTypeName: string
    roomId: string
    roomNumber: string
    price: number
    checkIn: Date
    checkOut: Date
    numGuests: number
  }
  const [cart, setCart] = useState<CartItem[]>([])
  // Map of tempId (from cart) -> Guest Details
  const [guestAssignments, setGuestAssignments] = useState<Record<string, { name: string, email: string }>>({})

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
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mobile_money' | 'card' | 'not_paid'>('not_paid')
  const [loading, setLoading] = useState(false)

  // Billing Adjustments State
  const [additionalCharges, setAdditionalCharges] = useState<{ id: string, description: string, amount: number }[]>([])
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('fixed')
  const [discountValue, setDiscountValue] = useState<number>(0)

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
        bookingEngine.getAllBookings()
      ])
      const normalize = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
      const filteredTypes = (typesData as RoomType[]).filter((t: any) => {
        const n = normalize(t.name)
        return n && n.length > 0
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

  // Calculate available rooms for a specific room type and date range
  const getAvailableRoomCount = (roomTypeId: string, checkInDate?: Date, checkOutDate?: Date) => {
    const propertiesOfType = properties.filter(prop => {
      const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
        roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
      return matchingType?.id === roomTypeId
    })

    if (!checkInDate || !checkOutDate) {
      // If no dates selected, show "Available Now" (Today's availability)
      // This matches Dashboard and BookingPage logic
      const todayIso = new Date().toISOString().split('T')[0]

      const availableToday = propertiesOfType.filter(property => {
        if (property.status === 'maintenance') return false

        const hasActiveBooking = bookings.some(booking => {
          if (booking.status === 'cancelled') return false
          if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

          // Match room
          if (booking.roomNumber !== property.roomNumber) return false

          // Handle data structure
          const bCheckIn = (booking.checkIn || booking.dates?.checkIn || '').split('T')[0]
          const bCheckOut = (booking.checkOut || booking.dates?.checkOut || '').split('T')[0]

          // Occupied if: checkIn <= today < checkOut
          return bCheckIn <= todayIso && bCheckOut > todayIso
        })

        return !hasActiveBooking
      })

      return availableToday.length
    }

    const availableProperties = propertiesOfType.filter(property => {
      // 1. Check if room is under maintenance
      if (property.status === 'maintenance') return false

      // 2. Check for overlapping existing bookings
      const hasOverlappingBooking = bookings.some(booking => {
        if (booking.status === 'cancelled') return false
        if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false

        // Handle both data structures: raw DB and normalized
        const bookingCheckIn = booking.checkIn || booking.dates?.checkIn
        const bookingCheckOut = booking.checkOut || booking.dates?.checkOut

        if (booking.roomNumber !== property.roomNumber) return false
        return isOverlap(checkInDate, checkOutDate, bookingCheckIn, bookingCheckOut)
      })
      if (hasOverlappingBooking) return false

      // 3. Check if room is already in cart
      const isInCart = cart.some(item =>
        item.roomNumber === property.roomNumber &&
        isOverlap(checkInDate, checkOutDate, item.checkIn, item.checkOut)
      )
      if (isInCart) return false

      return true
    })

    return availableProperties.length
  }

  const addToCart = (roomType: RoomType) => {
    if (!checkIn || !checkOut) {
      toast.error('Please select check-in and check-out dates')
      return
    }

    // Find ALL properties of this type
    const propertiesOfType = properties.filter(prop => {
      const matchingType = roomTypes.find(rt => rt.id === prop.propertyTypeId) ||
        roomTypes.find(rt => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
      return matchingType?.id === roomType.id
    })

    // Find first available property
    const availableProperty = propertiesOfType.find(property => {
      // 1. Check maintenance
      if (property.status === 'maintenance') return false

      // 2. Check bookings
      const hasOverlappingBooking = bookings.some(booking => {
        if (booking.status === 'cancelled') return false
        if (booking.roomNumber !== property.roomNumber) return false
        if (!['reserved', 'confirmed', 'checked-in'].includes(booking.status)) return false
        return isOverlap(checkIn, checkOut, booking.checkIn, booking.checkOut)
      })
      if (hasOverlappingBooking) return false

      // 3. Check cart
      const isInCart = cart.some(item =>
        item.roomNumber === property.roomNumber &&
        isOverlap(checkIn, checkOut, item.checkIn.toISOString(), item.checkOut.toISOString())
      )
      if (isInCart) return false

      return true
    })

    if (!availableProperty) {
      toast.error('No more rooms of this type available for selected dates')
      return
    }

    // Resolve to a Room object (or best effort)
    // We prefer finding a matching Room entity, but if not found we might need to rely on Property
    const roomObj = rooms.find(r => r.roomNumber === availableProperty.roomNumber)

    if (!roomObj) {
      console.warn(`[OnsiteBooking] Found available property ${availableProperty.roomNumber} but no matching Room entity found.`)
      // Fallback or error? For now, we need an ID. 
      // If rooms are auto-created, maybe we can't add it yet? 
      // Let's iterate: if we can't find a room object, we can't get a roomId safely unless we use property.id
      // But the system seems to parallel properties and rooms.
      toast.error(`System error: Room ${availableProperty.roomNumber} configuration incomplete.`)
      return
    }

    setCart([...cart, {
      id: Math.random().toString(36).substr(2, 9),
      roomTypeId: roomType.id,
      roomTypeName: roomType.name,
      roomId: roomObj.id,
      roomNumber: availableProperty.roomNumber,
      price: roomType.basePrice,
      checkIn: checkIn as Date,
      checkOut: checkOut as Date,
      numGuests: numGuests
    }])
    toast.success(`Added ${roomType.name} (${availableProperty.roomNumber}) to booking`)
  }

  const removeFromCart = (itemId: string) => {
    setCart(cart.filter(i => i.id !== itemId))
  }

  const totalPrice = cart.reduce((sum, item) => {
    const itemNights = differenceInDays(item.checkOut, item.checkIn)
    return sum + (Number(item.price) * itemNights)
  }, 0)

  const chargesTotal = additionalCharges.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const totalBeforeDiscount = totalPrice + chargesTotal
  const discountAmount = discountType === 'percentage'
    ? (totalBeforeDiscount * (discountValue / 100))
    : discountValue
  const grandTotal = Math.max(0, totalBeforeDiscount - discountAmount)

  const handleBooking = async () => {
    if (cart.length === 0 || !guestInfo.name || !guestInfo.email) {
      toast.error('Please fill in all required fields and select at least one room')
      return
    }

    setLoading(true)
    try {
      const groupBookings: Omit<LocalBooking, '_id' | 'createdAt' | 'updatedAt' | 'synced'>[] = cart.map((item, index) => {
        const itemNights = differenceInDays(item.checkOut, item.checkIn)
        // Room amount is just price * nights
        // Charges and discounts are tracked separately in GROUP_DATA metadata
        const itemTotal = Number(item.price) * itemNights

        const assigned = guestAssignments[item.id] || { name: guestInfo.name, email: guestInfo.email }
        return {
          guest: {
            fullName: assigned.name,
            email: assigned.email,
            phone: guestInfo.phone,
            address: guestInfo.address
          },
          roomType: item.roomTypeName,
          roomNumber: item.roomNumber,
          dates: {
            checkIn: item.checkIn.toISOString(),
            checkOut: item.checkOut.toISOString()
          },
          numGuests: item.numGuests,
          amount: itemTotal,
          status: 'confirmed',
          source: 'reception',
          payment: {
            method: paymentMethod,
            status: paymentMethod === 'not_paid' ? 'pending' : 'completed',
            amount: itemTotal,
            reference: `PAY-${Date.now()}-${index}`,
            paidAt: paymentMethod === 'not_paid' ? undefined : new Date().toISOString()
          },
          createdBy: user?.id,
          createdByName: user?.user_metadata?.full_name || user?.email,
          ...(index === 0 ? { subtotal: totalPrice } : {}) // Store subtotal reference
        }
      })

      const billingContact = {
        name: guestInfo.name,
        email: guestInfo.email,
        phone: guestInfo.phone,
        address: guestInfo.address
      }

      await bookingEngine.createGroupBooking(groupBookings, billingContact, additionalCharges, {
        type: discountType,
        value: discountValue,
        amount: discountAmount
      })

      if (bookingEngine.getOnlineStatus()) {
        const onsiteEmailPayload = {
          to: guestInfo.email,
          from: 'AMP Lodge Bookings <bookings@updates.amplodge.org>',
          subject: 'Group Booking Confirmation - AMP Lodge',
          html: `
              <div style="font-family: sans-serif; padding: 20px;">
                <h1>Booking Confirmed!</h1>
                <p>Dear ${guestInfo.name},</p>
                <p>Your group reservation for ${cart.length} room(s) has been confirmed.</p>
                <p><strong>Total Rooms:</strong> ${cart.length}</p>
                <p><strong>Total Amount:</strong> ${formatCurrencySync(grandTotal, currency)}</p>
                <br/>
                <h3>Rooms Reserved:</h3>
                <ul>
                  ${cart.map(c => {
            const assigned = guestAssignments[c.id] || { name: guestInfo.name }
            return `<li>Room ${c.roomNumber} (${c.roomTypeName}) - ${assigned.name}<br/>${format(c.checkIn, 'MMM dd')} to ${format(c.checkOut, 'MMM dd')}</li>`
          }).join('')}
                </ul>
                <p>We look forward to welcoming your group!</p>
              </div>
            `,
          text: `Group Booking Confirmed for ${cart.length} rooms.\nTotal: ${formatCurrencySync(grandTotal, currency)}`
        }

        await sendTransactionalEmail(onsiteEmailPayload, 'Onsite group booking confirmation')
      }

      toast.success(`Group booking for ${cart.length} rooms completed successfully!`)
      navigate('/staff/dashboard')
    } catch (error: any) {
      console.error('Booking failed:', error)
      toast.error(`Booking failed: ${error.message}`)
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center mb-8">
          {[1, 2, 3, 4, 5].map((s) => (
            <div key={s} className="flex items-center">
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

        <Card className="border-primary/10 shadow-xl bg-white">
          <CardHeader className="pb-6">
            <CardTitle className="text-3xl font-serif mb-2">
              {step === 1 && 'Search & Add Rooms'}
              {step === 2 && 'Review Cart'}
              {step === 3 && 'Billing Information'}
              {step === 4 && 'Guest Assignments'}
              {step === 5 && 'Confirm & Process Payment'}
            </CardTitle>
            <CardDescription className="text-base">
              {step === 1 && 'Select dates and add rooms to your group booking'}
              {step === 2 && 'Review your selections'}
              {step === 3 && 'Enter billing contact information'}
              {step === 4 && 'Assign guests to each room'}
              {step === 5 && 'Review booking and collect payment'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Step 1: Search & Add Rooms */}
            {step === 1 && (
              <div className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                  {/* Search Criteria */}
                  <div className="bg-secondary/10 p-4 rounded-lg space-y-4">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <CalendarIcon className="h-5 w-5" /> Select Dates for Your Room
                    </h3>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">Check-in</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-start h-9 text-xs">
                              <CalendarIcon className="mr-2 h-3 w-3" />
                              {checkIn ? format(checkIn, 'MMM dd') : 'Select'}
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
                        <label className="block text-sm font-medium mb-1">Check-out</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-start h-9 text-xs">
                              <CalendarIcon className="mr-2 h-3 w-3" />
                              {checkOut ? format(checkOut, 'MMM dd') : 'Select'}
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
                      <div>
                        <label className="block text-sm font-medium mb-1">Guests</label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={numGuests}
                          onChange={(e) => setNumGuests(parseInt(e.target.value))}
                          className="h-9"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Room List */}
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                      <Plus className="h-5 w-5" /> Available Rooms
                    </h3>
                    <div className="grid gap-4">
                      {roomTypes.map((roomType) => {
                        const available = getAvailableRoomCount(roomType.id, checkIn, checkOut)
                        return (
                          <div
                            key={roomType.id}
                            className={`p-4 border rounded-lg transition-all hover:border-primary/50 relative overflow-hidden ${available === 0 ? 'opacity-50' : 'bg-white'
                              }`}
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
                                <Button
                                  size="sm"
                                  className="mt-2 text-white"
                                  disabled={available === 0 || !checkIn || !checkOut}
                                  onClick={() => addToCart(roomType)}
                                >
                                  {available === 0 ? 'Sold Out' : (!checkIn || !checkOut) ? 'Select Dates' : 'Add Room'}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Cart Column */}
                <div className="md:col-span-1">
                  <div className="sticky top-24 border rounded-lg p-4 bg-secondary/10">
                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                      <ShoppingCart className="h-5 w-5" /> Selected Rooms
                    </h3>

                    {cart.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <p>No rooms selected.</p>
                        <p className="text-xs">Add rooms from the list.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {cart.map((item, idx) => (
                          <div key={item.id} className="bg-white p-3 rounded border shadow-sm flex justify-between group flex-col">
                            <div className="flex justify-between items-start w-full">
                              <div>
                                <p className="font-medium">{item.roomTypeName}</p>
                                <p className="text-xs text-muted-foreground">Room {item.roomNumber}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => removeFromCart(item.id)}
                                  className="text-red-400 hover:text-red-600 p-1 opacity-100 transition-opacity"
                                >
                                  <Trash className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground mt-2 border-t pt-2 w-full">
                              <p>{format(item.checkIn, 'MMM dd')} - {format(item.checkOut, 'MMM dd')}</p>
                              <div className="flex justify-between mt-1">
                                <span>{differenceInDays(item.checkOut, item.checkIn)} nights</span>
                                <span className="font-semibold">{formatCurrencySync(Number(item.price) * differenceInDays(item.checkOut, item.checkIn), currency)}</span>
                              </div>
                            </div>
                          </div>
                        ))}

                        <div className="border-t pt-3 mt-4">
                          <div className="flex justify-between items-center font-bold">
                            <span>Total:</span>
                            <span>{formatCurrencySync(totalPrice, currency)}</span>
                          </div>
                          {totalPrice > 0 && (
                            <Button size="sm" className="w-full mt-2" onClick={() => setStep(2)}>
                              Review Cart <ArrowRight className="w-3 h-3 ml-1" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Review Cart */}
            {step === 2 && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold">Review Your Cart</h3>
                {cart.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-4">Your cart is empty.</p>
                    <Button variant="outline" onClick={() => setStep(1)}>Go to Search</Button>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {cart.map((item) => (
                      <div key={item.id} className="border p-4 rounded-lg flex flex-col md:flex-row justify-between items-center bg-card">
                        <div className="mb-2 md:mb-0">
                          <h4 className="font-bold text-lg">{item.roomTypeName} <span className="text-muted-foreground text-sm">(Room {item.roomNumber})</span></h4>
                          <p className="text-sm">
                            <span className="font-medium">Dates:</span> {format(item.checkIn, 'PPP')} - {format(item.checkOut, 'PPP')}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {differenceInDays(item.checkOut, item.checkIn)} nights &bull; {item.numGuests} guests
                          </p>
                        </div>
                        <div className="text-right flex items-center gap-4">
                          <p className="font-bold text-xl">{formatCurrencySync(Number(item.price) * differenceInDays(item.checkOut, item.checkIn), currency)}</p>
                          <Button variant="ghost" size="sm" onClick={() => removeFromCart(item.id)} className="text-destructive hover:bg-destructive/10">
                            <Trash className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-col md:flex-row justify-between items-center border-t pt-6 mt-2">
                      <Button variant="outline" onClick={() => setStep(1)} className="mb-4 md:mb-0">
                        <Plus className="w-4 h-4 mr-2" /> Add Another Room
                      </Button>
                      <div className="text-right">
                        <div className="text-2xl font-bold mb-2">Total: {formatCurrencySync(totalPrice, currency)}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Billing Information */}
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

            {/* Step 4: Guest Assignments */}
            {step === 4 && (
              <div className="space-y-6">
                <p className="text-sm text-muted-foreground">Please provide details for the primary guest staying in each room.</p>
                <div className="space-y-6">
                  {cart.map((item, idx) => {
                    const assigned = guestAssignments[item.id] || { name: '', email: '' }
                    return (
                      <div key={item.id} className="border p-4 rounded-lg bg-card">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-bold">Room {idx + 1}: {item.roomTypeName}</h4>
                          <span className="text-sm text-muted-foreground">Room {item.roomNumber}</span>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id={`same-${item.id}`}
                              className="rounded border-gray-300"
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setGuestAssignments(prev => ({
                                    ...prev,
                                    [item.id]: {
                                      name: guestInfo.name,
                                      email: guestInfo.email
                                    }
                                  }))
                                }
                              }}
                            />
                            <label htmlFor={`same-${item.id}`} className="text-sm cursor-pointer">
                              Same as billing contact ({guestInfo.name})
                            </label>
                          </div>

                          <div className="grid md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium mb-1">Guest Name *</label>
                              <Input
                                value={assigned.name}
                                onChange={(e) => setGuestAssignments(prev => ({
                                  ...prev,
                                  [item.id]: { ...assigned, name: e.target.value }
                                }))}
                                placeholder="Guest Name"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium mb-1">Guest Email</label>
                              <Input
                                value={assigned.email}
                                onChange={(e) => setGuestAssignments(prev => ({
                                  ...prev,
                                  [item.id]: { ...assigned, email: e.target.value }
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
              </div>
            )}

            {/* Step 5: Confirmation & Payment */}
            {step === 5 && (
              <div className="space-y-6">
                <div className="bg-secondary/50 p-6 rounded-lg space-y-4">
                  <div className="flex justify-between items-center border-bottom pb-2">
                    <h3 className="font-bold flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Booking Summary</h3>
                  </div>

                  {cart.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm py-1 border-b border-dashed border-gray-300 last:border-0">
                      <span>{item.roomTypeName} ({item.roomNumber}) - {guestAssignments[item.id]?.name}</span>
                      <span>{formatCurrencySync(Number(item.price) * differenceInDays(item.checkOut, item.checkIn), currency)}</span>
                    </div>
                  ))}

                  <div className="flex justify-between pt-2">
                    <span className="font-medium">Stay Duration:</span>
                    <span>Varies ({cart.length} bookings)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Total Rooms:</span>
                    <span>{cart.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Total Guests:</span>
                    <span>{numGuests} (Group Total)</span>
                  </div>

                  {/* Additional Charges Section */}
                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-3">Additional Charges</h4>
                    <div className="space-y-2 mb-3">
                      {additionalCharges.map((charge, idx) => (
                        <div key={charge.id} className="flex gap-2 items-center">
                          <Input
                            value={charge.description}
                            onChange={(e) => {
                              const newCharges = [...additionalCharges]
                              newCharges[idx].description = e.target.value
                              setAdditionalCharges(newCharges)
                            }}
                            placeholder="Description"
                            className="flex-grow h-9"
                          />
                          <Input
                            type="number"
                            value={charge.amount}
                            onChange={(e) => {
                              const newCharges = [...additionalCharges]
                              newCharges[idx].amount = parseFloat(e.target.value) || 0
                              setAdditionalCharges(newCharges)
                            }}
                            placeholder="Amount"
                            className="w-24 h-9"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setAdditionalCharges(additionalCharges.filter((_, i) => i !== idx))
                            }}
                            className="h-9 w-9"
                          >
                            <Trash className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAdditionalCharges([...additionalCharges, { id: Math.random().toString(36), description: '', amount: 0 }])}
                      className="w-full border-dashed"
                    >
                      <Plus className="h-4 w-4 mr-2" /> Add Charge
                    </Button>
                  </div>

                  {/* Discount Section */}
                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-3">Discount</h4>
                    <div className="flex gap-2">
                      <Select value={discountType} onValueChange={(v: any) => setDiscountType(v)}>
                        <SelectTrigger className="w-[140px] h-9">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed Amount</SelectItem>
                          <SelectItem value="percentage">Percentage (%)</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        value={discountValue}
                        onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                        placeholder="Value"
                        min="0"
                        className="h-9"
                      />
                    </div>
                  </div>

                  {/* Totals Breakdown */}
                  <div className="border-t pt-4 space-y-2">
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Room Subtotal:</span>
                      <span>{formatCurrencySync(totalPrice, currency)}</span>
                    </div>
                    {chargesTotal > 0 && (
                      <div className="flex justify-between text-sm text-gray-500">
                        <span>Additional Charges:</span>
                        <span>+ {formatCurrencySync(chargesTotal, currency)}</span>
                      </div>
                    )}
                    {discountAmount > 0 && (
                      <div className="flex justify-between text-sm text-destructive">
                        <span>Discount:</span>
                        <span>- {formatCurrencySync(discountAmount, currency)}</span>
                      </div>
                    )}

                    <div className="flex justify-between items-center pt-2 border-t mt-2">
                      <span className="font-bold text-lg">Grand Total:</span>
                      <span className="text-primary text-2xl font-bold">{formatCurrencySync(grandTotal, currency)}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-secondary/50 p-6 rounded-lg">
                  <h3 className="font-semibold mb-2">Billing Contact</h3>
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
                      <SelectItem value="not_paid">🚫 Not Paid</SelectItem>
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
              {step < 5 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={
                    (step === 1 && cart.length === 0) ||
                    (step === 2 && cart.length === 0) ||
                    (step === 3 && (!guestInfo.name || !guestInfo.email)) ||
                    (step === 4 && cart.some(item => !guestAssignments[item.id]?.name))
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
    </div >
  )
}
