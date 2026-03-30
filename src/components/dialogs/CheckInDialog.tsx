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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrencySync, getCurrencySymbol } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { useCheckIn } from '@/hooks/use-check-in'
import { Tag, Plus, X } from 'lucide-react'
import type { PaymentSplit } from '@/types'

interface CheckInDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    booking: any
    room: any
    guest: any
    onSuccess?: () => void
    user?: any
}

const DISCOUNT_REASONS = [
    { value: 'loyalty', label: 'Loyalty Discount' },
    { value: 'promo', label: 'Promo Code' },
    { value: 'manager', label: 'Manager Approval' },
    { value: 'corporate', label: 'Corporate Rate' },
    { value: 'repeat', label: 'Repeat Guest' },
    { value: 'other', label: 'Other' }
]

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
    const [splits, setSplits] = useState<Array<{ method: string; amount: number }>>(
        [{ method: 'cash', amount: 0 }]
    )
    const [discountAmount, setDiscountAmount] = useState<string>('')
    const [discountReason, setDiscountReason] = useState<string>('')

    // Parse dates safely (safe even when booking is null)
    const checkInDate = booking?.checkIn || booking?.dates?.checkIn
    const checkOutDate = booking?.checkOut || booking?.dates?.checkOut
    const formattedCheckIn = checkInDate ? format(parseISO(checkInDate), 'PPP') : 'N/A'
    const formattedCheckOut = checkOutDate ? format(parseISO(checkOutDate), 'PPP') : 'N/A'
    const totalAmount = booking?.totalPrice || booking?.amount || 0
    const roomNumber = room?.roomNumber || booking?.roomNumber || 'N/A'

    // Prior payment tracking
    let priorAmountPaid = booking?.amountPaid || 0
    let priorPaymentStatus = booking?.paymentStatus || 'pending'
    if (!priorAmountPaid && booking) {
        const sr = booking.special_requests || booking.specialRequests || ''
        const pm = sr.match?.(/<!-- PAYMENT_DATA:(.*?) -->/)
        if (pm) {
            try {
                const pd = JSON.parse(pm[1])
                priorAmountPaid = pd.amountPaid || 0
                priorPaymentStatus = pd.paymentStatus || 'pending'
            } catch { /* ignore */ }
        }
    }

    const discount = parseFloat(discountAmount) || 0
    const afterDiscount = Math.max(0, totalAmount - discount)
    const remainingBalance = Math.max(0, afterDiscount - priorAmountPaid)
    const discountError = discount > totalAmount ? 'Discount cannot exceed total amount' : ''

    // Split helpers
    const splitTotal = splits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const splitRemaining = remainingBalance - splitTotal

    const addSplit = () => setSplits(p => [...p, { method: 'cash', amount: 0 }])
    const removeSplit = (i: number) => setSplits(p => p.filter((_, j) => j !== i))
    const updateSplit = (i: number, key: 'method' | 'amount', val: any) =>
        setSplits(p => p.map((s, j) => j === i ? { ...s, [key]: val } : s))

    // Auto-fill first split with remaining balance when dialog opens or balance changes
    // IMPORTANT: all useEffect calls must be before any early return (Rules of Hooks)
    useEffect(() => {
        if (open) {
            setSplits([{ method: 'cash', amount: remainingBalance }])
            setDiscountAmount('')
            setDiscountReason('')
        }
    }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

    // Keep first split's amount in sync when balance changes (only if single split)
    useEffect(() => {
        setSplits(prev => {
            if (prev.length === 1) return [{ ...prev[0], amount: remainingBalance }]
            return prev
        })
    }, [remainingBalance])

    // Early return after all hooks
    if (!booking || !guest) return null

    const handleConfirm = async () => {
        if (discountError) return

        const primaryMethod = splits.reduce((a, b) => b.amount > a.amount ? b : a, splits[0]).method
        const paymentSplitsArg: PaymentSplit[] | undefined = splits.filter(s => s.amount > 0).length > 1
            ? splits.filter(s => s.amount > 0).map(s => ({ method: s.method as PaymentSplit['method'], amount: s.amount }))
            : undefined

        const success = await checkIn({
            booking,
            room,
            guest,
            paymentMethod: primaryMethod,
            paymentSplits: paymentSplitsArg,
            discountAmount: discount > 0 ? discount : undefined,
            discountReason: discount > 0 && discountReason ? discountReason : undefined,
            user
        })

        if (success) {
            onSuccess?.()
            onOpenChange(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Confirm Guest Check-In</DialogTitle>
                    <DialogDescription>
                        Verify guest details and apply any discounts before checking in
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
                            <p className="text-sm font-medium text-muted-foreground">Room Rate (Original)</p>
                            <p className="text-base font-semibold">
                                {formatCurrencySync(totalAmount, currency)}
                            </p>
                        </div>
                    </div>

                    {/* Prior Payment Info */}
                    {priorAmountPaid > 0 && (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-green-800">💰 Prior Payment Received</span>
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

                    {/* Discount Section */}
                    <div className="border-t pt-4 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Tag className="w-4 h-4" />
                            <span>Apply Discount (Optional)</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="discountAmount">Discount Amount</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                        {getCurrencySymbol(currency)}
                                    </span>
                                    <Input
                                        id="discountAmount"
                                        type="number"
                                        min="0"
                                        max={totalAmount}
                                        step="1"
                                        placeholder="0"
                                        value={discountAmount}
                                        onChange={(e) => setDiscountAmount(e.target.value)}
                                        className="pl-8"
                                    />
                                </div>
                                {discountError && (
                                    <p className="text-xs text-destructive">{discountError}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="discountReason">Reason</Label>
                                <Select value={discountReason} onValueChange={setDiscountReason}>
                                    <SelectTrigger id="discountReason">
                                        <SelectValue placeholder="Select reason" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {DISCOUNT_REASONS.map((reason) => (
                                            <SelectItem key={reason.value} value={reason.value}>
                                                {reason.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    {/* Final Amount Breakdown */}
                    <div className="bg-muted/50 rounded-lg p-4 border space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Room Rate:</span>
                            <span>{formatCurrencySync(totalAmount, currency)}</span>
                        </div>
                        {discount > 0 && (
                            <div className="flex justify-between text-sm text-destructive">
                                <span>Discount:</span>
                                <span>-{formatCurrencySync(discount, currency)}</span>
                            </div>
                        )}
                        {priorAmountPaid > 0 && (
                            <div className="flex justify-between text-sm text-green-600">
                                <span>Already Paid:</span>
                                <span>-{formatCurrencySync(priorAmountPaid, currency)}</span>
                            </div>
                        )}
                        <div className="flex items-center justify-between border-t pt-2">
                            <span className="text-sm font-medium">Remaining Balance to Collect</span>
                            <span className={`text-xl font-bold ${remainingBalance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                                {formatCurrencySync(remainingBalance, currency)}
                            </span>
                        </div>
                        {remainingBalance === 0 && priorAmountPaid > 0 && (
                            <p className="text-xs text-green-600 font-medium">✓ Fully paid — no balance to collect</p>
                        )}
                    </div>

                    {/* Payment Method(s) */}
                    <div className="space-y-2">
                        <Label>Customer Paid By</Label>
                        <div className="space-y-2">
                            {splits.map((split, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <Select value={split.method} onValueChange={v => updateSplit(i, 'method', v)}>
                                        <SelectTrigger className="w-44 shrink-0">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="cash">💵 Cash</SelectItem>
                                            <SelectItem value="mobile_money">📱 Mobile Money</SelectItem>
                                            <SelectItem value="card">💳 Card</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <div className="relative flex-1">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                            {getCurrencySymbol(currency)}
                                        </span>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={split.amount || ''}
                                            onChange={e => updateSplit(i, 'amount', parseFloat(e.target.value) || 0)}
                                            className="pl-8"
                                        />
                                    </div>
                                    {splits.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeSplit(i)}
                                            className="text-destructive hover:text-destructive/80 p-1 rounded hover:bg-destructive/10 transition-colors shrink-0"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ))}

                            {/* Running total indicator when multiple splits */}
                            {splits.length > 1 && (
                                <div className="flex justify-between text-xs px-1">
                                    <span className="text-muted-foreground">Splits total</span>
                                    <span className={splitRemaining === 0 ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                                        {formatCurrencySync(splitTotal, currency)}
                                        {splitRemaining > 0 && ` · ${formatCurrencySync(splitRemaining, currency)} short`}
                                        {splitRemaining < 0 && ` · ${formatCurrencySync(Math.abs(splitRemaining), currency)} over`}
                                        {splitRemaining === 0 && ' ✓'}
                                    </span>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={addSplit}
                                className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add another payment method
                            </button>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={isProcessing || !!discountError}>
                        {isProcessing ? 'Processing...' : 'Confirm Check-In'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
