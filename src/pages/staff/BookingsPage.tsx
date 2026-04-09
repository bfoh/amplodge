import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react'
import * as syncQueue from '../../lib/sync-queue'
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
import { Plus, Calendar, User, Home, Search, Trash2, Users, QrCode, ExternalLink, Smartphone, Printer, BookOpen, X as XIcon } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QRCodeSVG } from 'qrcode.react'
import { blink } from '../../blink/client'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/badge'
import { useStaffRole } from '../../hooks/use-staff-role'
import { bookingEngine } from '../../services/booking-engine'
import { calculateNights } from '../../lib/display'
import { activityLogService } from '../../services/activity-log-service'
import { cn, formatCurrencySync, getCurrencySymbol } from '@/lib/utils'
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
  guestToken?: string
  groupId?: string
  groupReference?: string
}

export function BookingsPage() {
  const navigate = useNavigate()
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
  const [qrBooking, setQrBooking] = useState<BookingWithDetails | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [syncState, setSyncState] = useState(syncQueue.getSyncState())
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
    amountPaid: 0,
    paymentSplits: [{ method: 'cash', amount: 0 }]
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

    setFormData(prev => {
      let newSplits = prev.paymentSplits
      if (prev.paymentType === 'full' && newSplits.length === 1) {
        newSplits = [{ ...newSplits[0], amount: calculatedPrice }]
      }
      return { ...prev, totalPrice: calculatedPrice, paymentSplits: newSplits }
    })
  }, [formData.propertyId, formData.checkIn, formData.checkOut, properties, roomTypes])

  useEffect(() => {
    loadData()
    // Subscribe to sync state changes
    const unsubscribe = syncQueue.onSyncStateChange((state) => {
      setSyncState(state)
    })
    return () => unsubscribe()
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
          paymentMethod: b.payment_method || b.paymentMethod || 'Not paid',
          guestToken: b.guest_token,
          groupId: b.groupId,
          groupReference: b.groupReference,
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

      const primaryPaymentMethod = formData.paymentType === 'later'
        ? 'Not paid'
        : formData.paymentSplits.reduce((prev, current) => (Number(current.amount) || 0) > (Number(prev.amount) || 0) ? current : prev, formData.paymentSplits[0]).method
      
      const splitsPaidTotal = formData.paymentSplits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0)
      
      const paymentSplitsData = formData.paymentType !== 'later' && formData.paymentSplits.filter(s => (Number(s.amount) || 0) > 0).length > 1
        ? formData.paymentSplits.filter(s => (Number(s.amount) || 0) > 0).map(s => ({ method: s.method, amount: Number(s.amount) || 0 }))
        : undefined

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
        payment_method: primaryPaymentMethod,
        amountPaid: formData.paymentType === 'full' ? formData.totalPrice : formData.paymentType === 'part' ? splitsPaidTotal : 0,
        paymentStatus: formData.paymentType === 'full' ? 'full' : formData.paymentType === 'part' ? 'part' : 'pending',
        paymentMethod: primaryPaymentMethod,
        paymentSplits: paymentSplitsData,
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

      // Log booking creation to activity logs
      try {
        const userId = await getCurrentUserId()
        await activityLogService.log({
          action: 'created',
          entityType: 'booking',
          entityId: result?.id || result?._id || 'unknown',
          details: {
            guestName: formData.guestName,
            guestEmail: formData.guestEmail,
            roomNumber: selectedProperty.roomNumber,
            checkIn: formData.checkIn,
            checkOut: formData.checkOut,
            amount: formData.totalPrice,
            source: 'reception',
            paymentMethod: bookingPayload.paymentMethod,
            createdAt: new Date().toISOString()
          },
          userId
        })
        console.log('✅ [BookingsPage] Booking creation logged')
      } catch (logError) {
        console.error('⚠️ [BookingsPage] Activity logging failed:', logError)
      }

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
      paymentMethod: 'Not paid',
      paymentType: 'full',
      amountPaid: 0,
      paymentSplits: [{ method: 'cash', amount: 0 }]
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

      // Log booking deletion to activity logs
      try {
        const userId = await getCurrentUserId()
        await activityLogService.log({
          action: 'deleted',
          entityType: 'booking',
          entityId: deleteId,
          details: {
            guestName: booking.guestName,
            guestEmail: booking.guestEmail,
            roomNumber: booking.roomNumber,
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            amount: booking.totalPrice,
            deletedAt: new Date().toISOString()
          },
          userId
        })
        console.log('✅ [BookingsPage] Booking deletion logged')
      } catch (logError) {
        console.error('⚠️ [BookingsPage] Activity logging failed:', logError)
      }

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

  // const handlePortalClick = async (booking: BookingWithDetails) => {
  //   // Legacy function removed
  // }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      case 'checked-in': return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
      case 'checked-out': return 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
      case 'reserved': return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
      case 'pending': return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
      case 'cancelled': return 'bg-red-50 text-red-700 ring-1 ring-red-200'
      case 'completed': return 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
      default: return 'bg-gray-50 text-gray-700 ring-1 ring-gray-200'
    }
  }

  const getStatusBorderColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'border-l-emerald-500'
      case 'checked-in': return 'border-l-blue-500'
      case 'checked-out': return 'border-l-slate-400'
      case 'reserved': return 'border-l-amber-500'
      case 'pending': return 'border-l-amber-500'
      case 'cancelled': return 'border-l-red-400'
      default: return 'border-l-gray-300'
    }
  }

  const filteredBookings = bookings.filter((booking) =>
    booking.guestName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    booking.guestEmail?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const confirmedCount = bookings.filter(b => b.status === 'confirmed').length
  const checkedInCount = bookings.filter(b => b.status === 'checked-in').length
  const checkedOutCount = bookings.filter(b => b.status === 'checked-out').length
  const cancelledCount = bookings.filter(b => b.status === 'cancelled').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Sync Status Banner */}
      {syncState.pendingCount > 0 && (
        <div className={cn(
          "flex items-center justify-between p-3 rounded-lg border shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-300",
          syncState.status === 'error' ? "bg-red-50 border-red-200 text-red-800" : "bg-primary/5 border-primary/20 text-primary"
        )}>
          <div className="flex items-center gap-3">
            {syncState.status === 'syncing' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : syncState.status === 'error' ? (
              <AlertCircle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <div className="text-sm">
              <span className="font-bold">{syncState.pendingCount} offline {syncState.pendingCount === 1 ? 'change' : 'changes'} pending.</span>
              {syncState.status === 'error' && (
                <span className="ml-1 opacity-90 italic">Some items are failing and retrying...</span>
              )}
              {syncState.status === 'syncing' && (
                <span className="ml-1 opacity-90">{syncState.currentMessage || 'Uploading to database...'}</span>
              )}
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 text-xs font-semibold hover:bg-white/50" 
            onClick={async () => {
              if (syncState.status === 'error') {
                await syncQueue.retryFailed()
              }
              // The triggerSync in supabase-wrapper is private, but processQueue is public.
              // We'll rely on the heartbeat or wait for it to naturally trigger.
            }}
          >
            {syncState.status === 'error' ? 'Retry All' : 'Syncing...'}
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
          </div>
          <p className="text-sm text-muted-foreground">{bookings.length} total bookings</p>
        </div>
        <div className="flex gap-2">
          <Button
            className="bg-accent text-accent-foreground hover:bg-accent/80 border border-accent-foreground/20 shadow-sm font-medium transition-all duration-200 hover:shadow-md"
            onClick={() => setQrBooking({} as any)}
          >
            <QrCode className="w-4 h-4 mr-2" />
            Print Room QR
          </Button>
          <Button
            className="bg-accent text-accent-foreground hover:bg-accent/80 border border-accent-foreground/20 shadow-sm font-medium transition-all duration-200 hover:shadow-md"
            onClick={() => navigate('/staff/onsite')}
          >
            <Users className="w-4 h-4 mr-2" />
            Group / Walk-in
          </Button>
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
                        onClick={() => {
                          let newSplits = [...formData.paymentSplits]
                          if (opt.value === 'full') {
                            newSplits = [{ method: formData.paymentSplits[0]?.method === 'not_paid' ? 'cash' : (formData.paymentSplits[0]?.method || 'cash'), amount: formData.totalPrice }]
                          } else if (opt.value === 'part') {
                            newSplits = [{ method: 'cash', amount: 0 }]
                          } else {
                            newSplits = [{ method: 'cash', amount: 0 }]
                          }
                          setFormData({ ...formData, paymentType: opt.value as any, paymentSplits: newSplits })
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Split Payment Rows */}
                {formData.paymentType !== 'later' && (
                  <div className="space-y-2 pt-1">
                    <Label className="block text-sm font-medium">
                      {formData.paymentType === 'full' ? 'Payment Method' : 'Payment Method(s) & Amounts'}
                    </Label>
                    {formData.paymentSplits.map((split, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Select value={split.method} onValueChange={v => setFormData(prev => ({ ...prev, paymentSplits: prev.paymentSplits.map((s, j) => j === i ? { ...s, method: v } : s) }))}>
                          <SelectTrigger className="w-44 shrink-0 h-10">
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
                              setFormData(prev => ({ ...prev, paymentSplits: prev.paymentSplits.map((s, j) => j === i ? { ...s, amount: val } : s) }))
                            }}
                            className="pl-8 h-10"
                          />
                        </div>
                        {formData.paymentSplits.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, paymentSplits: prev.paymentSplits.filter((_, j) => j !== i) }))}
                            className="text-destructive hover:text-destructive/80 p-1 rounded hover:bg-destructive/10 transition-colors shrink-0"
                          >
                            <XIcon className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {/* Running total for multi-splits */}
                    {formData.paymentSplits.length > 1 && (() => {
                      const splitTotal = formData.paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
                      const diff = (formData.paymentType === 'full' ? formData.totalPrice : 0) - splitTotal
                      return (
                        <div className="flex justify-between text-xs px-1">
                          <span className="text-muted-foreground">Splits total</span>
                          <span className={diff === 0 || formData.paymentType === 'part' ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                            {formatCurrencySync(splitTotal, currency)}
                            {formData.paymentType === 'full' && diff > 0 && ` · ${formatCurrencySync(diff, currency)} short`}
                            {formData.paymentType === 'full' && diff < 0 && ` · ${formatCurrencySync(Math.abs(diff), currency)} over`}
                            {(formData.paymentType === 'part' || diff === 0) && ' ✓'}
                          </span>
                        </div>
                      )
                    })()}
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, paymentSplits: [...prev.paymentSplits, { method: 'cash', amount: 0 }] }))}
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add another payment method
                    </button>
                    
                    {/* Remaining balance for part payment */}
                    {formData.paymentType === 'part' && formData.totalPrice > 0 && (
                      <div className="flex items-center justify-between text-sm p-2 bg-amber-50 border border-amber-200 rounded-md mt-2">
                        <span className="text-amber-800">Remaining Balance:</span>
                        <span className="font-bold text-red-600">
                          {formatCurrencySync(Math.max(0, formData.totalPrice - formData.paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0)), currency)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

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
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600" />
          <p className="text-xs font-medium text-muted-foreground">Confirmed</p>
          <p className="text-2xl font-bold mt-1">{confirmedCount}</p>
        </div>
        <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-600" />
          <p className="text-xs font-medium text-muted-foreground">Checked In</p>
          <p className="text-2xl font-bold mt-1">{checkedInCount}</p>
        </div>
        <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-slate-400 to-slate-600" />
          <p className="text-xs font-medium text-muted-foreground">Checked Out</p>
          <p className="text-2xl font-bold mt-1">{checkedOutCount}</p>
        </div>
        <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-red-400 to-red-600" />
          <p className="text-xs font-medium text-muted-foreground">Cancelled</p>
          <p className="text-2xl font-bold mt-1">{cancelledCount}</p>
        </div>
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
            <Card key={booking.id} className={`hover:shadow-md transition-shadow border-l-4 ${getStatusBorderColor(booking.status)}`}>
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-lg">{booking.guestName}</h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(booking.status)}`}>
                            {booking.status}
                          </span>
                          {booking.groupReference && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                              <Users className="w-3 h-3 mr-1" />{booking.groupReference}
                            </span>
                          )}
                          {booking.source === 'voice_agent' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 ring-1 ring-purple-200">
                              Voice Agent
                            </span>
                          )}
                          {booking.source === 'online' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 ring-1 ring-sky-200">
                              Online
                            </span>
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

      {/* QR Code Dialog */}
      <Dialog open={!!qrBooking} onOpenChange={(open) => !open && setQrBooking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Room QR Code</DialogTitle>
            <DialogDescription>
              Static QR Code for Room {qrBooking?.roomNumber || 'Guests'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-6 space-y-6">
            <div id="printable-qr" className="bg-white p-4 rounded-xl shadow-sm border">
              <QRCodeSVG
                value="https://amplodge.org/guest"
                size={200}
                level="H"
                includeMargin={true}
              />
            </div>

            <div className="text-center space-y-2">
              <p className="text-sm font-medium">Scan to login</p>
              <div className="flex items-center gap-2 justify-center">
                <code className="bg-muted px-2 py-1 rounded text-xs select-all">
                  https://amplodge.org/guest
                </code>
              </div>
            </div>

            <div className="w-full bg-blue-50 p-3 rounded-lg flex items-start gap-3 text-sm text-blue-800">
              <Smartphone className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Instructions</p>
                <p className="text-blue-700/80 text-xs">
                  Print this QR code and place it in the room. Guests will scan it and enter their Room Number + First Name to login.
                </p>
              </div>
            </div>

            <Button
              onClick={() => {
                const printContent = document.getElementById('printable-qr');
                if (!printContent) return;
                const printWindow = window.open('', '_blank');
                if (!printWindow) return;
                printWindow.document.write(`
                  <html>
                    <head>
                      <title>AMP Lodge - Guest QR Code</title>
                      <style>
                        body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                        .container { text-align: center; padding: 40px; }
                        h1 { margin-bottom: 10px; }
                        p { color: #666; margin-bottom: 30px; }
                        .qr-container { background: white; padding: 20px; border: 2px solid #ddd; border-radius: 12px; display: inline-block; }
                        .url { margin-top: 20px; font-size: 14px; color: #333; }
                        .instructions { margin-top: 30px; padding: 20px; background: #f0f9ff; border-radius: 8px; max-width: 400px; }
                        .instructions h3 { margin: 0 0 10px 0; color: #1e40af; }
                        .instructions p { margin: 0; color: #1e40af; font-size: 14px; }
                      </style>
                    </head>
                    <body>
                      <div class="container">
                        <h1>AMP Lodge</h1>
                        <p>Guest Service Portal</p>
                        <div class="qr-container">
                          ${printContent.innerHTML}
                        </div>
                        <div class="url"><strong>https://amplodge.org/guest</strong></div>
                        <div class="instructions">
                          <h3>How to Login</h3>
                          <p>Scan this QR code with your phone camera, then enter your Room Number and First Name.</p>
                        </div>
                      </div>
                    </body>
                  </html>
                `);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
              }}
              className="w-full"
              size="lg"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print QR Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>


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
