import { useMemo, useState } from 'react'
import { cn, formatCurrencySync } from '../lib/utils'
import { useCurrency } from '../hooks/use-currency'
import { getRoomDisplayName, calculateNights } from '../lib/display'
import { Users, CalendarIcon, Mail, Phone, DollarSign, MessageSquare, LogIn, LogOut, CheckCircle2, Clock, MapPin, CalendarPlus } from 'lucide-react'
import { createInvoiceData, generateInvoicePDF, blobToBase64 } from '@/services/invoice-service'
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
import { CheckOutDialog } from '@/components/dialogs/CheckOutDialog'
import { ExtendStayDialog } from '@/components/dialogs/ExtendStayDialog'
import { blink } from '../blink/client'

interface CalendarListViewProps {
  currentDate: Date
  properties: any[]
  bookings: any[]
  monthNames: string[]
  weekDays: string[]
  onBookingUpdate?: () => void
}

export function CalendarListView({
  currentDate,
  properties,
  bookings,
  monthNames,
  weekDays,
  onBookingUpdate,
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
        booking.guestName.toLowerCase().includes(term) ||
        booking.guestEmail.toLowerCase().includes(term) ||
        booking.guestPhone?.toLowerCase().includes(term) ||
        getRoomForBooking(booking)?.roomNumber?.toString().includes(term)
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
  const handleCheckOut = async (booking: any) => {
    setProcessing(true)
    try {
      const db = blink.db as any
      const remoteId = booking.remoteId || booking.id

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
          const db = blink.db as any
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
          downloadUrl: `${window.location.origin}/invoice/${invoiceData.invoiceNumber}?bookingId=${bookingWithDetails.id}`
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
      const checkOutDate = new Date(booking.checkOut).toISOString().split('T')[0]
      return checkOutDate === today && booking.status === 'checked-in'
    })
  }, [filteredBookings])

  return (
    <>
      {/* Header with filters */}
      <div className="p-4 border-b bg-muted/30">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <h3 className="text-lg font-semibold">Bookings List</h3>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {filteredBookings.length} total
              </Badge>
              {upcomingBookings.length > 0 && (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                  {upcomingBookings.length} upcoming
                </Badge>
              )}
              {currentBookings.length > 0 && (
                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                  {currentBookings.length} checked-in
                </Badge>
              )}
              {departingBookings.length > 0 && (
                <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                  {departingBookings.length} departing today
                </Badge>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Search bookings..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full md:w-64"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
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
      <div className="flex-1 overflow-auto p-4">
        {filteredBookings.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <CalendarIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No bookings found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {searchTerm || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first booking to get started'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBookings.map(booking => {
              const room = getRoomForBooking(booking)
              const statusInfo = getStatusInfo(booking.status)
              const isUpcoming = upcomingBookings.includes(booking)
              const isDeparting = departingBookings.includes(booking)

              return (
                <Card key={booking.id} className={cn(
                  "transition-all hover:shadow-md",
                  isDeparting && "border-orange-200 bg-orange-50/50"
                )}>
                  <CardContent className="p-4">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      {/* Guest Info */}
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-semibold text-lg">{booking.guestName}</h4>
                            <p className="text-sm text-muted-foreground">Room {room?.roomNumber || 'N/A'}</p>
                          </div>
                          <Badge className={cn("text-xs", statusInfo.color)}>
                            {statusInfo.label}
                          </Badge>
                        </div>

                        {/* Contact Info */}
                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-3">
                          {booking.guestEmail && (
                            <div className="flex items-center gap-1">
                              <Mail className="w-4 h-4" />
                              <span>{booking.guestEmail}</span>
                            </div>
                          )}
                          {booking.guestPhone && (
                            <div className="flex items-center gap-1">
                              <Phone className="w-4 h-4" />
                              <span>{booking.guestPhone}</span>
                            </div>
                          )}
                          {booking.guestAddress && (
                            <div className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              <span className="truncate max-w-[200px]">{booking.guestAddress}</span>
                            </div>
                          )}
                        </div>

                        {/* Booking Details */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="text-muted-foreground">Check-in</p>
                              <p className="font-medium">{new Date(booking.checkIn).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="text-muted-foreground">Check-out</p>
                              <p className="font-medium">{new Date(booking.checkOut).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="text-muted-foreground">Guests</p>
                              <p className="font-medium">{booking.numGuests}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="text-muted-foreground">Total</p>
                              <p className="font-medium">{formatCurrencySync(booking.totalPrice || 0, currency)}</p>
                            </div>
                          </div>
                        </div>

                        {/* Special indicators */}
                        {(isUpcoming || isDeparting) && (
                          <div className="mt-3 flex gap-2">
                            {isUpcoming && (
                              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                <Clock className="w-3 h-3 mr-1" />
                                Upcoming
                              </Badge>
                            )}
                            {isDeparting && (
                              <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                                <LogOut className="w-3 h-3 mr-1" />
                                Departing Today
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        {canCheckIn(booking) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCheckInDialog(booking)}
                            className="h-8"
                          >
                            <LogIn className="w-4 h-4 mr-1" />
                            Check In
                          </Button>
                        )}

                        {canCheckOut(booking) && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setExtendStayDialog(booking)}
                              className="h-8 text-amber-600 hover:text-amber-700"
                            >
                              <CalendarPlus className="w-4 h-4 mr-1" />
                              Extend
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCheckOutDialog(booking)}
                              className="h-8"
                            >
                              <LogOut className="w-4 h-4 mr-1" />
                              Check Out
                            </Button>
                          </>
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
        onConfirm={() => handleCheckOut(checkOutDialog!)}
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





