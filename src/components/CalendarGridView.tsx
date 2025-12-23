import { useMemo, useState } from 'react'
import { cn } from '../lib/utils'
import { getRoomDisplayName, calculateNights } from '../lib/display'
import { Users, CalendarIcon, Mail, Phone, DollarSign, MessageSquare, LogIn, LogOut, CheckCircle2, CalendarPlus } from 'lucide-react'
import { createInvoiceData, generateInvoicePDF, blobToBase64 } from '@/services/invoice-service'
import { sendCheckInNotification, sendCheckOutNotification } from '@/services/notifications'
import { bookingEngine } from '../services/booking-engine'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from './ui/hover-card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { toast } from 'sonner'
import { CheckInDialog } from '@/components/dialogs/CheckInDialog'
import { CheckOutDialog } from '@/components/dialogs/CheckOutDialog'
import { ExtendStayDialog } from '@/components/dialogs/ExtendStayDialog'
import { blink } from '../blink/client'

interface CalendarGridViewProps {
  currentDate: Date
  properties: any[]
  bookings: any[]
  monthNames: string[]
  weekDays: string[]
  onBookingUpdate?: () => void
}

export function CalendarGridView({
  currentDate,
  properties,
  bookings,
  monthNames,
  weekDays,
  onBookingUpdate,
}: CalendarGridViewProps) {
  const [checkInDialog, setCheckInDialog] = useState<any>(null)
  const [checkOutDialog, setCheckOutDialog] = useState<any>(null)
  const [extendStayDialog, setExtendStayDialog] = useState<any>(null)
  const [processing, setProcessing] = useState(false)

  // Get month details
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()

  // Create calendar grid
  const calendarDays = useMemo(() => {
    const days = []

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null)
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day))
    }

    return days
  }, [year, month, daysInMonth, startingDayOfWeek])

  // Get bookings for a specific date
  const getBookingsForDate = (date: Date) => {
    if (!date) return []

    const dateStr = date.toISOString().split('T')[0]

    return bookings.filter(booking => {
      const checkIn = new Date(booking.checkIn).toISOString().split('T')[0]
      const checkOut = new Date(booking.checkOut).toISOString().split('T')[0]

      return dateStr >= checkIn && dateStr < checkOut
    })
  }

  // Get room for a booking
  const getRoomForBooking = (booking: any) => {
    return properties.find(prop => prop.id === booking.propertyId || prop.id === booking.roomId)
  }

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-red-500 text-white'
      case 'pending':
        return 'bg-yellow-500 text-white'
      case 'checked-in':
        return 'bg-green-500 text-white'
      case 'checked-out':
        return 'bg-gray-500 text-white'
      default:
        return 'bg-gray-400 text-white'
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

      // Get room info for invoice
      const roomId = booking.propertyId || booking.roomId
      let roomNumber = 'N/A'
      let room: any = null

      if (roomId) {
        const rooms = await db.rooms.list({ limit: 500 })
        room = rooms.find((r: any) => r.id === roomId)
        if (room) roomNumber = room.roomNumber || 'N/A'
      }

      // Generate and send invoice
      try {
        console.log('🚀 [CalendarGridView] Starting invoice generation...', {
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

        console.log('📊 [CalendarGridView] Creating invoice data...')
        // Generate invoice data
        const invoiceData = await createInvoiceData(bookingWithDetails, getRoomForBooking(booking))
        console.log('✅ [CalendarGridView] Invoice data created:', invoiceData.invoiceNumber)

        // IMPORTANT: Save the invoice number to the booking record for consistency
        try {
          const db = blink.db as any
          await db.bookings.update(bookingWithDetails.id, { invoiceNumber: invoiceData.invoiceNumber })
          console.log('✅ [CalendarGridView] Invoice number saved to booking:', invoiceData.invoiceNumber)
        } catch (saveError) {
          console.error('⚠️ [CalendarGridView] Failed to save invoice number:', saveError)
        }

        console.log('📄 [CalendarGridView] Generating invoice PDF...')
        // Generate invoice PDF
        const invoicePdf = await generateInvoicePDF(invoiceData)
        console.log('✅ [CalendarGridView] Invoice PDF generated')

        console.log('📧 [CalendarGridView] Sending standard check-out notification with invoice...')

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
          downloadUrl: `${window.location.origin}/invoice/${invoiceData.invoiceNumber}`
        }

        // Send standardized check-out email
        if (guest.email) {
          await sendCheckOutNotification(guest, roomInfo, bookingInfo, invoiceInfo, attachments)
          console.log('✅ [CalendarGridView] Check-out email sent successfully')
          toast.success(`Guest ${booking.guestName} checked out successfully! Invoice sent to ${booking.guestEmail}.`)
        } else {
          console.warn('⚠️ [CalendarGridView] No guest email, skipping check-out email')
          toast.success(`Guest ${booking.guestName} checked out successfully! Cleaning task created. No email sent (missing address).`)
        }

      } catch (invoiceError: any) {
        console.error('❌ [CalendarGridView] Invoice generation/sending failed:', invoiceError)
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

  return (
    <>
      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto">
        {/* Header with day names */}
        <div className="grid grid-cols-7 border-b bg-muted/50 sticky top-0 z-10">
          {weekDays.map(day => (
            <div key={day} className="p-3 text-center font-medium text-sm text-muted-foreground border-r last:border-r-0">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7">
          {calendarDays.map((date, index) => {
            const dayBookings = getBookingsForDate(date)
            const isToday = date && date.toDateString() === new Date().toDateString()
            const isCurrentMonth = date && date.getMonth() === month

            return (
              <div
                key={index}
                className={cn(
                  "min-h-[120px] border-r border-b last:border-r-0 p-2",
                  !isCurrentMonth && "bg-muted/30 text-muted-foreground",
                  isToday && "bg-primary/10 border-primary"
                )}
              >
                {date && (
                  <>
                    {/* Date number */}
                    <div className={cn(
                      "text-sm font-medium mb-2",
                      isToday && "text-primary font-bold"
                    )}>
                      {date.getDate()}
                    </div>

                    {/* Bookings for this day */}
                    <div className="space-y-1">
                      {dayBookings.map(booking => {
                        const room = getRoomForBooking(booking)
                        return (
                          <HoverCard key={booking.id}>
                            <HoverCardTrigger asChild>
                              <div
                                className={cn(
                                  "px-2 py-1 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity",
                                  getStatusColor(booking.status)
                                )}
                              >
                                <div className="font-medium truncate">
                                  {booking.guestName}
                                </div>
                                <div className="opacity-90 truncate">
                                  Room {room?.roomNumber || 'N/A'}
                                </div>
                              </div>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-80">
                              <div className="space-y-3">
                                <div>
                                  <h4 className="font-semibold text-lg">{booking.guestName}</h4>
                                  <p className="text-sm text-muted-foreground">Room {room?.roomNumber || 'N/A'}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-sm">
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
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-sm">
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
                                      <p className="font-medium">${booking.totalPrice?.toFixed(2) || '0.00'}</p>
                                    </div>
                                  </div>
                                </div>

                                {booking.guestEmail && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Mail className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">{booking.guestEmail}</span>
                                  </div>
                                )}

                                {booking.guestPhone && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Phone className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">{booking.guestPhone}</span>
                                  </div>
                                )}

                                <div className="flex items-center justify-between pt-2 border-t">
                                  <span className={cn(
                                    "px-2 py-1 rounded-full text-xs font-medium",
                                    getStatusColor(booking.status)
                                  )}>
                                    {booking.status.replace('-', ' ')}
                                  </span>

                                  <div className="flex gap-1">
                                    {canCheckIn(booking) && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setCheckInDialog(booking)}
                                        className="h-7 px-2 text-xs"
                                      >
                                        <LogIn className="w-3 h-3 mr-1" />
                                        Check In
                                      </Button>
                                    )}

                                    {canCheckOut(booking) && (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => setExtendStayDialog(booking)}
                                          className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700"
                                        >
                                          <CalendarPlus className="w-3 h-3 mr-1" />
                                          Extend
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => setCheckOutDialog(booking)}
                                          className="h-7 px-2 text-xs"
                                        >
                                          <LogOut className="w-3 h-3 mr-1" />
                                          Check Out
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
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
