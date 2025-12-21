import { useState, useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { useCheckIn, CheckInOptions } from '@/hooks/use-check-in'

interface CheckInDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    booking: any
    room: any
    guest: any
    onSuccess?: () => void
    user?: any
}

export function CheckInDialog({
    open,
    onOpenChange,
    booking,
    room,
    guest,
    onSuccess,
    user
}: CheckInDialogProps) {
    const { currency } = useCurrency()
    const { checkIn, isProcessing } = useCheckIn()
    const [paymentMethod, setPaymentMethod] = useState<string>('Cash')

    // Reset payment method when dialog opens
    useEffect(() => {
        if (open) {
            setPaymentMethod('Cash')
        }
    }, [open])

    if (!booking || !guest) return null

    const handleConfirm = async () => {
        const success = await checkIn({
            booking,
            room,
            guest,
            paymentMethod,
            user
        })

        if (success) {
            onSuccess?.()
            onOpenChange(false)
        }
    }

    // Parse dates safely
    const checkInDate = booking.checkIn || booking.dates?.checkIn
    const checkOutDate = booking.checkOut || booking.dates?.checkOut
    const formattedCheckIn = checkInDate ? format(parseISO(checkInDate), 'PPP') : 'N/A'
    const formattedCheckOut = checkOutDate ? format(parseISO(checkOutDate), 'PPP') : 'N/A'
    const totalAmount = booking.totalPrice || booking.amount || 0
    const roomNumber = room?.roomNumber || booking.roomNumber || 'N/A'

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirm Guest Check-In</DialogTitle>
                    <DialogDescription>
                        Verify guest details before checking in
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Guest Name</p>
                            <p className="text-base font-semibold">{guest.name || booking.guestName || 'Guest'}</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Room Number</p>
                            <p className="text-base font-semibold">{roomNumber}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Check-in Date</p>
                            <p className="text-base">{formattedCheckIn}</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Check-out Date</p>
                            <p className="text-base">{formattedCheckOut}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Number of Guests</p>
                            <p className="text-base">{booking.numGuests || 1}</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                            <p className="text-base font-semibold text-primary">
                                {formatCurrencySync(totalAmount, currency)}
                            </p>
                        </div>
                    </div>

                    {guest.email && (
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Email</p>
                            <p className="text-base">{guest.email}</p>
                        </div>
                    )}

                    {guest.phone && (
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Phone</p>
                            <p className="text-base">{guest.phone}</p>
                        </div>
                    )}

                    <div className="col-span-2">
                        <p className="text-sm font-medium text-muted-foreground mb-2">Customer Paid By</p>
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select payment method" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Cash">Cash</SelectItem>
                                <SelectItem value="Mobile Money">Mobile Money</SelectItem>
                                <SelectItem value="Credit/Debit Card">Credit/Debit Card</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={isProcessing}>
                        {isProcessing ? 'Processing...' : 'Confirm Check-In'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
