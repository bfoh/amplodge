import { useEffect, useState } from 'react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog"
import { Plus, Calendar, User, Home, Search, Trash2 } from 'lucide-react'
import { blink } from '../../blink/client'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/badge'
import { useStaffRole } from '../../hooks/use-staff-role'
import { bookingEngine } from '../../services/booking-engine'
import { calculateNights } from '../../lib/display'
import { activityLogService } from '../../services/activity-log-service'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'

// Helper function to get current user ID
async function getCurrentUserId(): Promise<string> {
  try {
    const user = await blink.auth.me()
    return user?.id || 'system'
  } catch (error) {
    console.error('Failed to get current user:', error)
    return 'system'
  }
}

interface BookingWithDetails {
  id: string
  remoteId?: string
  guestName: string
  guestEmail: string
  guestPhone: string
  roomNumber: string
  roomTypeName?: string
  checkIn: string
  checkOut: string
  status: string
  source?: string
  totalPrice: number
  numGuests: number
  nights: number
  paymentMethod?: string
}

export function BookingsPage() {
  const { staffRecord: staffData, role, loading: staffLoading } = useStaffRole()
  const { currency } = useCurrency()

  console.log('[BookingsPage] useStaffRole result:', { staffData, role, staffLoading })
  const [bookings, setBookings] = useState<BookingWithDetails[]>([])
  const [properties, setProperties] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
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
    paymentMethod: 'Not paid'
  })

  const activeStatuses = new Set(['reserved', 'confirmed', 'checked-in'])
  const isOverlap = (startA: string, endA: string, startB: string, endB: string) => {
    const aStart = new Date(startA).getTime()
    const aEnd = new Date(endA).getTime()
    const bStart = new Date(startB).getTime()
    const bEnd = new Date(endB).getTime()
    return aStart < bEnd && bStart < aEnd
  }
  const isRoomBooked = (roomNumber: string) => {
    if (!formData.checkIn || !formData.checkOut) return false
    return bookings.some((b) =>
      b.roomNumber === roomNumber && activeStatuses.has(b.status) &&
      isOverlap(formData.checkIn, formData.checkOut, b.checkIn, b.checkOut)
    )
  }

  // Get available properties (rooms from Rooms page) that are not booked
  const availableProperties = properties.filter((prop: any) => {
    if (!prop.roomNumber) return false
    return !isRoomBooked(prop.roomNumber)
  })

  // Auto-calculate price when property or dates change
  useEffect(() => {
    if (!formData.propertyId || !formData.checkIn || !formData.checkOut) return

    const selectedProperty = properties.find((p: any) => p.id === formData.propertyId)
    if (!selectedProperty) return

    const nights = calculateNights(formData.checkIn, formData.checkOut)
    const selectedRoomType = roomTypes.find((rt: any) => rt.id === selectedProperty.roomTypeId)
    const pricePerNight = Number(selectedRoomType?.basePrice) || 0
    const calculatedPrice = nights * pricePerNight

    setFormData(prev => ({ ...prev, totalPrice: calculatedPrice }))
  }, [formData.propertyId, formData.checkIn, formData.checkOut, properties, roomTypes])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      // Load bookings, properties (rooms), and room types
      const [allBookings, roomsData, roomTypesData] = await Promise.all([
        bookingEngine.getAllBookings(),
        (blink.db as any).rooms.list({ orderBy: { roomNumber: 'asc' } }),
        (blink.db as any).roomTypes.list()
      ])

      const roomTypeMap = new Map<string, string>((roomTypesData as any[]).map((rt: any) => [rt.id, rt.name]))
      const propertyTypeByRoomNumber = new Map<string, string>(
        (roomsData as any[]).map((p: any) => [p.roomNumber, p.roomTypeId])
      )

      // Transform to UI format and deduplicate
      const formattedBookings: BookingWithDetails[] = (allBookings as any[]).map((b: any) => {
        const nights = calculateNights(b.dates.checkIn, b.dates.checkOut)
        let roomTypeName = ''
        const typeIdFromProperty = propertyTypeByRoomNumber.get(b.roomNumber)
        if (typeIdFromProperty) {
          roomTypeName = roomTypeMap.get(typeIdFromProperty) || ''
        } else if (roomTypeMap.has(b.roomType)) {
          roomTypeName = roomTypeMap.get(b.roomType) || ''
        } else {
          roomTypeName = b.roomType || ''
        }

        return {
          id: b._id,
          remoteId: b.remoteId || b._id,
          guestName: b.guest.fullName,
          guestEmail: b.guest.email,
          guestPhone: b.guest.phone,
          roomNumber: b.roomNumber,
          roomTypeName,
          checkIn: b.dates.checkIn,
          checkOut: b.dates.checkOut,
          status: b.status,
          source: b.source,
          totalPrice: b.amount,
          numGuests: b.numGuests,
          nights,
          paymentMethod: b.payment_method || b.paymentMethod || 'Not paid'
        }
      })

      // Deduplicate bookings based on unique combination of guest email, room number, and dates
      const uniqueBookings = formattedBookings.reduce((acc: BookingWithDetails[], current: BookingWithDetails) => {
        const isDuplicate = acc.some(booking =>
          booking.guestEmail === current.guestEmail &&
          booking.roomNumber === current.roomNumber &&
          booking.checkIn === current.checkIn &&
          booking.checkOut === current.checkOut
        )

        if (!isDuplicate) {
          acc.push(current)
        } else {
          console.log(`[BookingsPage] Removed duplicate booking for ${current.guestEmail} in room ${current.roomNumber}`)
        }

        return acc
      }, [])

      setBookings(uniqueBookings)
      setProperties(roomsData as any[])
      setRoomTypes(roomTypesData as any[])
    } catch (error) {
      console.error('Failed to load data:', error)
      toast.error('Failed to load bookings')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    console.log('[BookingsPage] handleSubmit called with formData:', formData)

    if (!formData.propertyId || !formData.checkIn || !formData.checkOut) {
      console.error('[BookingsPage] Missing required fields')
      toast.error('Please fill in all required fields')
      return
    }

    if (!formData.guestName || !formData.guestEmail) {
      console.error('[BookingsPage] Missing guest info')
      toast.error('Guest name and email are required')
      return
    }

    try {
      // Find the selected property (room from Rooms page)
      const selectedProperty = properties.find((p: any) => p.id === formData.propertyId)
      console.log('[BookingsPage] Selected property:', selectedProperty)

      if (!selectedProperty) {
        console.error('[BookingsPage] Property not found for ID:', formData.propertyId)
        toast.error('Selected room not found')
        return
      }

      // Check if the room is available for the selected dates
      const isRoomBooked = bookings.some((b: any) => {
        // Skip cancelled bookings
        if (b.status === 'cancelled') return false

        // Skip inactive bookings (only consider active statuses)
        if (!['reserved', 'confirmed', 'checked-in'].includes(b.status)) return false

        // Check if this booking is for the same room
        if (b.roomNumber !== selectedProperty.roomNumber) return false

        // Check if dates overlap
        return isOverlap(formData.checkIn, formData.checkOut, b.checkIn, b.checkOut)
      })

      if (isRoomBooked) {
        toast.error('This room is already booked for the selected dates. Please choose different dates or a different room.')
        return
      }

      // Get room type name from propertyTypeId
      const selectedRoomType = roomTypes.find((rt: any) => rt.id === selectedProperty.roomTypeId)
      const roomTypeName = selectedRoomType?.name || ''
      console.log('[BookingsPage] Room type:', roomTypeName, 'from roomTypeId:', selectedProperty.roomTypeId)

      const bookingPayload: any = {
        guest: {
          fullName: formData.guestName,
          email: formData.guestEmail,
          phone: formData.guestPhone,
          address: formData.guestAddress
        },
        roomType: roomTypeName,
        roomNumber: selectedProperty.roomNumber,
        dates: {
          checkIn: formData.checkIn,
          checkOut: formData.checkOut
        },
        numGuests: formData.adults + formData.children,
        amount: formData.totalPrice,
        status: 'confirmed',
        source: 'reception',
        notes: formData.notes,
        payment_method: formData.paymentMethod,
        createdBy: staffData?.userId || staffData?.id,
        createdByName: staffData?.name || (staffData as any)?.user?.name || 'Staff'
      }

      // Comprehensive fallback: Get current user ID directly if staffData is not available
      let createdBy = staffData?.userId || staffData?.id
      console.log('[BookingsPage] Initial createdBy from staffData:', createdBy)

      if (!createdBy) {
        try {
          const currentUser = await blink.auth.me()
          createdBy = currentUser?.id
          console.log('[BookingsPage] Fallback: Using current user ID:', createdBy)
        } catch (error) {
          console.error('[BookingsPage] Failed to get current user:', error)
          // Last resort: generate a temporary ID
          createdBy = `temp-user-${Date.now()}`
          console.log('[BookingsPage] Last resort: Using temporary ID:', createdBy)
        }
      }

      // Update the payload with the resolved createdBy
      bookingPayload.createdBy = createdBy
      console.log('[BookingsPage] Final createdBy for booking:', createdBy)

      console.log('[BookingsPage] Calling bookingEngine.createBooking with:', bookingPayload)
      console.log('[BookingsPage] Staff data:', staffData)
      console.log('[BookingsPage] CreatedBy field:', createdBy)

      // Create booking using booking engine
      const result = await bookingEngine.createBooking(bookingPayload)

      console.log('[BookingsPage] Booking created successfully:', result)

      toast.success('Booking created successfully')
      setDialogOpen(false)
      setEditingId(null)
      resetForm()
      loadData()
    } catch (error: any) {
      console.error('[BookingsPage] Failed to save booking:', error)
      console.error('[BookingsPage] Error message:', error?.message)
      console.error('[BookingsPage] Error stack:', error?.stack)
      toast.error(`Failed to save booking: ${error?.message || 'Unknown error'}`)
    }
  }

  const resetForm = () => {
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
      paymentMethod: 'Not paid'
    })
  }

  const handleDeleteClick = (id: string) => {
    setDeleteId(id)
  }

  const confirmDelete = async () => {
    if (!deleteId) return

    try {
      console.log('[BookingsPage] Deleting booking with ID:', deleteId)

      const booking = bookings.find(b => b.id === deleteId)
      if (!booking) {
        toast.error('Booking not found')
        return
      }

      // Use bookingEngine.deleteBooking() which handles everything properly
      await bookingEngine.deleteBooking(deleteId)

      toast.success('Booking deleted successfully')

      // Optimistically remove from UI
      setBookings(prev => prev.filter(b => b.id !== deleteId))

      // Refresh data to ensure sync with backend
      await loadData()
    } catch (error) {
      console.error('[BookingsPage] Failed to delete booking:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete booking')
      // Reload data to restore UI state if deletion failed
      await loadData()
    } finally {
      setDeleteId(null)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-green-100 text-green-700 border-green-200'
      case 'pending':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'cancelled':
        return 'bg-red-100 text-red-700 border-red-200'
      case 'completed':
        return 'bg-blue-100 text-blue-700 border-blue-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const filteredBookings = bookings.filter((booking) =>
    booking.guestName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    booking.guestEmail?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">Bookings</h2>
          <p className="text-muted-foreground mt-1">Manage all your room bookings</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => {
              setEditingId(null)
              resetForm()
            }}>
              <Plus className="w-4 h-4 mr-2" />
              New Booking
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Booking' : 'Create New Booking'}</DialogTitle>
              <DialogDescription>
                Enter booking details
              </DialogDescription>
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
                    const roomType = roomTypes.find((rt: any) => rt.id === property.roomTypeId)
                    const pricePerNight = Number(roomType?.basePrice) || 0
                    return (
                      <option key={property.id} value={property.id}>
                        Room {property.roomNumber} • {roomType?.name || 'Room'} • {formatCurrencySync(pricePerNight, currency)}/night
                      </option>
                    )
                  })}
                </select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="guestName">Guest Name*</Label>
                  <Input
                    id="guestName"
                    value={formData.guestName}
                    onChange={(e) => setFormData({ ...formData, guestName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guestEmail">Guest Email*</Label>
                  <Input
                    id="guestEmail"
                    type="text"
                    value={formData.guestEmail}
                    onChange={(e) => setFormData({ ...formData, guestEmail: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="guestPhone">Guest Phone</Label>
                  <Input
                    id="guestPhone"
                    value={formData.guestPhone}
                    onChange={(e) => setFormData({ ...formData, guestPhone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guestAddress">Guest Address</Label>
                  <Input
                    id="guestAddress"
                    value={formData.guestAddress}
                    onChange={(e) => setFormData({ ...formData, guestAddress: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="checkIn">Check-in Date*</Label>
                  <Input
                    id="checkIn"
                    type="date"
                    value={formData.checkIn}
                    onChange={(e) => setFormData({ ...formData, checkIn: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkOut">Check-out Date*</Label>
                  <Input
                    id="checkOut"
                    type="date"
                    value={formData.checkOut}
                    onChange={(e) => setFormData({ ...formData, checkOut: e.target.value })}
                    required
                  />
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
                    const roomType = selectedProperty ? roomTypes.find((rt: any) => rt.id === selectedProperty.roomTypeId) : null
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
                <Label htmlFor="paymentMethod">Payment Method</Label>
                <select
                  id="paymentMethod"
                  className="w-full px-3 py-2 border rounded-md"
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                >
                  <option value="Not paid">Not paid</option>
                  <option value="Cash">Cash</option>
                  <option value="Mobile Money">Mobile Money</option>
                  <option value="Credit/Debit Card">Credit/Debit Card</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  className="w-full px-3 py-2 border rounded-md min-h-[80px]"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{editingId ? 'Save Changes' : 'Create Booking'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search bookings by guest name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {filteredBookings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Calendar className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">No Bookings Found</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              {searchTerm ? 'Try adjusting your search' : 'Create your first booking to get started'}
            </p>
            {!searchTerm && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Booking
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredBookings.map((booking) => (
            <Card key={booking.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">{booking.guestName}</h3>
                          <Badge className={getStatusColor(booking.status)}>
                            {booking.status}
                          </Badge>
                          {booking.source === 'voice_agent' && (
                            <Badge className="bg-purple-100 text-purple-800 border-purple-200">
                              Voice Agent
                            </Badge>
                          )}
                          {booking.source === 'online' && (
                            <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                              Online
                            </Badge>
                          )}
                        </div>
                        {booking.guestEmail && (
                          <p className="text-sm text-muted-foreground">{booking.guestEmail}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Home className="w-4 h-4" />
                        <span>Room {booking.roomNumber}{booking.roomTypeName ? ` • ${booking.roomTypeName}` : ''}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>
                          {new Date(booking.checkIn).toLocaleDateString()} -{' '}
                          {new Date(booking.checkOut).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <User className="w-4 h-4" />
                        <span>{booking.numGuests} guests</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Home className="w-4 h-4" />
                        <span>{booking.nights} nights</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">
                        {formatCurrencySync(Number(booking.totalPrice), currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrencySync(Number(booking.totalPrice) / booking.nights, currency)} per night
                      </p>
                      <p className="text-xs text-muted-foreground capitalize mt-1">
                        {booking.paymentMethod?.replace('_', ' ') || 'Not paid'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteClick(booking.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the booking
              and remove the data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
