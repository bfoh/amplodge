import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, List, LayoutGrid, Filter, Users } from 'lucide-react'
import { blink } from '../../blink/client'
import { cn } from '../../lib/utils'
import { getRoomDisplayName, calculateNights } from '../../lib/display'
import { useStaffRole } from '../../hooks/use-staff-role'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { toast } from 'sonner'
import { bookingEngine } from '../../services/booking-engine'
import { CalendarTimeline } from '../../components/CalendarTimeline'
import { CalendarGridView } from '../../components/CalendarGridView'
import { CalendarListView } from '../../components/CalendarListView'
import { useCurrency } from '@/hooks/use-currency'
import { formatCurrencySync } from '@/lib/utils'

type ViewMode = 'timeline' | 'grid' | 'list'

export function CalendarPage() {
  const navigate = useNavigate()
  const { staffRecord: staffData, role, loading: staffLoading } = useStaffRole()
  const { currency } = useCurrency()

  console.log('[CalendarPage] useStaffRole result:', { staffData, role, staffLoading })
  const [currentDate, setCurrentDate] = useState(new Date())
  const [bookings, setBookings] = useState<any[]>([])
  const [properties, setProperties] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Booking form (aligned with Staff Bookings page)
  const [formData, setFormData] = useState({
    propertyId: '',
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    guestAddress: '',
    checkIn: '',
    checkOut: '',
    adults: 1,
    children: 0,
    totalPrice: 0,
    notes: '',
    paymentMethod: 'Not paid',
    paymentType: 'full' as 'full' | 'part' | 'later',
    amountPaid: 0
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [currentDate])

  const loadData = async () => {
    try {
      const user = await blink.auth.me()

      const [roomsData, propertiesData, roomTypesData, localBookings] = await Promise.all([
        (blink.db as any).rooms.list({ limit: 500 }),
        // Load ALL properties without userId filter to prevent data loss (properties are project-scoped)
        (blink.db as any).properties.list({ orderBy: { createdAt: 'desc' }, limit: 500 }),
        (blink.db as any).roomTypes.list({ limit: 500 }),
        bookingEngine.getAllBookings()
      ])

      // Build property list sourced from Staff Rooms (properties) but keyed by room.id for booking alignment
      const roomByNumber = new Map((roomsData || []).map((r: any) => [String(r.roomNumber || '').trim(), r]))
      const combined = (propertiesData || []).map((p: any) => {
        const rn = String(p.roomNumber || '').trim()
        const roomMatch = rn ? roomByNumber.get(rn) : null
        return {
          id: roomMatch?.id || (rn ? `room-${rn.toLowerCase().replace(/[^a-z0-9]/g, '-')}` : p.id), // prefer room.id so bookings map correctly
          roomNumber: rn || p.name || '',
          name: p.name || rn || 'Room',
          maxGuests: Number(p.maxGuests || 0),
          basePrice: Number(p.basePrice || 0),
          propertyTypeId: p.propertyTypeId || '',
          ...p
        }
      })

      // Map bookings from booking engine into timeline-friendly shape
      // CRITICAL: Must match booking roomNumber to the property.id that CalendarTimeline uses for rows
      // ENHANCED: Also try matching by room ID for Voice Agent bookings
      const mapped = (localBookings as any[]).map((b: any) => {
        const bookingRoomNumber = String(b.roomNumber || '').trim()
        const bookingRemoteId = b.remoteId || b._id

        // Strategy 1: Find the property by roomNumber
        let matchingProperty = combined.find((p: any) =>
          String(p.roomNumber || '').trim() === bookingRoomNumber
        )

        // Strategy 2: If no match, try matching by room ID in the rooms list
        if (!matchingProperty && roomsData) {
          const matchingRoom = (roomsData as any[]).find((r: any) =>
            r.roomNumber === bookingRoomNumber ||
            r.room_number === bookingRoomNumber ||
            String(r.roomNumber || '').trim() === bookingRoomNumber
          )
          if (matchingRoom) {
            matchingProperty = combined.find((p: any) =>
              p.id === matchingRoom.id ||
              String(p.roomNumber || '').trim() === String(matchingRoom.roomNumber || '').trim()
            )
          }
        }

        // Strategy 3: If still no match but we have a roomNumber, create a synthetic property entry
        // This ensures Voice Agent bookings always appear even if property setup is incomplete
        const propertyId = matchingProperty?.id || (bookingRoomNumber ? `voice-agent-${bookingRoomNumber}` : '')

        console.log('[CalendarPage] Mapping booking:', {
          bookingId: b._id,
          remoteId: bookingRemoteId,
          bookingRoomNumber,
          matchingPropertyId: propertyId,
          checkIn: b.dates?.checkIn,
          checkOut: b.dates?.checkOut,
          status: b.status,
          source: b.source
        })

        return {
          id: b._id,
          remoteId: b.remoteId || b._id, // Use the actual database ID from booking engine
          roomId: propertyId, // For backwards compatibility
          propertyId, // MUST match the property.id used in timeline rows
          guestName: b.guest?.fullName || 'Guest',
          guestEmail: b.guest?.email || '',
          guestPhone: b.guest?.phone || '',
          guestAddress: b.guest?.address || '',
          checkIn: b.dates?.checkIn,
          checkOut: b.dates?.checkOut,
          status: b.status || 'confirmed',
          totalPrice: Number(b.amount || 0),
          numGuests: Number(b.numGuests || 1),
          createdAt: b.createdAt,
          currency: currency,
          source: b.source // Track booking source for debugging
        }
      }).filter((b: any) => b.propertyId && b.status !== 'checked-out') // Only include active bookings with valid room

      console.log('[CalendarPage] Total bookings loaded:', localBookings.length)
      console.log('[CalendarPage] Bookings mapped to timeline:', mapped.length)
      console.log('[CalendarPage] Properties (rows):', combined.length)
      console.log('[CalendarPage] Voice Agent bookings:', mapped.filter((b: any) => b.source === 'voice_agent').length)

      // Sort rooms by numeric room number when possible
      combined.sort((a: any, b: any) => {
        const an = parseInt(String(a.roomNumber), 10)
        const bn = parseInt(String(b.roomNumber), 10)
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
        return String(a.roomNumber || a.name).localeCompare(String(b.roomNumber || b.name))
      })

      setProperties(combined)
      setBookings(mapped)
      setRoomTypes(roomTypesData || [])
    } catch (error) {
      console.error('Failed to load calendar data:', error)
    } finally {
      setLoading(false)
    }
  }

  // --- Pricing & Availability logic (identical to Staff Bookings page) ---
  const activeStatuses = useMemo(() => new Set(['reserved', 'confirmed', 'checked-in']), [])

  const isOverlap = (startA: string, endA: string, startB: string, endB: string) => {
    const aStart = new Date(startA).getTime()
    const aEnd = new Date(endA).getTime()
    const bStart = new Date(startB).getTime()
    const bEnd = new Date(endB).getTime()
    return aStart < bEnd && bStart < aEnd
  }

  const isPropertyBooked = (propertyId: string) => {
    if (!formData.checkIn || !formData.checkOut) return false
    return bookings.some((b) => {
      const bRoomId = b.propertyId ?? b.roomId
      return (
        bRoomId === propertyId &&
        activeStatuses.has(b.status) &&
        isOverlap(formData.checkIn, formData.checkOut, b.checkIn, b.checkOut)
      )
    })
  }

  const availableProperties = useMemo(() => {
    return properties.filter((p: any) => p.id && !isPropertyBooked(p.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, bookings, formData.checkIn, formData.checkOut])

  // Auto-calc price when selection/dates change
  useEffect(() => {
    if (!formData.propertyId || !formData.checkIn || !formData.checkOut) return
    const selectedProperty = properties.find((p: any) => p.id === formData.propertyId)
    if (!selectedProperty) return

    const nights = calculateNights(formData.checkIn, formData.checkOut)
    const selectedRoomType = roomTypes.find((rt: any) => rt.id === selectedProperty.propertyTypeId)
    const pricePerNight = Number(selectedRoomType?.basePrice) || 0
    const calculatedPrice = nights * pricePerNight
    setFormData(prev => ({ ...prev, totalPrice: calculatedPrice }))
  }, [formData.propertyId, formData.checkIn, formData.checkOut, properties, roomTypes])

  // --- Month helpers ---
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()

    return { daysInMonth, startingDayOfWeek, year, month }
  }

  const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentDate)

  const previousMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  // Create booking (same payload as Staff Bookings page)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.propertyId || !formData.checkIn || !formData.checkOut) {
      toast.error('Please fill in all required fields')
      return
    }
    if (!formData.guestName || !formData.guestEmail) {
      toast.error('Guest name and email are required')
      return
    }

    setSubmitting(true)
    try {
      const selectedProperty = properties.find((p: any) => p.id === formData.propertyId)
      if (!selectedProperty) {
        toast.error('Selected room not found')
        setSubmitting(false)
        return
      }

      const selectedRoomType = roomTypes.find((rt: any) => rt.id === selectedProperty.propertyTypeId)
      const roomTypeName = selectedRoomType?.name || ''

      // Comprehensive fallback: Get current user ID directly if staffData is not available
      let createdBy = staffData?.userId || staffData?.id
      console.log('[CalendarPage] Initial createdBy from staffData:', createdBy)

      if (!createdBy) {
        try {
          const currentUser = await blink.auth.me()
          createdBy = currentUser?.id
          console.log('[CalendarPage] Fallback: Using current user ID:', createdBy)
        } catch (error) {
          console.error('[CalendarPage] Failed to get current user:', error)
          // Last resort: generate a temporary ID
          createdBy = `temp-user-${Date.now()}`
          console.log('[CalendarPage] Last resort: Using temporary ID:', createdBy)
        }
      }

      console.log('[CalendarPage] Staff data:', staffData)
      console.log('[CalendarPage] Final createdBy for booking:', createdBy)

      await bookingEngine.createBooking({
        guest: {
          fullName: formData.guestName,
          email: formData.guestEmail,
          phone: formData.guestPhone,
          address: formData.guestAddress
        },
        roomType: roomTypeName,
        roomNumber: selectedProperty.roomNumber,
        dates: { checkIn: formData.checkIn, checkOut: formData.checkOut },
        numGuests: formData.adults + formData.children,
        amount: formData.totalPrice,
        status: 'confirmed',
        source: 'reception',
        notes: formData.notes,
        payment_method: formData.paymentType === 'later' ? 'Not paid' : formData.paymentMethod,
        amountPaid: formData.paymentType === 'full' ? formData.totalPrice : formData.paymentType === 'part' ? formData.amountPaid : 0,
        paymentStatus: formData.paymentType === 'full' ? 'full' : formData.paymentType === 'part' ? 'part' : 'pending',
        createdBy: createdBy
      })

      toast.success('Booking created successfully')
      setDialogOpen(false)
      setFormData({
        propertyId: '',
        guestName: '',
        guestEmail: '',
        guestPhone: '',
        guestAddress: '',
        checkIn: '',
        checkOut: '',
        adults: 1,
        children: 0,
        totalPrice: 0,
        notes: '',
        paymentMethod: 'Not paid',
        paymentType: 'full',
        amountPaid: 0
      })
      // Reload data to refresh calendar timeline with new booking
      await loadData()
    } catch (error: any) {
      console.error('Failed to create booking:', error)
      toast.error(`Failed to save booking: ${error?.message || 'Unknown error'}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between">
        {/* Date Navigation */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={previousMonth} className="h-10 w-10">
            <ChevronLeft className="w-5 h-5" />
          </Button>

          <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="h-10 px-4 font-medium">Today</Button>

          <Button variant="outline" size="icon" onClick={nextMonth} className="h-10 w-10">
            <ChevronRight className="w-5 h-5" />
          </Button>

          <div className="flex items-center gap-2 ml-4">
            <Button variant="outline" className="h-10 px-4 font-medium">{monthNames[month]}</Button>
            <Button variant="outline" className="h-10 px-4 font-medium">{year}</Button>
          </div>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded-lg overflow-hidden">
            <Button variant={viewMode === 'timeline' ? 'default' : 'ghost'} size="icon" onClick={() => setViewMode('timeline')} className="rounded-none h-10 w-10">
              <LayoutGrid className="w-5 h-5" />
            </Button>
            <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="icon" onClick={() => setViewMode('grid')} className="rounded-none h-10 w-10">
              <CalendarIcon className="w-5 h-5" />
            </Button>
            <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="icon" onClick={() => setViewMode('list')} className="rounded-none h-10 w-10">
              <List className="w-5 h-5" />
            </Button>
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10">
            <Filter className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Calendar Card */}
      <Card className="overflow-hidden">
        <CardContent className="p-0 flex flex-col" style={{ height: 'calc(100vh - 240px)' }}>
          {viewMode === 'timeline' ? (
            <CalendarTimeline
              currentDate={currentDate}
              properties={properties}
              bookings={bookings}
              monthNames={monthNames}
              weekDays={weekDays}
              onBookingUpdate={loadData}
            />
          ) : viewMode === 'grid' ? (
            <CalendarGridView
              currentDate={currentDate}
              properties={properties}
              bookings={bookings}
              monthNames={monthNames}
              weekDays={weekDays}
              onBookingUpdate={loadData}
            />
          ) : (
            <CalendarListView
              currentDate={currentDate}
              properties={properties}
              bookings={bookings}
              monthNames={monthNames}
              weekDays={weekDays}
              onBookingUpdate={loadData}
            />
          )}
        </CardContent>
      </Card>

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-500" />
            <span className="text-muted-foreground">Confirmed Booking</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-yellow-500" />
            <span className="text-muted-foreground">Pending</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-500" />
            <span className="text-muted-foreground">Checked In</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            className="bg-accent text-accent-foreground hover:bg-accent/80 border border-accent-foreground/20 shadow-sm font-medium transition-all duration-200 hover:shadow-md"
            onClick={() => navigate('/staff/onsite')}
          >
            <Users className="w-4 h-4 mr-2" />
            Group / Walk-in
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                New Booking
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Booking</DialogTitle>
                <DialogDescription>Enter booking details</DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="propertyId">Room*</Label>
                  <select
                    id="propertyId"
                    className="w-full px-3 py-2 border rounded-md"
                    value={formData.propertyId}
                    onChange={(e) => setFormData({ ...formData, propertyId: e.target.value })}
                    required
                  >
                    <option value="">Select a room</option>
                    {availableProperties.map((property: any) => {
                      const roomType = roomTypes.find((rt: any) => rt.id === property.propertyTypeId)
                      const pricePerNight = Number(roomType?.basePrice) || 0
                      return (
                        <option key={property.id} value={property.id}>
                          {property.name} (Room {property.roomNumber}) - {roomType?.name || ''} - {formatCurrencySync(pricePerNight, currency)}/night
                        </option>
                      )
                    })}
                  </select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="guestName">Guest Name*</Label>
                    <Input id="guestName" value={formData.guestName} onChange={(e) => setFormData({ ...formData, guestName: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="guestEmail">Guest Email*</Label>
                    <Input id="guestEmail" type="email" value={formData.guestEmail} onChange={(e) => setFormData({ ...formData, guestEmail: e.target.value })} required />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="guestPhone">Guest Phone</Label>
                    <Input id="guestPhone" value={formData.guestPhone} onChange={(e) => setFormData({ ...formData, guestPhone: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="guestAddress">Guest Address</Label>
                    <Input id="guestAddress" value={formData.guestAddress} onChange={(e) => setFormData({ ...formData, guestAddress: e.target.value })} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="checkIn">Check-in Date*</Label>
                    <Input id="checkIn" type="date" value={formData.checkIn} onChange={(e) => setFormData({ ...formData, checkIn: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="checkOut">Check-out Date*</Label>
                    <Input id="checkOut" type="date" value={formData.checkOut} onChange={(e) => setFormData({ ...formData, checkOut: e.target.value })} required />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="adults">Adults</Label>
                    <Input
                      id="adults"
                      type="number"
                      min="1"
                      value={formData.adults}
                      onChange={(e) => setFormData({ ...formData, adults: parseInt(e.target.value) || 1 })}
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="children">Children</Label>
                    <Input
                      id="children"
                      type="number"
                      min="0"
                      value={formData.children}
                      onChange={(e) => setFormData({ ...formData, children: parseInt(e.target.value) || 0 })}
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="totalPrice" className="h-6 flex items-center">
                      Total Price (auto-calculated)*
                    </Label>
                    <div className="flex items-center h-10 px-3 py-2 border rounded-md bg-secondary text-lg font-semibold text-primary">
                      {formatCurrencySync(formData.totalPrice, currency)}
                    </div>
                    {formData.checkIn && formData.checkOut && formData.propertyId && (() => {
                      const selectedProperty = properties.find((p: any) => p.id === formData.propertyId)
                      const roomType = selectedProperty ? roomTypes.find((rt: any) => rt.id === selectedProperty.propertyTypeId) : null
                      const pricePerNight = roomType ? Number(roomType.basePrice) : 0
                      return (
                        <p className="text-xs text-muted-foreground mt-1">
                          {calculateNights(formData.checkIn, formData.checkOut)} night(s) × {formatCurrencySync(pricePerNight, currency)}/night
                        </p>
                      )
                    })()}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Payment Type</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'full', label: '💵 Full Payment', color: 'bg-green-50 border-green-300 text-green-800' },
                      { value: 'part', label: '💰 Part Payment', color: 'bg-amber-50 border-amber-300 text-amber-800' },
                      { value: 'later', label: '⏳ Pay Later', color: 'bg-gray-50 border-gray-300 text-gray-700' }
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${formData.paymentType === opt.value
                            ? `${opt.color} ring-2 ring-offset-1 ring-primary/30`
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        onClick={() => setFormData({ ...formData, paymentType: opt.value as any })}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {formData.paymentType !== 'later' && (
                  <div className="space-y-2">
                    <Label htmlFor="paymentMethod">Payment Method</Label>
                    <select
                      id="paymentMethod"
                      className="w-full px-3 py-2 border rounded-md"
                      value={formData.paymentMethod}
                      onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                    >
                      <option value="Cash">Cash</option>
                      <option value="Mobile Money">Mobile Money</option>
                      <option value="Credit/Debit Card">Credit/Debit Card</option>
                    </select>
                  </div>
                )}

                {formData.paymentType === 'part' && (
                  <div className="space-y-2">
                    <Label htmlFor="amountPaid">Amount Paid</Label>
                    <Input
                      id="amountPaid"
                      type="number"
                      min="0"
                      max={formData.totalPrice}
                      step="0.01"
                      value={formData.amountPaid}
                      onChange={(e) => setFormData({ ...formData, amountPaid: parseFloat(e.target.value) || 0 })}
                      placeholder="Enter amount paid"
                    />
                    {formData.amountPaid > 0 && formData.totalPrice > 0 && (
                      <div className="flex items-center justify-between text-sm p-2 bg-amber-50 border border-amber-200 rounded-md">
                        <span className="text-amber-800">Remaining Balance:</span>
                        <span className="font-bold text-red-600">{formatCurrencySync(Math.max(0, formData.totalPrice - formData.amountPaid), currency)}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <textarea id="notes" className="w-full px-3 py-2 border rounded-md min-h-[80px]" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
                  <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create Booking'}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}