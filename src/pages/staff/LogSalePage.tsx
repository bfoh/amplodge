import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { User, UserX, Search, ShoppingCart } from 'lucide-react'
import { LogSaleDialog } from '@/components/dialogs/LogSaleDialog'
import { GuestChargesDialog } from '@/components/dialogs/GuestChargesDialog'
import { bookingEngine } from '@/services/booking-engine'
import { auth } from '@/lib/db'

type Mode = 'choose' | 'guest'

export function LogSalePage() {
  const [mode, setMode] = useState<Mode>('choose')
  const [staff, setStaff] = useState<{ id: string; name: string }>({ id: '', name: '' })
  const [bookings, setBookings] = useState<any[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<any | null>(null)
  const [logSaleOpen, setLogSaleOpen] = useState(false)

  useEffect(() => {
    auth.me()
      .then((u: any) => setStaff({ id: u?.id || '', name: u?.name || u?.email || 'Staff' }))
      .catch(() => {})
  }, [])


  useEffect(() => {
    if (mode !== 'guest') return
    bookingEngine.getAllBookings()
      .then(all => setBookings(all.filter((b: any) => b.status === 'checked-in')))
      .catch(() => setBookings([]))
  }, [mode])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return bookings
    return bookings.filter((b: any) =>
      String(b.roomNumber || '').toLowerCase().includes(q) ||
      String(b.guest?.fullName || '').toLowerCase().includes(q))
  }, [bookings, query])

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <ShoppingCart className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Log a Sale</h1>
      </div>

      {mode === 'choose' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:border-primary transition" onClick={() => setMode('guest')}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><User className="w-5 h-5" /> Sell to a Guest</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Charge an in-house guest's folio. Can Pay Later (settled at check-out).
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:border-primary transition" onClick={() => setLogSaleOpen(true)}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserX className="w-5 h-5" /> Sell to Non-guest</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Walk-in / counter sale. Paid now (cash, mobile money, card).
            </CardContent>
          </Card>
        </div>
      )}

      {mode === 'guest' && (
        <Card>
          <CardHeader><CardTitle>Select an in-house guest</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search room or name..."
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <div className="max-h-80 overflow-y-auto divide-y">
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No checked-in guests.</p>
              )}
              {filtered.map((b: any) => (
                <button
                  key={b.remoteId || b._id}
                  className="w-full text-left py-3 px-2 hover:bg-muted rounded flex justify-between"
                  onClick={() => setSelected(b)}
                >
                  <span className="font-medium">Room {b.roomNumber || '—'}</span>
                  <span className="text-muted-foreground">{b.guest?.fullName || 'Guest'}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setMode('choose')}>← Back</Button>
          </CardContent>
        </Card>
      )}

      <LogSaleDialog
        open={logSaleOpen}
        onOpenChange={(o) => { setLogSaleOpen(o); if (!o) setMode('choose') }}
        staffId={staff.id}
        staffName={staff.name}
      />

      {selected && (
        <GuestChargesDialog
          open={!!selected}
          onOpenChange={(o) => { if (!o) setSelected(null) }}
          // Map LocalBooking fields to what GuestChargesDialog reads:
          // guest.name (from fullName), booking.totalPrice (from amount), dates.
          booking={{
            ...selected,
            totalPrice: selected.amount ?? selected.totalPrice ?? 0,
            roomNumber: selected.roomNumber,
            checkIn: selected.dates?.checkIn,
            checkOut: selected.dates?.checkOut,
          }}
          guest={{ ...selected.guest, name: selected.guest?.fullName || selected.guest?.name || 'Guest' }}
          onChargesUpdated={() => {}}
        />
      )}
    </div>
  )
}
