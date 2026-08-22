import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, auth } from '@/lib/db'
import { RoomType, Room } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CalendarIcon, Check, ArrowLeft, Plus, Trash, ShoppingCart, Users, ArrowRight, Minus, X as XIcon, AlertTriangle, RefreshCw, Wrench, Lock } from 'lucide-react'
import { format, differenceInDays } from 'date-fns'
import { toast } from 'sonner'
import { formatCurrencySync, getCurrencySymbol, makeUuid, cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { bookingEngine, LocalBooking } from '@/services/booking-engine'
import { sendTransactionalEmail } from '@/services/email-service'
import { sendBookingConfirmationSMS } from '@/services/sms-service'
import { activityLogService } from '@/services/activity-log-service'
import { buildBookingPaymentEvent, appendPaymentEvent } from '@/lib/payment-events'
import { allocateByWeight } from '@/lib/money'
import { ClockStatusWarning } from '@/components/ClockStatusWarning'
import { createInvoiceData, buildOnsiteGroupReceiptData } from '@/services/invoice-service'
import { promptPrintReceipt, promptPrintGroupReceipt } from '@/services/receipt-print'
import { getRoomAvailability } from '@/lib/availability'
import { createBookingGroup } from '@/lib/booking-groups'

export function OnsiteBookingPage() {
  const { currency } = useCurrency()
  const navigate = useNavigate()
  const [user, setUser] = useState<any>(null)
  const [step, setStep] = useState(1)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [properties, setProperties] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const submittingRef = useRef(false)

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
    idempotencyKey: string
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
  const [paymentSplits, setPaymentSplits] = useState<Array<{ method: string; amount: number }>>(
    [{ method: 'cash', amount: 0 }]
  )
  const [paymentType, setPaymentType] = useState<'full' | 'part' | 'pending'>('pending')
  const [amountPaid, setAmountPaid] = useState<number>(0)
  
  // Billing Adjustments State
  const [additionalCharges, setAdditionalCharges] = useState<{ id: string, description: string, amount: number }[]>([])
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('fixed')
  const [discountValue, setDiscountValue] = useState<number>(0)

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((state) => {
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
    setLoadingRooms(true)
    setLoadError(null)
    try {
      // Rooms come from the properties table — the Rooms page is the single
      // source of truth. The legacy `rooms` table only mirrors id/roomNumber
      // and produced typeless, zero-price entries here.
      const [typesData, roomsData, bookingsData] = await Promise.all([
        db.roomTypes.list(),
        db.properties.listAll(),
        bookingEngine.getAllBookings()
      ])
      const normalize = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
      const filteredTypes = (typesData as RoomType[]).filter((t: any) => {
        const n = normalize(t.name)
        return n && n.length > 0
      })

      // Match each room to its type (type id field name varies by row age)
      // and dedupe by room number.
      const seenRoomNumbers = new Set<string>()
      const roomsWithPrices = (roomsData as any[])
        .filter((room: any) => {
          const rn = String(room.roomNumber || '').trim()
          if (!rn || seenRoomNumbers.has(rn)) return false
          seenRoomNumbers.add(rn)
          return true
        })
        .map((room: any) => {
          const typeId = room.propertyTypeId || room.property_type_id || room.roomTypeId
          const matchingType =
            filteredTypes.find((rt) => rt.id === typeId) ||
            filteredTypes.find((rt) => rt.name.toLowerCase() === (room.propertyType || '').toLowerCase())
          return {
            ...room,
            roomTypeName: matchingType?.name || room.propertyType || '',
            displayPrice: matchingType?.basePrice ?? (Number(room.basePrice) || 0)
          }
        })

      // Process bookings - bookingEngine.getAllBookings() already provides roomNumber
      // but never a roomId (LocalBooking has no such field). getRoomAvailability()
      // below matches bookings to rooms strictly by roomId, so without this backfill
      // no booking ever matches its room and every room reads "available" regardless
      // of actual occupancy.
      const roomIdByNumber = new Map(
        roomsWithPrices.map((p: any) => [String(p.roomNumber || '').trim(), p.id])
      )
      const processedBookings = bookingsData.map((booking: any) => {
        const roomNumber = booking.roomNumber || roomsData.find((p: any) => p.id === booking.roomId)?.roomNumber || 'Unknown'
        const roomId = booking.roomId || roomIdByNumber.get(String(roomNumber).trim()) || ''
        return { ...booking, roomNumber, roomId }
      })

      setRoomTypes(filteredTypes)
      setProperties(roomsWithPrices)
      setBookings(processedBookings)
    } catch (error: any) {
      // Previously swallowed to []/silent — every room card then showed
      // "0 available / Sold Out" with no indication anything had failed.
      // Surface it instead so staff know to retry rather than assume the
      // hotel is fully booked.
      console.error('Failed to load room/booking data:', error)
      setLoadError(error?.message || 'Failed to load rooms. Check your connection and try again.')
      toast.error('Failed to load room data')
    } finally {
      setLoadingRooms(false)
    }
  }

  // Per-room-instance availability for the currently selected dates. Powered
  // by the shared src/lib/availability.ts — every individual room is
  // resolved to a real status (available / booked / maintenance), matched to
  // bookings by roomId (not the fragile roomNumber-string comparisons the
  // old per-type version used).
  const roomAvailability = useMemo(
    () =>
      getRoomAvailability(properties, bookings, {
        checkIn,
        checkOut,
        cartHolds: cart.map((item) => ({ propertyId: item.roomId, checkIn: item.checkIn, checkOut: item.checkOut })),
      }),
    [properties, bookings, checkIn, checkOut, cart]
  )

  const availabilityByType = useMemo(() => {
    const map = new Map<string, typeof roomAvailability>()
    for (const entry of roomAvailability) {
      const typeId = entry.property.propertyTypeId || entry.property.property_type_id || entry.property.roomTypeId || ''
      if (!map.has(typeId)) map.set(typeId, [])
      map.get(typeId)!.push(entry)
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.property.roomNumber).localeCompare(String(b.property.roomNumber), undefined, { numeric: true }))
    }
    return map
  }, [roomAvailability])

  const addRoomToCart = (property: any, roomType: RoomType) => {
    if (!checkIn || !checkOut) {
      toast.error('Please select check-in and check-out dates')
      return
    }
    setCart(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      roomTypeId: roomType.id,
      roomTypeName: roomType.name,
      roomId: property.id,
      roomNumber: property.roomNumber,
      price: roomType.basePrice,
      checkIn: checkIn as Date,
      checkOut: checkOut as Date,
      numGuests,
      idempotencyKey: makeUuid()
    }])
    toast.success(`Added ${roomType.name} (Room ${property.roomNumber}) to booking`)
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
    // Synchronous guard: prevents the second click from racing the first when
    // React hasn't yet rendered disabled={loading}. The first click flips this
    // ref; subsequent clicks bail until the in-flight submit resolves.
    if (submittingRef.current) {
      console.log('[OnsiteBooking] Submit already in flight, ignoring duplicate click')
      return
    }
    if (cart.length === 0 || !guestInfo.name || !guestInfo.email) {
      toast.error('Please fill in all required fields and select at least one room')
      return
    }
    submittingRef.current = true
    
    setLoading(true)
    try {
      const isSingleRoom = cart.length === 1

      // Derive split-payment values
      const splitsPaidTotal = paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
      const primaryPaymentMethod: any = paymentType === 'pending'
        ? 'not_paid'
        : paymentSplits.reduce((a, b) => b.amount > a.amount ? b : a, paymentSplits[0]).method
      const paymentSplitsData = paymentType !== 'pending' && paymentSplits.filter(s => s.amount > 0).length > 1
        ? paymentSplits.filter(s => s.amount > 0).map(s => ({ method: s.method, amount: s.amount }))
        : undefined

      // How much of the money collected belongs to each room in the cart.
      //
      // The amount actually handed over is grandTotal (rooms, plus any group
      // charges, minus any group discount) for a full payment, or what the
      // splits add up to for a part payment. Recording each room's own gross
      // price instead — as this did for full payments — booked more money than
      // the guest paid whenever the group carried a discount: GRP-2026-YCEA
      // paid GHS 6,400 on GHS 6,600 of rooms and its rows recorded GHS 6,600.
      //
      // Shares are apportioned by room price and the rounding residual goes to
      // the largest room, so they add up to the collected figure exactly.
      const collectedTotal = paymentType === 'full'
        ? grandTotal
        : paymentType === 'part' ? splitsPaidTotal : 0
      const cartRoomTotals = cart.map(item => Number(item.price) * differenceInDays(item.checkOut, item.checkIn))
      const paidPerItem = allocateByWeight(cartRoomTotals, collectedTotal)

      // Build a booking data object for a single cart item
      const staffName = user?.user_metadata?.full_name || user?.email || 'Staff'
      const buildBookingItem = (item: typeof cart[0], index: number) => {
        const itemNights = differenceInDays(item.checkOut, item.checkIn)
        const itemTotal = Number(item.price) * itemNights

        // Payment amount belonging to THIS room.
        const itemPaymentAmount = paidPerItem[index] ?? 0

        const assigned = guestAssignments[item.id] || { name: guestInfo.name, email: guestInfo.email }

        // Encode booking-stage payment event so revenue-service can attribute correctly
        const bookingEvent = buildBookingPaymentEvent({
          paymentType,
          amount: itemPaymentAmount,
          staffId: user?.id || '',
          staffName,
          method: primaryPaymentMethod,
          splits: paymentSplitsData,
        })
        const specialRequests = appendPaymentEvent(guestInfo.specialRequests || '', bookingEvent!)

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
            checkIn: format(item.checkIn, "yyyy-MM-dd'T'HH:mm:ss"),
            checkOut: format(item.checkOut, "yyyy-MM-dd'T'HH:mm:ss")
          },
          numGuests: item.numGuests,
          amount: itemTotal,
          status: 'confirmed' as const,
          source: 'reception' as const,
          payment: {
            method: primaryPaymentMethod as 'cash' | 'mobile_money' | 'card' | 'not_paid',
            status: (paymentType === 'full' ? 'completed' : 'pending') as 'completed' | 'pending',
            amount: itemPaymentAmount,
            reference: `PAY-${Date.now()}-${index}`,
            paidAt: paymentType !== 'pending' ? new Date().toISOString() : undefined
          },
          paymentMethod: primaryPaymentMethod,
          paymentSplits: paymentSplitsData,
          // Each room records only the money that belongs to it. Storing the
          // group-wide figure on every room made every consumer (revenue
          // reports, invoices, reservations) count the same deposit once per
          // room. For a single-room booking this is the whole collected figure.
          amountPaid: itemPaymentAmount,
          paymentStatus: paymentType,
          createdBy: user?.id,
          createdByName: staffName,
          specialRequests: bookingEvent ? specialRequests : (guestInfo.specialRequests || ''),
          idempotencyKey: item.idempotencyKey,
          ...(index === 0 ? { subtotal: totalPrice } : {})
        }
      }

      if (isSingleRoom) {
        // Single room booking: use createBooking directly so it is NOT tagged as a group.
        // Passing additionalCharges/discount so they are stored in specialRequests metadata
        // without a groupId — the booking will NOT appear as a group member anywhere.
        await bookingEngine.createBooking({
          ...buildBookingItem(cart[0], 0),
          ...(additionalCharges.length > 0 ? { additionalCharges } : {}),
          ...(discountValue > 0 ? { discount: { type: discountType, value: discountValue, amount: discountAmount } } : {})
        } as any)

        // A deposit/payment was taken at booking time — offer to print an 80mm
        // receipt. Best-effort: never blocks the completed booking. (Group/
        // multi-room bookings are not handled here — they use a different bill.)
        if (paymentType !== 'pending') {
          try {
            const item = cart[0]
            const roomType = item.roomTypeName
            const itemNights = differenceInDays(item.checkOut, item.checkIn)
            const roomSubtotal = Number(item.price) * itemNights
            const amountPaidTotal = paymentType === 'full' ? grandTotal : splitsPaidTotal
            const receiptCharges = additionalCharges.map(c => ({
              id: c.id,
              bookingId: '',
              description: c.description,
              category: 'other',
              quantity: 1,
              unitPrice: c.amount,
              amount: c.amount,
              createdAt: new Date().toISOString()
            })) as any
            const bookingWithDetails = {
              id: `onsite-${Date.now()}`,
              guestId: '',
              roomId: item.roomNumber || '',
              checkIn: format(item.checkIn, "yyyy-MM-dd'T'HH:mm:ss"),
              checkOut: format(item.checkOut, "yyyy-MM-dd'T'HH:mm:ss"),
              status: 'confirmed',
              totalPrice: roomSubtotal,
              numGuests: item.numGuests,
              createdAt: new Date().toISOString(),
              discountAmount: discountAmount > 0 ? discountAmount : undefined,
              guest: {
                name: guestInfo.name,
                email: guestInfo.email || '',
                phone: guestInfo.phone,
                address: guestInfo.address
              },
              room: { roomNumber: item.roomNumber, roomType }
            }
            const invoiceData = await createInvoiceData(
              bookingWithDetails as any,
              { roomNumber: item.roomNumber, roomType },
              { additionalCharges: receiptCharges }
            )
            promptPrintReceipt(invoiceData, {
              amountPaid: amountPaidTotal,
              balanceDue: invoiceData.charges.total - amountPaidTotal
            })
          } catch (err) {
            console.error('❌ [OnsiteBooking] Failed to prepare receipt:', err)
          }
        }

        // Booking engine sends its own confirmation email for single bookings

        // Log single-room walk-in booking
        try {
          await activityLogService.log({
            action: 'created',
            entityType: 'booking',
            entityId: 'walk-in-' + Date.now(),
            details: {
              guestName: guestInfo.name,
              guestEmail: guestInfo.email,
              roomNumber: cart[0].roomNumber,
              roomType: cart[0].roomTypeName,
              checkIn: format(cart[0].checkIn, 'yyyy-MM-dd'),
              checkOut: format(cart[0].checkOut, 'yyyy-MM-dd'),
              amount: grandTotal,
              source: 'onsite/walk-in',
              paymentMethod: primaryPaymentMethod,
              paymentSplits: paymentSplitsData,
              paymentType,
              createdAt: new Date().toISOString()
            },
            userId: user?.id || 'system'
          })
        } catch (logError) {
          console.error('Activity logging failed:', logError)
        }

        toast.success('Booking completed successfully!')
      } else {
        // Multiple rooms: use createGroupBooking so all rooms share one group reference
        const groupBookings = cart.map((item, index) => buildBookingItem(item, index))

        const billingContact = {
          name: guestInfo.name,
          email: guestInfo.email,
          phone: guestInfo.phone,
          address: guestInfo.address
        }

        await createBookingGroup(
          groupBookings.map((bookingData) => ({ bookingData: bookingData as any })),
          billingContact as any,
          additionalCharges,
          discountValue > 0 ? { type: discountType, value: discountValue, amount: discountAmount } : undefined
        )

        // A deposit/payment was taken at booking time — offer to print an 80mm
        // group receipt. Best-effort: never blocks the completed booking.
        if (paymentType !== 'pending') {
          try {
            const rooms = cart.map(item => {
              const itemNights = differenceInDays(item.checkOut, item.checkIn)
              const assigned = guestAssignments[item.id] || { name: guestInfo.name }
              return {
                roomNumber: item.roomNumber,
                roomType: item.roomTypeName,
                nights: itemNights,
                subtotal: Number(item.price) * itemNights,
                guestName: assigned.name,
                checkIn: format(item.checkIn, "yyyy-MM-dd'T'HH:mm:ss"),
                checkOut: format(item.checkOut, "yyyy-MM-dd'T'HH:mm:ss")
              }
            })
            const groupData = await buildOnsiteGroupReceiptData({
              rooms,
              additionalCharges: additionalCharges.map(c => ({ description: c.description, amount: c.amount })),
              discount: discountValue > 0 ? { type: discountType, value: discountValue, amount: discountAmount } : undefined,
              billingContact
            })
            const amountPaidTotal = paymentType === 'full' ? grandTotal : amountPaid
            promptPrintGroupReceipt(groupData, {
              amountPaid: amountPaidTotal,
              balanceDue: groupData.summary.total - amountPaidTotal
            })
          } catch (err) {
            console.error('❌ [OnsiteBooking] Failed to prepare group receipt:', err)
          }
        }

        if (bookingEngine.getOnlineStatus()) {
          // Build payment status section for the group summary email
          const paymentStatusHtml = paymentType === 'full'
            ? `<p style="color: #16a34a; font-weight: bold;">✅ Full payment of ${formatCurrencySync(grandTotal, currency)} has been received. Thank you!</p><p style="color: #555; font-style: italic;">This payment is not refundable</p>`
            : paymentType === 'part'
              ? `<div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin: 10px 0;">
                <p style="margin: 0; color: #92400e; font-weight: bold;">💰 Part Payment Received</p>
                <p style="margin: 4px 0 0; color: #78350f;">Amount Paid: <strong>${formatCurrencySync(amountPaid, currency)}</strong></p>
                <p style="margin: 4px 0 0; color: #dc2626;">Remaining Balance: <strong>${formatCurrencySync(Math.max(0, grandTotal - amountPaid), currency)}</strong> — due at check-in</p>
                <p style="margin: 4px 0 0; color: #555; font-style: italic;">This payment is not refundable</p>
              </div>`
              : `<p style="color: #78350f;">⏳ Full payment of <strong>${formatCurrencySync(grandTotal, currency)}</strong> is due upon check-in.</p>`

          const onsiteEmailPayload = {
            to: guestInfo.email,
            from: 'AMP Lodge Bookings <bookings@updates.amplodge.org>',
            subject: 'Group Booking Confirmation - AMP Lodge',
            html: `
                <div style="font-family: sans-serif; padding: 20px;">
                  <h1>Booking Confirmed!</h1>
                  <p>Dear ${guestInfo.name},</p>
                  <p>Your group reservation for ${cart.length} rooms has been confirmed.</p>
                  <p><strong>Total Rooms:</strong> ${cart.length}</p>
                  <p><strong>Total Amount:</strong> ${formatCurrencySync(grandTotal, currency)}</p>
                  ${paymentStatusHtml}
                  <br/>
                  <h3>Rooms Reserved:</h3>
                  <ul>
                    ${cart.map(c => {
              const assigned = guestAssignments[c.id] || { name: guestInfo.name }
              return `<li>Room ${c.roomNumber} (${c.roomTypeName}) - ${assigned.name}<br/>${format(c.checkIn, 'MMM dd')} to ${format(c.checkOut, 'MMM dd')}</li>`
            }).join('')}
                  </ul>
                  <p style="color: #666; font-size: 12px; margin-top: 20px;">📎 Individual pre-invoices for each room have been sent separately.</p>
                  <p>We look forward to welcoming your group!</p>
                </div>
              `,
            text: `Group Booking Confirmed for ${cart.length} rooms.\nTotal: ${formatCurrencySync(grandTotal, currency)}${paymentType === 'part' ? `\nPaid: ${formatCurrencySync(amountPaid, currency)} | Remaining: ${formatCurrencySync(Math.max(0, grandTotal - amountPaid), currency)}` : ''}${paymentType !== 'pending' ? `\nThis payment is not refundable.` : ''}`
          }

          await sendTransactionalEmail(onsiteEmailPayload, 'Onsite group booking confirmation')
        }

        toast.success(`Group booking for ${cart.length} rooms completed successfully!`)

        // Log group booking
        try {
          await activityLogService.log({
            action: 'created',
            entityType: 'booking',
            entityId: 'group-' + Date.now(),
            details: {
              guestName: guestInfo.name,
              guestEmail: guestInfo.email,
              roomCount: cart.length,
              rooms: cart.map(c => `Room ${c.roomNumber} (${c.roomTypeName})`).join(', '),
              checkIn: checkIn ? format(checkIn, 'yyyy-MM-dd') : '',
              checkOut: checkOut ? format(checkOut, 'yyyy-MM-dd') : '',
              amount: grandTotal,
              source: 'onsite/group',
              paymentMethod: primaryPaymentMethod,
              paymentSplits: paymentSplitsData,
              paymentType,
              createdAt: new Date().toISOString()
            },
            userId: user?.id || 'system'
          })
        } catch (logError) {
          console.error('Activity logging failed:', logError)
        }
      }

      navigate('/staff/dashboard')
    } catch (error: any) {
      console.error('Booking failed:', error)
      toast.error(`Booking failed: ${error.message}`)
    } finally {
      setLoading(false)
      submittingRef.current = false
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

                  {/* Room List — every individual room, not an aggregate count per type */}
                  <div>
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Plus className="h-5 w-5" /> Rooms
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Available</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400" /> Booked</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" /> Maintenance</span>
                      </div>
                    </div>

                    {loadError && (
                      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {loadError}</span>
                        <Button size="sm" variant="outline" onClick={loadData} className="shrink-0">
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
                        </Button>
                      </div>
                    )}

                    {!checkIn || !checkOut ? (
                      <p className="text-sm text-muted-foreground italic mb-3">Select check-in and check-out dates to see room-by-room availability.</p>
                    ) : null}

                    {loadingRooms ? (
                      <div className="py-12 text-center text-muted-foreground text-sm">Loading rooms…</div>
                    ) : !loadError && roomTypes.length === 0 ? (
                      <div className="py-12 text-center text-muted-foreground text-sm">No room types configured yet.</div>
                    ) : (
                      <div className="space-y-6">
                        {roomTypes.map((roomType) => {
                          const roomsOfType = availabilityByType.get(roomType.id) || []
                          if (roomsOfType.length === 0) return null
                          const availableCount = roomsOfType.filter(r => r.status === 'available').length
                          return (
                            <div key={roomType.id} className="rounded-lg border bg-white overflow-hidden">
                              <div className="flex items-center justify-between gap-4 p-4 border-b bg-secondary/5">
                                <div>
                                  <h4 className="font-semibold">{roomType.name}</h4>
                                  <p className="text-xs text-muted-foreground">{roomType.description}</p>
                                  <p className="text-xs mt-1 flex items-center gap-1"><Users className="h-3 w-3" /> Capacity: {roomType.capacity} guests</p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-xl font-bold text-primary">{formatCurrencySync(roomType.basePrice, currency)}</p>
                                  <p className="text-xs text-muted-foreground">per night</p>
                                  {checkIn && checkOut && (
                                    <p className={cn('text-xs font-medium mt-1', availableCount > 0 ? 'text-emerald-700' : 'text-red-500')}>
                                      {availableCount} of {roomsOfType.length} available
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                                {roomsOfType.map(({ property, status, conflictingBooking }) => {
                                  const inCart = cart.some(item => item.roomId === property.id)
                                  const datesSelected = !!checkIn && !!checkOut
                                  const clickable = datesSelected && status === 'available' && !inCart
                                  const conflictGuest = conflictingBooking?.guest?.fullName || conflictingBooking?.guestName || 'a guest'
                                  const conflictCheckIn = conflictingBooking?.checkIn || conflictingBooking?.dates?.checkIn
                                  const conflictCheckOut = conflictingBooking?.checkOut || conflictingBooking?.dates?.checkOut
                                  const conflictDates = conflictCheckIn && conflictCheckOut
                                    ? `${format(new Date(conflictCheckIn), 'MMM d')} – ${format(new Date(conflictCheckOut), 'MMM d')}`
                                    : ''
                                  const tooltip = status === 'booked' && conflictingBooking
                                    ? `Booked — ${conflictGuest}${conflictDates ? ` (${conflictDates})` : ''}`
                                    : status === 'maintenance'
                                      ? 'Under maintenance'
                                      : undefined
                                  return (
                                    <button
                                      key={property.id}
                                      type="button"
                                      disabled={!clickable}
                                      onClick={() => addRoomToCart(property, roomType)}
                                      title={tooltip}
                                      className={cn(
                                        'flex flex-col items-center justify-center gap-1 rounded-lg border-2 py-3 px-2 text-sm font-medium transition-all',
                                        inCart && 'border-primary bg-primary text-white shadow-sm',
                                        !inCart && !datesSelected && 'border-gray-200 bg-gray-50 text-gray-500',
                                        !inCart && datesSelected && status === 'available' && 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-500 hover:shadow-md cursor-pointer',
                                        !inCart && datesSelected && status === 'booked' && 'border-red-100 bg-red-50/60 text-red-400 cursor-not-allowed',
                                        !inCart && status === 'maintenance' && 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                                      )}
                                    >
                                      <span className="text-base font-bold">{property.roomNumber}</span>
                                      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide">
                                        {status === 'maintenance' && <Wrench className="h-3 w-3" />}
                                        {status === 'booked' && !inCart && <Lock className="h-3 w-3" />}
                                        {inCart
                                          ? 'In Cart'
                                          : status === 'maintenance'
                                            ? 'Maintenance'
                                            : status === 'booked'
                                              ? 'Booked'
                                              : datesSelected ? 'Available' : 'Select dates'}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
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
                {/* Payment Type */}
                <div className="bg-secondary/50 p-6 rounded-lg space-y-4">
                  <h3 className="font-semibold">Payment Status</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentType('full')
                        setAmountPaid(grandTotal)
                        setPaymentSplits(prev => [{ method: prev[0]?.method === 'not_paid' ? 'cash' : (prev[0]?.method || 'cash'), amount: grandTotal }])
                      }}
                      className={`p-2 sm:p-3 rounded-lg border-2 text-center transition-all ${paymentType === 'full'
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <div className="font-semibold text-xs sm:text-sm">💰 Full</div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">Paid in full</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentType('part')
                        setAmountPaid(0)
                        setPaymentSplits([{ method: 'cash', amount: 0 }])
                      }}
                      className={`p-2 sm:p-3 rounded-lg border-2 text-center transition-all ${paymentType === 'part'
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <div className="font-semibold text-xs sm:text-sm">💸 Part</div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">Partial amount</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentType('pending')
                        setAmountPaid(0)
                        setPaymentSplits([{ method: 'cash', amount: 0 }])
                      }}
                      className={`p-2 sm:p-3 rounded-lg border-2 text-center transition-all ${paymentType === 'pending'
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <div className="font-semibold text-xs sm:text-sm">⏳ Later</div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">No payment yet</div>
                    </button>
                  </div>

                  {/* Split Payment Rows — shown when Full or Part Payment selected */}
                  {paymentType !== 'pending' && (
                    <div className="space-y-2 pt-1">
                      <label className="block text-sm font-medium">
                        {paymentType === 'full' ? 'Payment Method' : 'Payment Method(s) & Amounts'}
                      </label>
                      {paymentSplits.map((split, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Select value={split.method} onValueChange={v => setPaymentSplits(prev => prev.map((s, j) => j === i ? { ...s, method: v } : s))}>
                            <SelectTrigger className="w-32 sm:w-44 shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">💵 Cash</SelectItem>
                              <SelectItem value="mobile_money">📱 Mobile Money</SelectItem>
                              <SelectItem value="card">💳 Card</SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                              {getCurrencySymbol(currency)}
                            </span>
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={split.amount || ''}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0
                                setPaymentSplits(prev => prev.map((s, j) => j === i ? { ...s, amount: val } : s))
                                if (paymentSplits.length === 1) setAmountPaid(val)
                              }}
                              className="pl-8"
                            />
                          </div>
                          {paymentSplits.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setPaymentSplits(prev => prev.filter((_, j) => j !== i))}
                              className="text-destructive hover:text-destructive/80 p-1 rounded hover:bg-destructive/10 transition-colors shrink-0"
                            >
                              <XIcon className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      {/* Running total for multi-splits */}
                      {paymentSplits.length > 1 && (() => {
                        const splitTotal = paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
                        const target = paymentType === 'full' ? grandTotal : splitTotal
                        const diff = (paymentType === 'full' ? grandTotal : 0) - splitTotal
                        return (
                          <div className="flex justify-between text-xs px-1">
                            <span className="text-muted-foreground">Splits total</span>
                            <span className={diff === 0 || paymentType === 'part' ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                              {formatCurrencySync(splitTotal, currency)}
                              {paymentType === 'full' && diff > 0 && ` · ${formatCurrencySync(diff, currency)} short`}
                              {paymentType === 'full' && diff < 0 && ` · ${formatCurrencySync(Math.abs(diff), currency)} over`}
                              {(paymentType === 'part' || diff === 0) && ' ✓'}
                            </span>
                          </div>
                        )
                      })()}
                      <button
                        type="button"
                        onClick={() => setPaymentSplits(prev => [...prev, { method: 'cash', amount: 0 }])}
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add another payment method
                      </button>
                    </div>
                  )}

                  {/* Payment Summary */}
                  <div className="bg-white rounded-lg p-4 border space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Grand Total:</span>
                      <span className="font-semibold">{formatCurrencySync(grandTotal, currency)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Amount Paid:</span>
                      <span className="font-semibold text-green-600">
                        {formatCurrencySync(paymentType === 'full' ? grandTotal : paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0), currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm border-t pt-2">
                      <span className="font-medium">Balance Due:</span>
                      <span className={`font-bold ${(grandTotal - (paymentType === 'full' ? grandTotal : paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0))) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatCurrencySync(Math.max(0, grandTotal - (paymentType === 'full' ? grandTotal : paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0))), currency)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 5 && <ClockStatusWarning className="mt-6" />}

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
