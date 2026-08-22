import { useMemo, useState } from 'react'
import { cn, formatCurrencySync } from '../lib/utils'
import { useCurrency } from '../hooks/use-currency'
import { getRoomDisplayName, calculateNights } from '../lib/display'
import { Users, CalendarIcon, Mail, Phone, DollarSign, MessageSquare, LogIn, LogOut, CheckCircle2, Clock, MapPin, CalendarPlus } from 'lucide-react'
import { createInvoiceData, generateInvoicePDF, blobToBase64, buildGuestInvoiceUrl } from '@/services/invoice-service'
import { bookingEngine } from '../services/booking-engine'
import { sendCheckInNotification, sendCheckOutNotification } from '@/services/notifications'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { toast } from 'sonner'
import { CheckInDialog } from '@/components/dialogs/CheckInDialog'
import { CheckOutDialog, type CheckOutPayment } from '@/components/dialogs/CheckOutDialog'
import { recordBookingPayment } from '@/services/booking-payment-service'
import { ExtendStayDialog } from '@/components/dialogs/ExtendStayDialog'
import { db, auth } from '@/lib/db'

interface CalendarListViewProps {
  currentDate: Date
  properties: any[]
  bookings: any[]
  monthNames: string[]
  weekDays: string[]
  onBookingUpdate?: () => void
  user?: any
}

