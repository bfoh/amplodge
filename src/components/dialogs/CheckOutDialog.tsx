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

export interface CheckOutPayment {
    amount: number
    method: string
}

interface CheckOutDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    booking: any
    room: any
    guest: any
    /** Receives what was collected at the desk, so it can be recorded against the booking. */
    onConfirm: (payment?: CheckOutPayment) => Promise<void>
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
    // What the guest hands over now. Prefilled with the outstanding balance —
    // the common case — but editable, because staff sometimes take a different
    // figure and the amount recorded must be the amount actually collected.
    const [collectedAmount, setCollectedAmount] = useState<string>('')
    const [collectedMethod, setCollectedMethod] = useState<string>('cash')

    // Fetch charges when dialog opens
    useEffect(() => {
        if (open && booking) {
            setCollectedMethod(booking.paymentMethod || booking.payment_method || booking.payment?.method || 'cash')
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

    // Calculate totals.
    // Bill the DISCOUNTED room price: a discount granted at check-in lives in
    // discountAmount/finalAmount, and charging totalPrice here asked the guest
    // for money that had already been written off.
    const grossRoomCost = Number(booking.totalPrice || 0)
    const bookingDiscount = Number(booking.discountAmount ?? booking.discount_amount ?? 0)
    const storedFinal = booking.finalAmount ?? booking.final_amount
    const roomCost = bookingDiscount > 0
        ? (storedFinal != null && storedFinal !== '' ? Math.max(0, Number(storedFinal)) : Math.max(0, grossRoomCost - bookingDiscount))
        : grossRoomCost
    const chargesTotal = charges.reduce((sum, c) => sum + (c.amount || 0), 0)
    const priorAmountPaid = (() => {
        if (booking.amountPaid) return booking.amountPaid
        const sr = booking.special_requests || booking.specialRequests || ''
        const pm = sr.match?.(/<!-- PAYMENT_DATA:(.*?) -->/)
        if (pm) {
            try { return JSON.parse(pm[1]).amountPaid || 0 } catch { return 0 }
        }
        return 0
    })()
    const priorPaymentStatus = (() => {
        if (booking.paymentStatus) return booking.paymentStatus
        const sr = booking.special_requests || booking.specialRequests || ''
        const pm = sr.match?.(/<!-- PAYMENT_DATA:(.*?) -->/)
        if (pm) {
            try { return JSON.parse(pm[1]).paymentStatus || 'pending' } catch { return 'pending' }
        }
        return 'pending'
    })()
    const totalBeforePayment = roomCost + chargesTotal
    const remainingBalance = Math.max(0, totalBeforePayment - priorAmountPaid)
    const collected = collectedAmount === '' ? remainingBalance : Math.max(0, parseFloat(collectedAmount) || 0)

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
                            <p className="text-sm font-medium text-muted-foreground">Room Cost</p>
                            <p className="text-base font-semibold">
                                {formatCurrencySync(roomCost, currency)}
                            </p>
                        </div>
                    </div>

                    {/* Prior Payment Info */}
                    {priorAmountPaid > 0 && (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-1">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-green-800">💰 Prior Payment</span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorPaymentStatus === 'full' ? 'bg-green-200 text-green-800' :
                                    priorPaymentStatus === 'part' ? 'bg-amber-200 text-amber-800' :
                                        'bg-red-200 text-red-800'
                                    }`}>
                                    {priorPaymentStatus === 'full' ? 'Paid in Full' :
                                        priorPaymentStatus === 'part' ? 'Part Payment' : 'Pending'}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-green-700">Amount Already Paid:</span>
                                <span className="font-bold text-green-700">{formatCurrencySync(priorAmountPaid, currency)}</span>
                            </div>
                        </div>
                    )}

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

                    {/* Grand Total / Remaining Balance */}
                    {!loading && (
                        <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Room Cost:</span>
                                <span>{formatCurrencySync(roomCost, currency)}</span>
                            </div>
                            {chargesTotal > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Additional Charges:</span>
                                    <span>+{formatCurrencySync(chargesTotal, currency)}</span>
                                </div>
                            )}
                            {priorAmountPaid > 0 && (
                                <div className="flex justify-between text-sm text-green-600">
                                    <span>Already Paid:</span>
                                    <span>-{formatCurrencySync(priorAmountPaid, currency)}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center border-t pt-2">
                                <span className="font-medium">
                                    {priorAmountPaid > 0 ? 'Remaining Balance' : 'Grand Total'}
                                </span>
                                <span className={`text-xl font-bold ${remainingBalance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                                    {formatCurrencySync(remainingBalance, currency)}
                                </span>
                            </div>
                            {remainingBalance === 0 && priorAmountPaid > 0 && (
                                <p className="text-xs text-green-600 font-medium">✓ Fully paid — no balance to collect</p>
                            )}
                        </div>
                    )}

                    {/* Payment collected now — the money that leaves the desk with
                        this check-out. Recorded against the booking so it shows up
                        in the staff revenue reports; nothing recorded it before. */}
                    {remainingBalance > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                            <p className="text-sm font-medium text-amber-900">Payment collected now</p>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-xs text-amber-800" htmlFor="checkout-amount">Amount</label>
                                    <input
                                        id="checkout-amount"
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="w-full h-9 rounded-md border border-amber-300 bg-white px-2 text-sm"
                                        value={collectedAmount === '' ? String(remainingBalance) : collectedAmount}
                                        onChange={(e) => setCollectedAmount(e.target.value)}
                                        disabled={processing}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-amber-800" htmlFor="checkout-method">Method</label>
                                    <select
                                        id="checkout-method"
                                        className="w-full h-9 rounded-md border border-amber-300 bg-white px-2 text-sm"
                                        value={collectedMethod}
                                        onChange={(e) => setCollectedMethod(e.target.value)}
                                        disabled={processing}
                                    >
                                        <option value="cash">💵 Cash</option>
                                        <option value="mobile_money">📱 Mobile Money</option>
                                        <option value="card">💳 Card</option>
                                        <option value="not_paid">⏳ Nothing collected</option>
                                    </select>
                                </div>
                            </div>
                            {collectedMethod !== 'not_paid' && collected !== remainingBalance && (
                                <p className="text-xs text-amber-700">
                                    {collected < remainingBalance
                                        ? `Leaves ${formatCurrencySync(remainingBalance - collected, currency)} outstanding.`
                                        : `${formatCurrencySync(collected - remainingBalance, currency)} more than the balance due.`}
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
                    <Button
                        onClick={() => onConfirm(
                            remainingBalance > 0 && collectedMethod !== 'not_paid'
                                ? { amount: collected, method: collectedMethod }
                                : { amount: 0, method: collectedMethod }
                        )}
                        disabled={processing}
                    >
                        {processing ? 'Processing...' : 'Confirm Check-Out'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
