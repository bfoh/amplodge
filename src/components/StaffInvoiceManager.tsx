import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, Printer, Search, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { createInvoiceData, downloadInvoicePDF, printInvoice } from '@/services/invoice-service'
import { blink } from '@/blink/client'

interface InvoiceRecord {
  id: string
  invoiceNumber: string
  guestName: string
  guestEmail: string
  roomNumber: string
  checkIn: string
  checkOut: string
  totalAmount: number
  status: string
  createdAt: string
}

// Simple loading component
const LoadingSpinner = () => (
  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
)

export function StaffInvoiceManager() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [printing, setPrinting] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Fetch real invoice data from database
  const loadInvoices = async () => {
      try {
        console.log('🔍 [StaffInvoiceManager] Loading real invoice data...')
        
        const db = blink.db as any
        
        // Fetch checked-out bookings (these should have invoices)
        const bookings = await db.bookings.list({ 
          where: { status: 'checked-out' },
          limit: 100,
          orderBy: { createdAt: 'desc' }
        })
        
        console.log('📊 [StaffInvoiceManager] Found bookings:', bookings.length)
        
        if (bookings.length === 0) {
          setInvoices([])
          setLoading(false)
          return
        }
        
        // Get guest and room data for each booking
        const guestIds = [...new Set(bookings.map((b: any) => b.guestId))]
        const roomIds = [...new Set(bookings.map((b: any) => b.roomId))]
        
        const [guests, rooms] = await Promise.all([
          db.guests.list({ where: { id: { in: guestIds } } }),
          db.rooms.list({ where: { id: { in: roomIds } } })
        ])
        
        // Create maps for quick lookup
        const guestMap = new Map(guests.map((g: any) => [g.id, g]))
        const roomMap = new Map(rooms.map((r: any) => [r.id, r]))
        
        // Convert bookings to invoice records
        const invoiceRecords: InvoiceRecord[] = bookings.map((booking: any) => {
          const guest = guestMap.get(booking.guestId)
          const room = roomMap.get(booking.roomId)
          
          // Generate invoice number if not exists
          const invoiceNumber = booking.invoiceNumber || `INV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
          
          return {
            id: booking.id,
            invoiceNumber: invoiceNumber,
            guestName: guest?.name || 'Unknown Guest',
            guestEmail: guest?.email || '',
            roomNumber: room?.roomNumber || 'N/A',
            checkIn: booking.checkIn,
            checkOut: booking.actualCheckOut || booking.checkOut,
            totalAmount: booking.totalPrice || 0,
            status: 'paid', // All checked-out bookings are considered paid
            createdAt: booking.createdAt
          }
        })
        
        console.log('✅ [StaffInvoiceManager] Loaded invoices:', invoiceRecords.length)
        setInvoices(invoiceRecords)
        
      } catch (error) {
        console.error('❌ [StaffInvoiceManager] Failed to load invoices:', error)
        toast.error('Failed to load invoices')
      } finally {
        setLoading(false)
      }
    }

  useEffect(() => {
    loadInvoices()
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadInvoices()
    setRefreshing(false)
  }

  const filteredInvoices = invoices.filter(invoice =>
    invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    invoice.guestName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    invoice.guestEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
    invoice.roomNumber.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleDownloadInvoice = async (invoice: InvoiceRecord) => {
    setDownloading(invoice.id)
    try {
      console.log('📥 [StaffInvoiceManager] Downloading invoice for booking:', invoice.id)
      
      const db = blink.db as any
      
      // Fetch the actual booking data
      const booking = await db.bookings.get(invoice.id)
      if (!booking) {
        throw new Error('Booking not found')
      }
      
      // Fetch guest and room data
      const [guest, room] = await Promise.all([
        db.guests.get(booking.guestId),
        db.rooms.get(booking.roomId)
      ])
      
      if (!guest || !room) {
        throw new Error('Guest or room data not found')
      }
      
      // Create booking with details for invoice
      const bookingWithDetails = {
        ...booking,
        guest: guest,
        room: {
          roomNumber: room.roomNumber,
          roomType: room.roomType || 'Standard Room'
        }
      }
      
      // Generate invoice data
      const invoiceData = await createInvoiceData(bookingWithDetails, room)
      
      // Override invoice number to match the record
      invoiceData.invoiceNumber = invoice.invoiceNumber
      
      await downloadInvoicePDF(invoiceData)
      toast.success(`Invoice ${invoice.invoiceNumber} downloaded successfully!`)
    } catch (error: any) {
      console.error('❌ [StaffInvoiceManager] Failed to download invoice:', error)
      toast.error(`Failed to download invoice: ${error.message}`)
    } finally {
      setDownloading(null)
    }
  }

  const handlePrintInvoice = async (invoice: InvoiceRecord) => {
    setPrinting(invoice.id)
    try {
      console.log('🖨️ [StaffInvoiceManager] Printing invoice for booking:', invoice.id)
      
      const db = blink.db as any
      
      // Fetch the actual booking data
      const booking = await db.bookings.get(invoice.id)
      if (!booking) {
        throw new Error('Booking not found')
      }
      
      // Fetch guest and room data
      const [guest, room] = await Promise.all([
        db.guests.get(booking.guestId),
        db.rooms.get(booking.roomId)
      ])
      
      if (!guest || !room) {
        throw new Error('Guest or room data not found')
      }
      
      // Create booking with details for invoice
      const bookingWithDetails = {
        ...booking,
        guest: guest,
        room: {
          roomNumber: room.roomNumber,
          roomType: room.roomType || 'Standard Room'
        }
      }
      
      // Generate invoice data
      const invoiceData = await createInvoiceData(bookingWithDetails, room)
      
      // Override invoice number to match the record
      invoiceData.invoiceNumber = invoice.invoiceNumber
      
      await printInvoice(invoiceData)
      toast.success(`Invoice ${invoice.invoiceNumber} sent to printer!`)
    } catch (error: any) {
      console.error('❌ [StaffInvoiceManager] Failed to print invoice:', error)
      toast.error(`Failed to print invoice: ${error.message}`)
    } finally {
      setPrinting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">Loading invoices...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Invoice Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Search and Refresh */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="search">Search Invoices</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="search"
                    placeholder="Search by invoice number, guest name, email, or room..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="pt-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  {refreshing ? (
                    <LoadingSpinner />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Invoices Table */}
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        {searchTerm ? 'No invoices found matching your search.' : 'No invoices available.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-sm">
                          {invoice.invoiceNumber}
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{invoice.guestName}</div>
                            <div className="text-sm text-muted-foreground">{invoice.guestEmail}</div>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          Room {invoice.roomNumber}
                        </TableCell>
                        <TableCell>
                          {format(new Date(invoice.checkIn), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          {format(new Date(invoice.checkOut), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell className="font-medium">
                          ${invoice.totalAmount.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            invoice.status === 'paid' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {invoice.status}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownloadInvoice(invoice)}
                              disabled={downloading === invoice.id}
                            >
                              {downloading === invoice.id ? (
                                <LoadingSpinner />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePrintInvoice(invoice)}
                              disabled={printing === invoice.id}
                            >
                              {printing === invoice.id ? (
                                <LoadingSpinner />
                              ) : (
                                <Printer className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Summary */}
            <div className="text-sm text-muted-foreground">
              Showing {filteredInvoices.length} of {invoices.length} invoices
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}