import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { blink } from '@/blink/client'
import { activityLogService } from '@/services/activity-log-service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Calendar as CalendarIcon, Check } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useCurrency } from '@/hooks/use-currency'

interface Booking { id: string; }

export function NewInvoicePage() {
  const navigate = useNavigate()
  const db = (blink.db as any)
  const { currency } = useCurrency()

  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [invoiceType, setInvoiceType] = useState('VAT Invoice')
  const [symbol, setSymbol] = useState('INV')
  const [manualNumber, setManualNumber] = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [placeOfIssue, setPlaceOfIssue] = useState('AMP Lodge Front Desk')
  const [linkReservation, setLinkReservation] = useState(false)
  const [bookingId, setBookingId] = useState('')
  const [bookings, setBookings] = useState<Booking[]>([])

  const [dateOfIssue, setDateOfIssue] = useState<Date>(new Date())
  const [dateOfSale, setDateOfSale] = useState<Date>(new Date())

  useEffect(() => {
    const unsub = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user)
      if (!state.user && !state.isLoading) navigate('/staff')
    })
    return unsub
  }, [navigate])

  useEffect(() => {
    if (!user) return
    const load = async () => {
      try {
        const list = await db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 50 })
        setBookings(list)
      } catch (err) {
        console.debug('Failed to load bookings', err)
      }
      setLoading(false)
    }
    load()
  }, [user])

  const autoNumber = useMemo(() => {
    const d = dateOfIssue
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    const tail = String(Date.now()).slice(-4)
    return `${symbol || 'INV'}/${mm}/${yyyy}/${tail}`
  }, [dateOfIssue, symbol])

  const handleCreate = async () => {
    const number = manualNumber ? invoiceNumber.trim() : autoNumber
    if (manualNumber && !number) {
      toast.error('Please enter invoice number or disable manual numbering')
      return
    }

    try {
      const invoice = await db.invoices.create({
        invoiceType,
        symbol,
        invoiceNumber: number,
        manualNumber: manualNumber ? '1' : '0',
        dateOfIssue: dateOfIssue.toISOString(),
        dateOfSale: dateOfSale.toISOString(),
        bookingId: linkReservation && bookingId ? bookingId : '',
        placeOfIssue,
        currency: currency,
        totalAmount: '0',
        status: 'draft',
        createdAt: new Date().toISOString()
      })
      // Log activity
      await activityLogService.logInvoiceCreated(invoice.id, {
        invoiceNumber: number,
        guestName: 'N/A',
        guestEmail: 'N/A',
        totalAmount: 0,
        status: 'draft',
        itemCount: 0,
      }, user.id).catch(err => console.error('Failed to log invoice creation:', err))
      toast.success('Invoice created')
      navigate('/staff/invoices')
    } catch (e: any) {
      console.error(e)
      toast.error(e.message || 'Failed to create invoice')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Preparing form...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="bg-background border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-serif font-bold">New invoice</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Invoice details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Invoice type</Label>
              <Select value={invoiceType} onValueChange={setInvoiceType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VAT Invoice">VAT Invoice</SelectItem>
                  <SelectItem value="Receipt">Receipt</SelectItem>
                  <SelectItem value="Proforma">Proforma</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Symbol</Label>
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="INV" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Invoice number</Label>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={manualNumber} onCheckedChange={setManualNumber} id="manual" />
                  <label htmlFor="manual">I want to assign an invoice number manually.</label>
                </div>
              </div>
              <Input value={manualNumber ? invoiceNumber : autoNumber} onChange={(e) => setInvoiceNumber(e.target.value)} disabled={!manualNumber} />
            </div>

            <div className="space-y-2">
              <Label>Date of issue</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateOfIssue, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Calendar mode="single" selected={dateOfIssue} onSelect={(d) => d && setDateOfIssue(d)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Date of sale</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateOfSale, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Calendar mode="single" selected={dateOfSale} onSelect={(d) => d && setDateOfSale(d)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center gap-2 text-sm">
                <Switch checked={linkReservation} onCheckedChange={setLinkReservation} id="link-res" />
                <label htmlFor="link-res">Link to the reservation</label>
              </div>
              {linkReservation && (
                <div className="mt-2">
                  <Label className="text-sm">Reservation (Booking ID)</Label>
                  <Select value={bookingId} onValueChange={setBookingId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a booking" />
                    </SelectTrigger>
                    <SelectContent>
                      {bookings.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.id.slice(-8)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Place of issue</Label>
              <Input value={placeOfIssue} onChange={(e) => setPlaceOfIssue(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end mt-6">
          <Button size="lg" className="h-12 px-6 text-base" onClick={handleCreate}>
            <Check className="w-5 h-5 mr-2" /> Create an invoice
          </Button>
        </div>

        <div className="mt-6">
          <button className="text-sm text-muted-foreground hover:text-primary" onClick={() => navigate('/staff/invoices')}>
            ← Back to invoices
          </button>
        </div>
      </main>
    </div>
  )
}

export default NewInvoicePage