export function CalendarListView({
  currentDate,
  properties,
  bookings,
  monthNames,
  weekDays,
  onBookingUpdate,
  user
}: CalendarListViewProps) {
  const [checkInDialog, setCheckInDialog] = useState<any>(null)
  const [checkOutDialog, setCheckOutDialog] = useState<any>(null)
  const [extendStayDialog, setExtendStayDialog] = useState<any>(null)
  const [processing, setProcessing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const { currency } = useCurrency()

  // Filter and sort bookings
  const filteredBookings = useMemo(() => {
    let filtered = bookings

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(booking =>
        (booking.guestName || '').toLowerCase().includes(term) ||
        (booking.guestEmail || '').toLowerCase().includes(term) ||
        (booking.guestPhone || '').toLowerCase().includes(term) ||
        String(getRoomForBooking(booking)?.roomNumber ?? '').toLowerCase().includes(term)
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(booking => booking.status === statusFilter)
    }

    // Sort by check-in date
    return filtered.sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())
  }, [bookings, searchTerm, statusFilter])

  // Get room for a booking
  const getRoomForBooking = (booking: any) => {
    return properties.find(prop => prop.id === booking.propertyId || prop.id === booking.roomId)
  }

  // Get status color and label
  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'confirmed':
        return { color: 'bg-red-100 text-red-800 border-red-200', label: 'Confirmed' }
      case 'pending':
        return { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: 'Pending' }
      case 'checked-in':
        return { color: 'bg-green-100 text-green-800 border-green-200', label: 'Checked In' }
      case 'checked-out':
        return { color: 'bg-gray-100 text-gray-800 border-gray-200', label: 'Checked Out' }
      default:
        return { color: 'bg-gray-100 text-gray-800 border-gray-200', label: status }
    }
  }

  // Check-in handler
  // Check-in handler removed (logic moved to CheckInDialog)

  // Check-out handler
  const handleCheckOut = async (booking: any, payment?: CheckOutPayment) => {
    setProcessing(true)
    try {
      const remoteId = booking.remoteId || booking.id

      // Record the money taken at the desk before the status flips. Check-out
      // recorded nothing at all before, so every balance settled on departure
      // was invisible to the staff revenue reports.
      if (payment && payment.amount > 0) {
        try {
          await recordBookingPayment({
            bookingId: remoteId,
            stage: 'checkout',
            amount: payment.amount,
            method: payment.method,
            staffId: user?.id || '',
            staffName: user?.user_metadata?.full_name || user?.email || 'Staff',
          })
        } catch (payErr) {
          console.error('[CalendarListView] Failed to record check-out payment:', payErr)
        }
      }

      // Use booking engine to handle status update, timestamps, room status, logs, and cleanup tasks
      await bookingEngine.updateBookingStatus(remoteId, 'checked-out')

      // Get room info for invoice (fetched but status already updated by bookingEngine)
      const roomId = booking.propertyId || booking.roomId
      // Only needed for invoice generation below
      // ...

      // Generate and send invoice
      try {
        console.log('🚀 [CalendarListView] Starting invoice generation...', {
          bookingId: booking.remoteId || booking.id,
          guestName: booking.guestName,
          guestEmail: booking.guestEmail
        })

        // Create booking with details for invoice
        const bookingWithDetails = {
          id: booking.remoteId || booking.id,
          guestId: booking.guestId || '',
          roomId: roomId,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          status: 'checked-out',
          totalPrice: booking.totalPrice || 0,
          numGuests: booking.numGuests || 1,
          actualCheckOut: new Date().toISOString(),
          createdAt: booking.createdAt || new Date().toISOString(),
          guest: {
            name: booking.guestName,
            email: booking.guestEmail || '',
            phone: booking.guestPhone,
            address: booking.guestAddress
          },
          room: {
            roomNumber: getRoomForBooking(booking)?.roomNumber || 'N/A',
            roomType: getRoomForBooking(booking)?.name || 'Standard Room'
          }
        }

        console.log('📊 [CalendarListView] Creating invoice data...')
        // Generate invoice data
        const invoiceData = await createInvoiceData(bookingWithDetails, getRoomForBooking(booking))
        console.log('✅ [CalendarListView] Invoice data created:', invoiceData.invoiceNumber)

        // IMPORTANT: Save the invoice number to the booking record for consistency
        try {
          await db.bookings.update(bookingWithDetails.id, { invoiceNumber: invoiceData.invoiceNumber })
          console.log('✅ [CalendarListView] Invoice number saved to booking:', invoiceData.invoiceNumber)
        } catch (saveError) {
          console.error('⚠️ [CalendarListView] Failed to save invoice number:', saveError)
        }

        console.log('📄 [CalendarListView] Generating invoice PDF...')
        // Generate invoice PDF
        const invoicePdf = await generateInvoicePDF(invoiceData)
        console.log('✅ [CalendarListView] Invoice PDF generated')

        console.log('📧 [CalendarListView] Sending standard check-out notification with invoice...')

        // Prepare attachments (invoice PDF)
        const pdfBase64 = await blobToBase64(invoicePdf)
        const attachments = [
          {
            filename: `invoice-${invoiceData.invoiceNumber}.pdf`,
            content: pdfBase64,
            contentType: 'application/pdf'
          }
        ]

        // Prepare data for notification
        const guest = {
          id: bookingWithDetails.guestId,
          name: bookingWithDetails.guest.name,
          email: bookingWithDetails.guest.email,
          phone: bookingWithDetails.guest.phone || null
        }

        const roomInfo = {
          id: bookingWithDetails.roomId,
          roomNumber: bookingWithDetails.room?.roomNumber || 'N/A'
        }

        const bookingInfo = {
          id: bookingWithDetails.id,
          checkIn: bookingWithDetails.checkIn,
          checkOut: bookingWithDetails.checkOut,
          actualCheckOut: bookingWithDetails.actualCheckOut
        }

        const invoiceInfo = {
          invoiceNumber: invoiceData.invoiceNumber,
          totalAmount: invoiceData.charges.total,
          downloadUrl: await buildGuestInvoiceUrl(bookingWithDetails.id, invoiceData.invoiceNumber)
        }

        // Send standardized check-out email
        if (guest.email) {
          await sendCheckOutNotification(guest, roomInfo, bookingInfo, invoiceInfo, attachments)
          console.log('✅ [CalendarListView] Check-out email sent successfully')
          toast.success(`Guest ${booking.guestName} checked out successfully! Invoice sent to ${booking.guestEmail}.`)
        } else {
          console.warn('⚠️ [CalendarListView] No guest email, skipping check-out email')
          toast.success(`Guest ${booking.guestName} checked out successfully! Cleaning task created. No email sent (missing address).`)
        }
      } catch (invoiceError: any) {
        console.error('❌ [CalendarListView] Invoice generation/sending failed:', invoiceError)
        toast.success(`Guest ${booking.guestName} checked out successfully! Cleaning task created. Invoice generation failed.`)
      }

      setCheckOutDialog(null)
      onBookingUpdate?.()
    } catch (error) {
      console.error('Check-out failed:', error)
      toast.error('Failed to check out guest')
    } finally {
      setProcessing(false)
    }
  }

  // Determine if check-in is allowed
  const canCheckIn = (booking: any) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const checkInDate = new Date(booking.checkIn)
    checkInDate.setHours(0, 0, 0, 0)
    return booking.status === 'confirmed' && checkInDate <= today
  }

  // Determine if check-out is allowed
  const canCheckOut = (booking: any) => {
    return booking.status === 'checked-in'
  }

  // Get upcoming bookings (next 7 days)
  const upcomingBookings = useMemo(() => {
    const today = new Date()
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)

    return filteredBookings.filter(booking => {
      const checkInDate = new Date(booking.checkIn)
      return checkInDate >= today && checkInDate <= nextWeek && booking.status === 'confirmed'
    })
  }, [filteredBookings])

  // Get current bookings (checked-in)
  const currentBookings = useMemo(() => {
    return filteredBookings.filter(booking => booking.status === 'checked-in')
  }, [filteredBookings])

  // Get departing bookings (checking out today)
  const departingBookings = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]

    return filteredBookings.filter(booking => {
      if (!booking.checkOut) return false
      const d = new Date(booking.checkOut)
      if (isNaN(d.getTime())) return false
      const checkOutDate = d.toISOString().split('T')[0]
      return checkOutDate === today && booking.status === 'checked-in'
    })
  }, [filteredBookings])

  return (
    <>
      {/* Header with filters */}
      <div className="p-3 sm:p-4 border-b bg-muted/30">
        <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-1.5 sm:gap-2 md:flex-row md:items-center">
            <h3 className="text-base sm:text-lg font-semibold">Bookings Summary</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] sm:text-xs">
                {filteredBookings.length} total
              </Badge>
              {departingBookings.length > 0 && (
                <Badge variant="outline" className="text-[10px] sm:text-xs bg-orange-50 text-orange-700 border-orange-200">
                  {departingBookings.length} check-outs today
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="Guest or room..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:w-64 h-9 pl-8"
              />
              <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 border rounded-md text-sm bg-white h-9"
            >
              <option value="all">All Status</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="checked-in">Checked In</option>
              <option value="checked-out">Checked Out</option>
            </select>
          </div>
        </div>
      </div>

      {/* Bookings List */}
      <div className="flex-1 overflow-auto p-3 sm:p-4">
        {filteredBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <CalendarIcon className="w-10 h-10 mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">No bookings found</p>
            <p className="text-xs text-muted-foreground mt-1 px-4">
              Try adjusting your filters or search terms
            </p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {filteredBookings.map(booking => {
              const room = getRoomForBooking(booking)
              const statusInfo = getStatusInfo(booking.status)
              const isUpcoming = upcomingBookings.includes(booking)
              const isDeparting = departingBookings.includes(booking)

              return (
                <Card key={booking.id} className={cn(
                  "transition-all active:scale-[0.99] border-border/60 shadow-sm",
                  isDeparting && "border-orange-200 bg-orange-50/30"
                )}>
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex flex-col gap-3">
                      {/* Guest Info Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex flex-col gap-0.5">
                          <h4 className="font-bold text-base sm:text-lg text-stone-800 leading-tight">
                            {booking.guestName}
                          </h4>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] font-bold text-primary bg-primary/5 px-1.5 py-0.5 rounded border border-primary/10">
                              Room {room?.roomNumber || 'N/A'}
                            </span>
                            {isDeparting && (
                              <span className="text-[10px] font-bold text-orange-600 bg-orange-100/50 px-1.5 py-0.5 rounded">
                                DUE TODAY
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge className={cn("text-[10px] font-bold uppercase tracking-tight h-5", statusInfo.color)}>
                          {statusInfo.label}
                        </Badge>
                      </div>

                      {/* Booking Metadata Grid */}
                      <div className="grid grid-cols-2 gap-x-2 gap-y-3 py-2 border-y border-stone-100">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Check-in</span>
                          <div className="flex items-center gap-1 text-xs font-semibold text-stone-700">
                            <CalendarIcon className="w-3 h-3 text-stone-400" />
                            {new Date(booking.checkIn).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Check-out</span>
                          <div className="flex items-center gap-1 text-xs font-semibold text-stone-700">
                            <CalendarIcon className="w-3 h-3 text-stone-400" />
                            {new Date(booking.checkOut).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Guests</span>
                          <div className="flex items-center gap-1 text-xs font-semibold text-stone-700">
                            <Users className="w-3 h-3 text-stone-400" />
                            {booking.numGuests} {booking.numGuests === 1 ? 'Guest' : 'Guests'}
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Total Amount</span>
                          <div className="flex items-center gap-1 text-xs font-bold text-primary">
                            <DollarSign className="w-3 h-3" />
                            {formatCurrencySync(booking.totalPrice || 0, currency)}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-1">
                        {canCheckIn(booking) && (
                          <Button
                            size="sm"
                            onClick={() => setCheckInDialog(booking)}
                            className="flex-1 h-9 text-xs font-bold shadow-sm"
                          >
                            <LogIn className="w-3.5 h-3.5 mr-1.5" />
                            Check In
                          </Button>
                        )}

                        {canCheckOut(booking) && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setExtendStayDialog(booking)}
                              className="flex-1 h-9 text-xs font-bold border-amber-200 text-amber-700 hover:bg-amber-50"
                            >
                              <CalendarPlus className="w-3.5 h-3.5 mr-1.5" />
                              Extend
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCheckOutDialog(booking)}
                              className="flex-1 h-9 text-xs font-bold border-primary/20 text-primary hover:bg-primary/5 shadow-sm"
                            >
                              <LogOut className="w-3.5 h-3.5 mr-1.5" />
                              Check Out
                            </Button>
                          </>
                        )}
                        
                        {!canCheckIn(booking) && !canCheckOut(booking) && (
                           <div className="flex-1 text-[10px] text-muted-foreground flex items-center gap-1.5 bg-stone-50 p-2 rounded-md border border-stone-100">
                             <Clock className="w-3 h-3" />
                             {booking.status === 'checked-out' ? 'Booking completed' : 'No pending actions'}
                           </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Check-In Dialog */}
      <CheckInDialog
        open={!!checkInDialog}
        onOpenChange={(open) => !open && setCheckInDialog(null)}
        booking={checkInDialog}
        room={checkInDialog ? {
          ...getRoomForBooking(checkInDialog),
          status: 'available' // Assume available for calendar view logic
        } : null}
        guest={checkInDialog ? {
          id: checkInDialog.guestId,
          name: checkInDialog.guestName,
          email: checkInDialog.guestEmail,
          phone: checkInDialog.guestPhone
        } : null}
        user={user}
        onSuccess={() => {
          setCheckInDialog(null)
          onBookingUpdate?.()
        }}
      />

      {/* Check-Out Dialog */}
      <CheckOutDialog
        open={!!checkOutDialog}
        onOpenChange={(open) => !open && setCheckOutDialog(null)}
        booking={checkOutDialog}
        room={checkOutDialog ? getRoomForBooking(checkOutDialog) : null}
        guest={{ name: checkOutDialog?.guestName }}
        onConfirm={(payment) => handleCheckOut(checkOutDialog!, payment)}
        processing={processing}
      />

      {/* Extend Stay Dialog */}
      {extendStayDialog && (
        <ExtendStayDialog
          open={!!extendStayDialog}
          onOpenChange={(open) => !open && setExtendStayDialog(null)}
          booking={extendStayDialog}
          guest={{
            id: extendStayDialog.guestId || '',
            name: extendStayDialog.guestName || 'Guest',
            email: extendStayDialog.guestEmail || ''
          }}
          room={{
            id: extendStayDialog.roomId || '',
            roomNumber: getRoomForBooking(extendStayDialog)?.roomNumber || 'N/A'
          }}
          onExtensionComplete={() => onBookingUpdate?.()}
        />
      )}
    </>
  )
}





