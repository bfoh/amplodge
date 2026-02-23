import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, Printer, Search, RefreshCw, Filter, Receipt, MoreHorizontal, Users, FileText } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from 'sonner'
import { format } from 'date-fns'
import { createInvoiceData, downloadInvoicePDF, printInvoice, createPreInvoiceData, downloadPreInvoicePDF, printPreInvoice, PreInvoiceData, createGroupInvoiceData, downloadGroupInvoicePDF } from '@/services/invoice-service'
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
  status: 'paid' | 'pending'
  createdAt: string
  isPreInvoice: boolean
  groupId?: string
}

// Simple loading component
const LoadingSpinner = () => (
  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
)

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-600/20',
    pending: 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-600/20',
  }

  const defaultStyle = 'bg-gray-50 text-gray-700 border-gray-200 ring-gray-600/20'
  const style = styles[status] || defaultStyle

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ring-1 ring-inset ${style} capitalize shadow-sm`}>
      {status === 'pending' ? 'Pre-Invoice' : 'Paid'}
    </span>
  )
}

export function StaffInvoiceManager() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [printing, setPrinting] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('all')

  // Fetch real invoice data from database
  const loadInvoices = async () => {
    try {
      console.log('🔍 [StaffInvoiceManager] Loading invoice data...')

      const db = blink.db as any

      // Fetch BOTH confirmed bookings (pre-invoices) AND checked-out bookings (paid invoices)
      const [confirmedBookings, checkedOutBookings] = await Promise.all([
        db.bookings.list({
          where: { status: 'confirmed' },
          limit: 100,
          orderBy: { createdAt: 'desc' }
        }),
        db.bookings.list({
          where: { status: 'checked-out' },
          limit: 100,
          orderBy: { createdAt: 'desc' }
        })
      ])

      const allBookings = [...confirmedBookings, ...checkedOutBookings]

      console.log('📊 [StaffInvoiceManager] Found bookings:', {
        confirmed: confirmedBookings.length,
        checkedOut: checkedOutBookings.length,
        total: allBookings.length
      })

      if (allBookings.length === 0) {
        setInvoices([])
        setLoading(false)
        return
      }

      // Get guest and room data for each booking
      const guestIds = [...new Set(allBookings.map((b: any) => b.guestId).filter(Boolean))] as string[]
      const roomIds = [...new Set(allBookings.map((b: any) => b.roomId).filter(Boolean))] as string[]

      const [guests, rooms] = await Promise.all([
        guestIds.length > 0 ? db.guests.list({ where: { id: { in: guestIds } } }) : Promise.resolve([]),
        roomIds.length > 0 ? db.rooms.list({ where: { id: { in: roomIds } } }) : Promise.resolve([])
      ])

      // Create maps for quick lookup
      const guestMap = new Map(guests.map((g: any) => [g.id, g]))
      const roomMap = new Map(rooms.map((r: any) => [r.id, r]))

      // Convert bookings to invoice records
      const invoiceRecords: InvoiceRecord[] = allBookings.map((booking: any) => {
        const guest = booking.guestId ? guestMap.get(booking.guestId) as any : undefined
        const room = booking.roomId ? roomMap.get(booking.roomId) as any : undefined
        const isPreInvoice = booking.status === 'confirmed'

        // Generate invoice number
        const baseInvoiceNumber = booking.invoiceNumber || `INV-${booking.createdAt ? new Date(booking.createdAt).getTime() : Date.now()}`
        const invoiceNumber = isPreInvoice ? `PRE-${baseInvoiceNumber}` : baseInvoiceNumber

        // Parse metadata from specialRequests if present
        let groupId = (booking as any).groupId // Try direct property first
        if (!groupId && booking.specialRequests && typeof booking.specialRequests === 'string') {
          const match = booking.specialRequests.match(/<!-- GROUP_DATA:(.*?) -->/)
          if (match && match[1]) {
            try {
              const groupData = JSON.parse(match[1])
              groupId = groupData.groupId
            } catch (e) {
              // ignore parse error
            }
          }
        }

        return {
          id: booking.id,
          invoiceNumber: invoiceNumber,
          guestName: guest?.name || 'Unknown Guest',
          guestEmail: guest?.email || '',
          roomNumber: room?.roomNumber || 'N/A',
          checkIn: booking.checkIn,
          checkOut: booking.actualCheckOut || booking.checkOut,
          totalAmount: booking.totalPrice || 0,
          status: isPreInvoice ? 'pending' as const : 'paid' as const,
          createdAt: booking.createdAt,
          isPreInvoice,
          groupId
        }
      })

      // Sort by createdAt descending
      invoiceRecords.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      console.log('✅ [StaffInvoiceManager] Loaded invoices:', {
        total: invoiceRecords.length,
        pending: invoiceRecords.filter(i => i.status === 'pending').length,
        paid: invoiceRecords.filter(i => i.status === 'paid').length
      })
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

  // Filter invoices by search term AND status filter
  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch =
      invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.guestName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.guestEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.roomNumber.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesFilter = filter === 'all' || invoice.status === filter

    return matchesSearch && matchesFilter
  })

  const handleGroupInvoiceDownload = async (invoice: InvoiceRecord) => {
    if (!invoice.groupId) return;
    setDownloading(invoice.id);
    try {
      const db = blink.db as any;
      console.log('📥 [StaffInvoiceManager] Downloading GROUP invoice for group:', invoice.groupId);

      // Fetch enough bookings to find the group members
      const recentBookings = await db.bookings.list({ limit: 500, orderBy: { createdAt: 'desc' } });

      // Hydrate and filter
      const groupBookingsRaw = recentBookings.filter((b: any) => {
        // Check direct property
        if (b.groupId === invoice.groupId) return true;
        // Check metadata (support both camelCase and snake_case)
        const specialReq = b.special_requests || b.specialRequests || ''
        if (specialReq && specialReq.includes(invoice.groupId)) {
          return true;
        }
        return false;
      });

      if (groupBookingsRaw.length === 0) throw new Error("No bookings found for this group");

      // Fetch details for all group bookings
      const guestIds = [...new Set(groupBookingsRaw.map((b: any) => b.guestId))];
      const roomIds = [...new Set(groupBookingsRaw.map((b: any) => b.roomId))];

      const [guests, rooms] = await Promise.all([
        db.guests.list({ where: { id: { in: guestIds } } }),
        db.rooms.list({ where: { id: { in: roomIds } } })
      ]);

      const guestMap = new Map(guests.map((g: any) => [g.id, g]));
      const roomMap = new Map(rooms.map((r: any) => [r.id, r]));

      const fullBookingDetails = groupBookingsRaw.map((b: any) => ({
        ...b,
        // Ensure special_requests is available for invoice-service
        special_requests: b.special_requests || b.specialRequests || '',
        guest: guestMap.get(b.guestId),
        room: roomMap.get(b.roomId)
      }));

      // Determine billing contact (try to find from metadata of the triggered invoice's booking)
      const triggerBooking = groupBookingsRaw.find((b: any) => b.id === invoice.id);
      let billingContact = null;
      // Support both camelCase and snake_case for special_requests
      const triggerSpecialReq = triggerBooking?.special_requests || triggerBooking?.specialRequests || ''
      if (triggerSpecialReq) {
        const match = triggerSpecialReq.match(/<!-- GROUP_DATA:(.*?) -->/);
        if (match && match[1]) {
          try {
            const data = JSON.parse(match[1]);
            billingContact = data.billingContact;
          } catch (e) { }
        }
      }
      if (!billingContact) {
        billingContact = guestMap.get(triggerBooking?.guestId) || { name: invoice.guestName, email: invoice.guestEmail };
      }

      const groupInvoiceData = await createGroupInvoiceData(fullBookingDetails as any, billingContact);
      await downloadGroupInvoicePDF(groupInvoiceData);
      toast.success('Group invoice downloaded');

    } catch (error: any) {
      console.error('❌ [StaffInvoiceManager] Failed to download group invoice:', error);
      toast.error(`Failed to download group invoice: ${error.message}`);
    } finally {
      setDownloading(null);
    }
  }

  const handleDownloadInvoice = async (invoice: InvoiceRecord) => {
    setDownloading(invoice.id)
    try {
      console.log('📥 [StaffInvoiceManager] Downloading invoice for booking:', invoice.id, 'isPreInvoice:', invoice.isPreInvoice)

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

      if (invoice.isPreInvoice || invoice.invoiceNumber.startsWith('PRE-')) {
        // Use pre-invoice generation for confirmed bookings
        console.log('📋 [StaffInvoiceManager] Using PRE-INVOICE template')
        const preInvoiceData = await createPreInvoiceData(bookingWithDetails, room)
        preInvoiceData.invoiceNumber = invoice.invoiceNumber
        await downloadPreInvoicePDF(preInvoiceData)
        toast.success(`Pre-Invoice ${invoice.invoiceNumber} downloaded successfully!`)
      } else {
        // Use regular invoice for paid/checked-out bookings
        const invoiceData = await createInvoiceData(bookingWithDetails, room)
        invoiceData.invoiceNumber = invoice.invoiceNumber
        await downloadInvoicePDF(invoiceData)
        toast.success(`Invoice ${invoice.invoiceNumber} downloaded successfully!`)
      }
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
      console.log('🖨️ [StaffInvoiceManager] Printing invoice for booking:', invoice.id, 'isPreInvoice:', invoice.isPreInvoice)

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

      if (invoice.isPreInvoice || invoice.invoiceNumber.startsWith('PRE-')) {
        // Use same pre-invoice template as download
        console.log('📋 [StaffInvoiceManager] Using PRE-INVOICE template for printing')
        const preInvoiceData = await createPreInvoiceData(bookingWithDetails, room)
        preInvoiceData.invoiceNumber = invoice.invoiceNumber
        await printPreInvoice(preInvoiceData)
        toast.success(`Pre-Invoice ${invoice.invoiceNumber} sent to printer!`)
      } else {
        // Use regular invoice template for paid invoices
        const invoiceData = await createInvoiceData(bookingWithDetails, room)
        invoiceData.invoiceNumber = invoice.invoiceNumber
        await printInvoice(invoiceData)
        toast.success(`Invoice ${invoice.invoiceNumber} sent to printer!`)
      }
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

            {/* Filter Tabs */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <div className="flex gap-1">
                <Button
                  variant={filter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter('all')}
                >
                  All ({invoices.length})
                </Button>
                <Button
                  variant={filter === 'pending' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter('pending')}
                  className={filter === 'pending' ? 'bg-amber-500 hover:bg-amber-600' : ''}
                >
                  Pre-Invoice ({invoices.filter(i => i.status === 'pending').length})
                </Button>
                <Button
                  variant={filter === 'paid' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter('paid')}
                  className={filter === 'paid' ? 'bg-green-600 hover:bg-green-700' : ''}
                >
                  Paid ({invoices.filter(i => i.status === 'paid').length})
                </Button>
              </div>
            </div>

            {/* Invoices Table */}
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border/60">
                    <TableHead className="w-[180px] text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invoice #</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Guest</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Room</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dates</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</TableHead>
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
                      <TableRow key={invoice.id} className="hover:bg-muted/30 transition-colors cursor-default group">
                        <TableCell>
                          <div className="font-mono text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded w-fit">
                            {invoice.invoiceNumber}
                          </div>
                          {invoice.groupId && (
                            <div className="mt-1 text-[10px] text-amber-600 font-medium flex items-center gap-1">
                              <Users className="w-3 h-3" /> Group
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm text-foreground">{invoice.guestName}</span>
                            {invoice.guestEmail && <span className="text-xs text-muted-foreground truncate max-w-[180px]">{invoice.guestEmail}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium text-sm">Room {invoice.roomNumber}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-sm">
                            <span className="font-medium">{format(new Date(invoice.checkIn), 'MMM dd')} <span className="text-muted-foreground">-</span> {format(new Date(invoice.checkOut), 'MMM dd')}</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(invoice.checkOut), 'yyyy')}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm">
                          GH₵{invoice.totalAmount.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={invoice.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[200px]">
                              <DropdownMenuLabel>Invoice Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />

                              <DropdownMenuItem onClick={() => handleDownloadInvoice(invoice)} disabled={downloading === invoice.id}>
                                {downloading === invoice.id ? <LoadingSpinner /> : <Download className="w-4 h-4 mr-2" />}
                                <span>{invoice.isPreInvoice ? 'Download Pre-Invoice' : 'Download Invoice'}</span>
                              </DropdownMenuItem>

                              {invoice.groupId && (
                                <DropdownMenuItem onClick={() => handleGroupInvoiceDownload(invoice)} disabled={downloading === invoice.id}>
                                  {downloading === invoice.id ? <LoadingSpinner /> : <Users className="w-4 h-4 mr-2 text-amber-600" />}
                                  <span className="text-amber-700">Download Group Invoice</span>
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuItem onClick={() => handlePrintInvoice(invoice)} disabled={printing === invoice.id}>
                                {printing === invoice.id ? <LoadingSpinner /> : <Printer className="w-4 h-4 mr-2" />}
                                <span>Print Invoice</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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