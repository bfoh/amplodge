import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Download, Printer, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { format, differenceInDays } from 'date-fns'
import { createInvoiceData, generateInvoicePDF, downloadInvoicePDF, printInvoice } from '@/services/invoice-service'
import { blink } from '@/blink/client'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'

export function InvoicePage() {
  const { invoiceNumber } = useParams<{ invoiceNumber: string }>()
  const { currency } = useCurrency()
  const [invoiceData, setInvoiceData] = useState<any>(null)
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

        const db = blink.db as any

        // Try to find a booking with this invoice number
        // Since invoice numbers are generated at checkout, we need to find the booking
        // For now, we'll fetch all checked-out bookings and find the matching one
        const bookings = await db.bookings.list({
          where: { status: 'checked-out' },
          limit: 500
        })

        // For this demo, we'll use the most recent checked-out booking
        // In production, you'd want to store invoiceNumber in the booking record
        const booking = bookings[0]

        if (!booking) {
          setError('Invoice not found. No checked-out bookings available.')
          setLoading(false)
          return
        }

        // Fetch associated guest and room data
        const [guest, room] = await Promise.all([
          db.guests.get(booking.guestId),
          db.rooms.get(booking.roomId)
        ])

        if (!guest || !room) {
          setError('Guest or room information not found.')
          setLoading(false)
          return
        }

        // Create booking with full details for invoice generation
        const bookingWithDetails = {
          ...booking,
          guest: guest,
          room: {
            roomNumber: room.roomNumber,
            roomType: room.roomType || 'Standard Room'
          }
        }

        const generatedInvoice = await createInvoiceData(bookingWithDetails, room)
        // Use the invoice number from URL
        generatedInvoice.invoiceNumber = invoiceNumber
        setInvoiceData(generatedInvoice)

        console.log('✅ [InvoicePage] Invoice loaded successfully')
      } catch (err: any) {
        console.error('❌ [InvoicePage] Failed to load invoice:', err)
        setError('Failed to load invoice details.')
      } finally {
        setLoading(false)
      }
    }
    loadInvoice()
  }, [invoiceNumber])

  const handleDownloadPdf = async () => {
    if (!invoiceData) {
      toast.error('Invoice data not available for download.')
      return
    }

    setDownloading(true)
    try {
      await downloadInvoicePDF(invoiceData)
      toast.success('Invoice downloaded successfully!')
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

  const { hotel, guest, booking, charges } = invoiceData

  return (
    <div className="container mx-auto p-6">
      {/* Action Buttons */}
      <div className="flex justify-end gap-4 mb-6">
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
              Download PDF
            </>
          )}
        </Button>
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
              <p className="text-sm text-gray-600"><strong>Invoice #:</strong> {invoiceNumber}</p>
              <p className="text-sm text-gray-600"><strong>Date:</strong> {format(new Date(invoiceData.invoiceDate), 'MMM dd, yyyy')}</p>
              <p className="text-sm text-gray-600"><strong>Booking ID:</strong> {booking.id}</p>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Hotel and Guest Information */}
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

          {/* Thank You Message */}
          <div className="mt-12 text-center text-gray-500 text-sm">
            <p>Thank you for staying at AMP Lodge! We hope to see you again soon.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}