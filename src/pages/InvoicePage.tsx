import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Download, Printer, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { format, differenceInDays } from 'date-fns'
import {
  createInvoiceData,
  generateInvoicePDF,
  downloadInvoicePDF,
  printInvoice,
  createGroupInvoiceData,
  downloadGroupInvoicePDF
} from '@/services/invoice-service'
import { blink } from '@/blink/client'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function InvoicePage() {
  const { invoiceNumber } = useParams<{ invoiceNumber: string }>()
  const { currency } = useCurrency()
  const [invoiceData, setInvoiceData] = useState<any>(null)
  const [groupInvoiceData, setGroupInvoiceData] = useState<any>(null) // New: Group Data State
  const [viewMode, setViewMode] = useState<'single' | 'group'>('single') // New: Toggle State
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const invoiceRef = useRef<HTMLDivElement>(null)


  useEffect(() => {
    const loadInvoice = async () => {
      if (!invoiceNumber) {
        setError('Invoice number is missing.')
        setLoading(false)
        return
      }
      try {
        console.log('🔍 [InvoicePage] Loading invoice:', invoiceNumber)

        // Check for bookingId in query params (Added for robustness)
        const searchParams = new URLSearchParams(window.location.search)
        const bookingIdParam = searchParams.get('bookingId')

        // Secure Fetch from Netlify Function
        const baseUrl = import.meta.env.VITE_API_URL || window.location.origin
        const params = new URLSearchParams()
        if (invoiceNumber) params.append('invoiceNumber', invoiceNumber)
        if (bookingIdParam) params.append('bookingId', bookingIdParam)

        const response = await fetch(`${baseUrl}/.netlify/functions/get-invoice-data?${params.toString()}`)

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.error || `Server Error: ${response.status}`)
        }


        const data = await response.json()
        console.log('✅ [InvoicePage] Secure Data Fetched:', data)

        // Helper to map snake_case DB result to camelCase application model
        const mapBooking = (b: any) => ({
          ...b,
          checkIn: b.check_in,
          checkOut: b.check_out,
          guestId: b.guest_id,
          roomId: b.room_id,
          totalPrice: b.total_price,
          numGuests: b.num_guests,
          roomType: b.rooms?.room_types?.name || 'Standard Room',
          roomNumber: b.rooms?.room_number || 'N/A',
          // Preserve nested objects
          guest: b.guests,
          room: {
            roomNumber: b.rooms?.room_number || 'N/A',
            roomType: b.rooms?.room_types?.name || 'Standard Room',
            basePrice: b.rooms?.room_types?.base_price || 0
          }
        })

        // 1. Process Single Invoice Data
        const { booking, type, bookings: groupBookings } = data

        if (!booking) throw new Error('No booking data returned')

        const mappedBooking = mapBooking(booking)

        // Re-hydrate single booking
        const singleInvoice = await createInvoiceData(mappedBooking, {
          roomNumber: mappedBooking.room.roomNumber,
          roomType: mappedBooking.room.roomType,
          basePrice: mappedBooking.room.basePrice
        })

        // Override invoice number with the one from URL/Response to match context
        singleInvoice.invoiceNumber = data.invoiceNumber || invoiceNumber

        setInvoiceData(singleInvoice)

        // 2. Process Group Invoice Data (if applicable)
        if (type === 'group' && groupBookings && groupBookings.length > 0) {
          console.log('👥 [InvoicePage] Processing Group Data...')

          // Format siblings for createGroupInvoiceData
          const formattedSiblings = groupBookings.map((b: any) => mapBooking(b))

          // Find primary or use the one returned
          const primary = data.primaryBooking ? mapBooking(data.primaryBooking) : mappedBooking

          const groupInvoice = await createGroupInvoiceData(formattedSiblings, {
            ...primary,
            guest: primary.guest,
            room: primary.room
          })

          // Sync voice number
          groupInvoice.invoiceNumber = `GRP-${data.invoiceNumber || invoiceNumber}`

          setGroupInvoiceData(groupInvoice)
        }

      } catch (err: any) {
        console.error('❌ [InvoicePage] Failed to load invoice:', err)
        setError(err.message || 'Failed to load invoice details.')
      } finally {
        setLoading(false)
      }
    }
    loadInvoice()
  }, [invoiceNumber])

  const handleDownloadPdf = async () => {
    // Determine which data/function to use based on viewMode
    const isGroup = viewMode === 'group' && groupInvoiceData
    const dataToUse = isGroup ? groupInvoiceData : invoiceData

    if (!dataToUse) {
      toast.error('Invoice data not available for download.')
      return
    }

    setDownloading(true)
    try {
      if (isGroup) {
        await downloadGroupInvoicePDF(dataToUse)
      } else {
        await downloadInvoicePDF(dataToUse)
      }
      toast.success(`${isGroup ? 'Group ' : ''}Invoice downloaded successfully!`)
    } catch (err: any) {
      console.error('Failed to download PDF:', err)
      toast.error(`Failed to download invoice: ${err.message}`)
    } finally {
      setDownloading(false)
    }
  }

  const handlePrint = async () => {
    if (!invoiceData) {
      toast.error('Invoice data not available for printing.')
      return
    }

    setPrinting(true)
    try {
      await printInvoice(invoiceData)
      toast.success('Invoice sent to printer!')
    } catch (err: any) {
      console.error('Failed to print:', err)
      toast.error(`Failed to print invoice: ${err.message}`)
    } finally {
      setPrinting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading invoice...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <Card className="w-full max-w-md text-center shadow-lg">
          <CardHeader>
            <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <CardTitle className="text-2xl font-bold text-red-700">Error Loading Invoice</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!invoiceData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md text-center shadow-lg">
          <CardHeader>
            <XCircle className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <CardTitle className="text-2xl font-bold text-gray-700">Invoice Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700">The invoice you are looking for does not exist.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Determine what to display based on viewMode
  const activeData = viewMode === 'group' && groupInvoiceData ? groupInvoiceData : invoiceData

  // NOTE: GroupInvoiceData structure is slightly different (bookings array) vs Single (charges object)
  // We need conditional rendering or a normalized check
  const isGroupView = viewMode === 'group' && !!groupInvoiceData

  // De-structure cautiously
  const { hotel, guest, booking, charges, summary, invoiceDate } = activeData


  return (
    <div className="container mx-auto p-6">
      {/* Action Buttons */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        {/* Toggle for Group Invoice */}
        {groupInvoiceData && (
          <div className="flex items-center space-x-2 bg-white p-2 rounded-lg border shadow-sm">
            <Switch
              id="invoice-mode"
              checked={viewMode === 'group'}
              onCheckedChange={(checked) => setViewMode(checked ? 'group' : 'single')}
            />
            <Label htmlFor="invoice-mode" className="cursor-pointer font-medium text-blue-900">
              {viewMode === 'group' ? 'Viewing Group Invoice' : 'View Group Invoice?'}
            </Label>
          </div>
        )}

        <div className="flex gap-4">
          <Button
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {downloading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download {viewMode === 'group' ? 'Group ' : ''}PDF
              </>
            )}
          </Button>
          {!isGroupView && (
            <Button
              onClick={handlePrint}
              disabled={printing}
              variant="outline"
              className="border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              {printing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Printing...
                </>
              ) : (
                <>
                  <Printer className="mr-2 h-4 w-4" />
                  Print Invoice
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Invoice Content */}
      <Card className="shadow-xl" ref={invoiceRef}>
        <CardHeader className="border-b pb-4 mb-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <img src="/amp.png" alt="AMP Lodge" className="h-14 w-auto mr-5" />
              <CardTitle className="text-4xl font-bold text-gray-800 leading-none">AMP Lodge</CardTitle>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600"><strong>Invoice #:</strong> {activeData.invoiceNumber}</p>
              <p className="text-sm text-gray-600"><strong>Date:</strong> {format(new Date(invoiceDate), 'MMM dd, yyyy')}</p>
              <p className="text-sm text-gray-600"><strong>{isGroupView ? 'Group Ref' : 'Booking ID'}:</strong> {isGroupView ? activeData.groupReference || 'N/A' : booking.id}</p>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Hotel and Guest Information  */}
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">Hotel Information:</h3>
              <p className="text-gray-600">{hotel.name}</p>
              <p className="text-gray-600">{hotel.address}</p>
              <p className="text-gray-600">{hotel.phone}</p>
              <p className="text-gray-600">{hotel.email}</p>
            </div>
            <div className="text-right">
              <h3 className="text-lg font-semibold text-gray-700 mb-2">Bill To:</h3>
              <p className="text-gray-600">{guest.name}</p>
              <p className="text-gray-600">{guest.email}</p>
              {guest.phone && <p className="text-gray-600">{guest.phone}</p>}
              {guest.address && <p className="text-gray-600">{guest.address}</p>}
            </div>
          </div>

          {isGroupView ? (
            /* GROUP VIEW CONTENT */
            <>
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Group Summary:</h3>
                <p className="text-gray-600"><strong>Total Rooms:</strong> {activeData.bookings?.length || 0}</p>
                <p className="text-gray-600"><strong>Check-in:</strong> {booking.checkIn}</p>
                <p className="text-gray-600"><strong>Check-out:</strong> {booking.checkOut}</p>
              </div>

              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Room Breakdown:</h3>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="py-2 text-gray-700">Room</th>
                      <th className="py-2 text-gray-700">Guest</th>
                      <th className="py-2 text-right text-gray-700">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeData.bookings?.map((b: any, idx: number) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-2">{b.room.roomType} - {b.room.roomNumber}</td>
                        <td className="py-2">{b.guest.name}</td>
                        <td className="py-2 text-right">{formatCurrencySync(b.totalPrice, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Group Totals */}
              <div className="flex justify-end">
                <div className="w-full md:w-1/2 space-y-2">
                  <div className="flex justify-between text-gray-700">
                    <span>Subtotal:</span>
                    <span>{formatCurrencySync(summary.subTotal, currency)}</span>
                  </div>
                  {/* Re-using tax structure from summary */}
                  <div className="flex justify-between text-gray-700">
                    <span>Tax & Levies:</span>
                    <span>{formatCurrencySync(summary.taxTotal || (summary.vat + summary.gfNhil + summary.tourismLevy), currency)}</span>
                  </div>
                  <div className="flex justify-between text-xl font-bold text-gray-800 border-t pt-2 mt-2">
                    <span>Grand Total:</span>
                    <span>{formatCurrencySync(summary.grandTotal, currency)}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* SINGLE VIEW CONTENT */
            <>
              {/* Booking Details */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Booking Details:</h3>
                <div className="grid grid-cols-2 gap-4 text-gray-600">
                  <div>
                    <p><strong>Room:</strong> {booking.roomType} - {booking.roomNumber}</p>
                    <p><strong>Check-in:</strong> {booking.checkIn}</p>
                    <p><strong>Check-out:</strong> {booking.checkOut}</p>
                  </div>
                  <div className="text-right">
                    <p><strong>Nights:</strong> {booking.nights}</p>
                    <p><strong>Guests:</strong> {booking.numGuests}</p>
                  </div>
                </div>
              </div>

              {/* Charges Table */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Charges:</h3>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="py-2 text-gray-700">Description</th>
                      <th className="py-2 text-right text-gray-700">Quantity</th>
                      <th className="py-2 text-right text-gray-700">Unit Price</th>
                      <th className="py-2 text-right text-gray-700">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-100">
                      <td className="py-2">{booking.roomType} - Room {booking.roomNumber}</td>
                      <td className="py-2 text-right">{charges.nights}</td>
                      <td className="py-2 text-right">{formatCurrencySync(charges.roomRate, currency)}</td>
                      <td className="py-2 text-right">{formatCurrencySync(charges.subtotal, currency)}</td>
                    </tr>
                    {/* Additional Charges - Optional if present in data */}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-full md:w-1/2 space-y-2">
                  <div className="flex justify-between text-gray-700">
                    <span>Subtotal:</span>
                    <span>{formatCurrencySync(charges.subtotal, currency)}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Tax ({Math.round(charges.taxRate * 100)}%):</span>
                    <span>{formatCurrencySync(charges.taxAmount, currency)}</span>
                  </div>
                  <div className="flex justify-between text-xl font-bold text-gray-800 border-t pt-2 mt-2">
                    <span>Total:</span>
                    <span>{formatCurrencySync(charges.total, currency)}</span>
                  </div>
                </div>
              </div>
            </>
          )}


          {/* Thank You Message */}
          <div className="mt-12 text-center text-gray-500 text-sm">
            <p>Thank you for staying at AMP Lodge! We hope to see you again soon.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}