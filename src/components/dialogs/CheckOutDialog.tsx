import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { BookingCharge } from '@/types'
import { bookingChargesService, CHARGE_CATEGORIES } from '@/services/booking-charges-service'
import { calculateNights } from '@/lib/display'

interface CheckOutDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    booking: any
    room: any
    guest: any
    onConfirm: () => Promise<void>
    processing?: boolean
}

export function CheckOutDialog({
    open,
    onOpenChange,
    booking,
    room,
    guest,
    onConfirm,
    processing = false
}: CheckOutDialogProps) {
    const { currency } = useCurrency()
    const [charges, setCharges] = useState<BookingCharge[]>([])
    const [loading, setLoading] = useState(false)

    // Fetch charges when dialog opens
    useEffect(() => {
        if (open && booking) {
            setLoading(true)
            const bookingId = booking.remoteId || booking.id || booking._id
            bookingChargesService.getChargesForBooking(bookingId)
                .then(data => setCharges(data))
                .catch(err => {
                    console.error('Failed to fetch checkout charges:', err)
                    setCharges([])
                })
                .finally(() => setLoading(false))
        } else {
            setCharges([])
        }
    }, [open, booking])

    if (!booking) return null

    // Calculate totals
    const roomCost = booking.totalPrice || 0
    const chargesTotal = charges.reduce((sum, c) => sum + (c.amount || 0), 0)
    const grandTotal = roomCost + chargesTotal

    // Get values from booking (handle different data shapes)
    const guestName = guest?.name || booking.guestName || 'Guest'
    const roomNumber = room?.roomNumber || booking.roomNumber || 'N/A'
    const checkIn = booking.checkIn || booking.dates?.checkIn
    const checkOut = booking.checkOut || booking.dates?.checkOut
    const nights = checkIn && checkOut ? calculateNights(checkIn, checkOut) : 1

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Confirm Guest Check-Out</DialogTitle>
                    <DialogDescription>
                        Complete the checkout process and create cleaning task
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Guest & Room Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Guest Name</p>
                            <p className="text-base font-semibold">{guestName}</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Room Number</p>
                            <p className="text-base font-semibold">{roomNumber}</p>
                        </div>
                    </div>

                    {/* Dates Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Stay Duration</p>
                            <p className="text-base">{nights} nights</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Room Cost (Paid)</p>
                            <p className="text-base font-semibold">
                                {formatCurrencySync(roomCost, currency)}
                            </p>
                        </div>
                    </div>

                    {/* Charges Summary */}
                    {loading ? (
                        <div className="flex items-center gap-2 py-2 text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading charges...
                        </div>
                    ) : charges.length > 0 && (
                        <div className="rounded-lg border p-4 space-y-3">
                            <p className="text-sm font-medium text-muted-foreground">Additional Charges</p>
                            <div className="space-y-2">
                                {charges.map(charge => (
                                    <div key={charge.id} className="flex justify-between text-sm">
                                        <span>{charge.description} ({charge.quantity}×)</span>
                                        <span className="font-medium">{formatCurrencySync(charge.amount, currency)}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="border-t pt-2 flex justify-between font-medium">
                                <span>Additional Charges Total</span>
                                <span className="text-primary">
                                    {formatCurrencySync(chargesTotal, currency)}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Grand Total */}
                    {!loading && (
                        <div className="rounded-lg bg-muted/50 p-4">
                            <div className="flex justify-between items-center">
                                <span className="font-medium">Grand Total</span>
                                <span className="text-xl font-bold text-primary">
                                    {formatCurrencySync(grandTotal, currency)}
                                </span>
                            </div>
                            {charges.length > 0 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    Room: {formatCurrencySync(roomCost, currency)} +
                                    Charges: {formatCurrencySync(chargesTotal, currency)}
                                </p>
                            )}
                        </div>
                    )}

                    {/* What happens next */}
                    <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
                        <p className="text-sm font-medium text-blue-900">What happens next?</p>
                        <ul className="mt-2 text-sm text-blue-700 space-y-1">
                            <li>✓ Booking status updated to "Checked-Out"</li>
                            <li>✓ Room status set to "Cleaning"</li>
                            <li>✓ Housekeeping task automatically created</li>
                            <li>✓ Invoice generated with all charges</li>
                        </ul>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processing}>
                        Cancel
                    </Button>
                    <Button onClick={onConfirm} disabled={processing}>
                        {processing ? 'Processing...' : 'Confirm Check-Out'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
