import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Download, Printer, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  createInvoiceData,
  downloadInvoicePDF,
  printInvoice,
  createGroupInvoiceData,
  downloadGroupInvoicePDF,
  createPreInvoiceData,
  downloadPreInvoicePDF,
  printPreInvoice,
  generateInvoiceHTML,
  generatePreInvoiceHTML,
  generateGroupInvoiceHTML,
} from '@/services/invoice-service'
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

export function InvoicePage() {
  const { invoiceNumber } = useParams<{ invoiceNumber: string }>()
  const [invoiceData, setInvoiceData] = useState<any>(null)
  const [isPreInvoice, setIsPreInvoice] = useState(false)
  const [groupInvoiceData, setGroupInvoiceData] = useState<any>(null)
  const [viewMode, setViewMode] = useState<'single' | 'group'>('single')
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Re-generate HTML whenever data or view mode changes
  useEffect(() => {
    const genHtml = async () => {
      if (!invoiceData) return
      try {
        const isGroup = viewMode === 'group' && groupInvoiceData
        let html: string
        if (isGroup) {
          html = await generateGroupInvoiceHTML(groupInvoiceData)
        } else if (isPreInvoice) {
          html = await generatePreInvoiceHTML(invoiceData)
        } else {
          html = await generateInvoiceHTML(invoiceData)
        }
        setHtmlContent(html)
      } catch (e) {
        console.error('[InvoicePage] HTML generation failed:', e)
      }
    }
    genHtml()
  }, [invoiceData, groupInvoiceData, viewMode, isPreInvoice])

  useEffect(() => {
    const loadInvoice = async () => {
      if (!invoiceNumber) {
        setError('Invoice number is missing.')
        setLoading(false)
        return
      }
      try {
        console.log('🔍 [InvoicePage] Loading invoice:', invoiceNumber)

        const searchParams = new URLSearchParams(window.location.search)
        const bookingIdParam = searchParams.get('bookingId')
        const typeParam = searchParams.get('type')

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
          guest: b.guests,
          room: {
            roomNumber: b.rooms?.room_number || 'N/A',
            roomType: b.rooms?.room_types?.name || 'Standard Room',
            basePrice: b.rooms?.room_types?.base_price || 0
          }
        })

        const { booking, type, bookings: groupBookings } = data
        if (!booking) throw new Error('No booking data returned')

        const mappedBooking = mapBooking(booking)
        const roomDetails = {
          roomNumber: mappedBooking.room.roomNumber,
          roomType: mappedBooking.room.roomType,
          basePrice: mappedBooking.room.basePrice
        }

        const isPreInvoiceRequest = typeParam === 'pre-invoice'
        const singleInvoice = isPreInvoiceRequest
          ? await createPreInvoiceData(mappedBooking, roomDetails)
          : await createInvoiceData(mappedBooking, roomDetails)

        singleInvoice.invoiceNumber = data.invoiceNumber || invoiceNumber

        setIsPreInvoice(isPreInvoiceRequest)
        setInvoiceData(singleInvoice)

        if (type === 'group' && groupBookings && groupBookings.length > 0) {
          const formattedSiblings = groupBookings.map((b: any) => mapBooking(b))
          const primary = data.primaryBooking ? mapBooking(data.primaryBooking) : mappedBooking
          const groupInvoice = await createGroupInvoiceData(formattedSiblings, {
            ...primary,
            guest: primary.guest,
            room: primary.room
          })
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
    const isGroup = viewMode === 'group' && groupInvoiceData
    const dataToUse = isGroup ? groupInvoiceData : invoiceData
    if (!dataToUse) { toast.error('Invoice data not available for download.'); return }

    setDownloading(true)
    try {
      if (isGroup) {
        await downloadGroupInvoicePDF(dataToUse)
      } else if (isPreInvoice) {
        await downloadPreInvoicePDF(dataToUse)
      } else {
        await downloadInvoicePDF(dataToUse)
      }
      toast.success(`${isGroup ? 'Group ' : isPreInvoice ? 'Pre-' : ''}Invoice downloaded successfully!`)
    } catch (err: any) {
      console.error('Failed to download PDF:', err)
      toast.error(`Failed to download invoice: ${err.message}`)
    } finally {
      setDownloading(false)
    }
  }

  const handlePrint = async () => {
    if (!invoiceData) { toast.error('Invoice data not available for printing.'); return }
    setPrinting(true)
    try {
      if (isPreInvoice) {
        await printPreInvoice(invoiceData)
      } else {
        await printInvoice(invoiceData)
      }
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
          <Loader2 className="h-12 w-12 animate-spin text-amber-700 mx-auto mb-4" />
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

  const isGroupView = viewMode === 'group' && !!groupInvoiceData

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 bg-white border-b shadow-sm px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <div>
          {groupInvoiceData && (
            <div className="flex items-center gap-2">
              <Switch
                id="invoice-mode"
                checked={viewMode === 'group'}
                onCheckedChange={(checked) => setViewMode(checked ? 'group' : 'single')}
              />
              <Label htmlFor="invoice-mode" className="cursor-pointer font-medium text-stone-700">
                {viewMode === 'group' ? 'Viewing Group Invoice' : 'Switch to Group Invoice'}
              </Label>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="bg-amber-700 hover:bg-amber-800 text-white"
          >
            {downloading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Downloading...</>
            ) : (
              <><Download className="mr-2 h-4 w-4" />Download PDF</>
            )}
          </Button>
          {!isGroupView && (
            <Button
              onClick={handlePrint}
              disabled={printing}
              variant="outline"
              className="border-stone-300 text-stone-700 hover:bg-stone-50"
            >
              {printing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Printing...</>
              ) : (
                <><Printer className="mr-2 h-4 w-4" />Print</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Invoice rendered via the same premium HTML template */}
      <div className="mx-auto py-8 px-4" style={{ maxWidth: '900px' }}>
        {htmlContent ? (
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            title={isPreInvoice ? 'Pre-Invoice' : isGroupView ? 'Group Invoice' : 'Invoice'}
            style={{
              width: '100%',
              height: '1200px',
              border: 'none',
              borderRadius: '6px',
              boxShadow: '0 4px 32px rgba(0,0,0,0.12)',
              background: '#fff'
            }}
            onLoad={() => {
              try {
                const doc = iframeRef.current?.contentDocument
                if (doc) {
                  const h = doc.documentElement.scrollHeight
                  if (h > 200 && iframeRef.current) {
                    iframeRef.current.style.height = (h + 40) + 'px'
                  }
                }
              } catch {}
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-96">
            <Loader2 className="h-8 w-8 animate-spin text-amber-700" />
          </div>
        )}
      </div>
    </div>
  )
}
