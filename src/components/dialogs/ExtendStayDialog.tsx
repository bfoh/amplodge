import { useState, useEffect } from 'react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CalendarIcon, AlertTriangle, CheckCircle2, ArrowRight, Loader2, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { stayExtensionService, AvailableRoom, RoomAvailability } from '@/services/stay-extension-service'
import { sendStayExtensionNotification } from '@/services/notifications'
import { formatCurrencySync, getCurrencySymbol } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { format, addDays } from 'date-fns'

const DISCOUNT_REASONS = [
    { value: 'loyalty', label: 'Loyalty Discount' },
    { value: 'promo', label: 'Promo Code' },
    { value: 'manager', label: 'Manager Approval' },
    { value: 'corporate', label: 'Corporate Rate' },
    { value: 'repeat', label: 'Repeat Guest' },
    { value: 'other', label: 'Other' }
]

interface ExtendStayDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    booking: {
        id: string
        guestId: string
        roomId: string
        checkIn: string
        checkOut: string
        status: string
        totalPrice?: number
    }
    guest: {
        id: string
        name: string
        email: string
        phone?: string | null
    }
    room: {
        id: string
        roomNumber: string
        roomType?: string
        price?: number  // Room price per night from roomType
    }
    onExtensionComplete?: () => void
    user?: any
}

export function ExtendStayDialog({
    open,
    onOpenChange,
    booking,
    guest,
    room,
    onExtensionComplete,
    user
}: ExtendStayDialogProps) {
    const { currency } = useCurrency()
    const [newCheckoutDate, setNewCheckoutDate] = useState('')
    const [isChecking, setIsChecking] = useState(false)
    const [isExtending, setIsExtending] = useState(false)
    const [roomRate, setRoomRate] = useState(0)
    const [additionalNights, setAdditionalNights] = useState(0)
    const [extensionCost, setExtensionCost] = useState(0)
    const [availability, setAvailability] = useState<RoomAvailability | null>(null)
    const [availableRooms, setAvailableRooms] = useState<AvailableRoom[]>([])
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
    const [showRoomSelector, setShowRoomSelector] = useState(false)

    // Discount state
    const [discountAmount, setDiscountAmount] = useState<string>('')
    const [discountReason, setDiscountReason] = useState<string>('')

    // Calculate minimum date (day after current checkout)
    const minDate = format(addDays(new Date(booking.checkOut), 1), 'yyyy-MM-dd')
    const currentCheckout = format(new Date(booking.checkOut), 'MMM dd, yyyy')

    // Fetch room rate on open - use booking rate if available (to match current stay), otherwise room.price
    useEffect(() => {
        if (open) {
            // Priority: 1. Room price (actual room rate), 2. Service lookup
            // Note: We deliberately do NOT use the booking's effective rate because extension
            // should always be at the current room rate, not necessarily what the guest paid before.
            if (room.price && room.price > 0) {
                console.log('[ExtendStayDialog] Using room.price from prop:', room.price)
                setRoomRate(room.price)
            } else {
                // Fallback to service lookup
                stayExtensionService.getRoomRate(room.id).then(rate => {
                    console.log('[ExtendStayDialog] Using service rate:', rate)
                    setRoomRate(rate)
                })
            }

            // Reset state
            setNewCheckoutDate('')
            setAdditionalNights(0)
            setExtensionCost(0)
            setAvailability(null)
            setAvailableRooms([])
            setSelectedRoomId(null)
            setShowRoomSelector(false)
            setDiscountAmount('')
            setDiscountReason('')
        }
    }, [open, room.id, room.price, booking.checkIn, booking.checkOut, booking.totalPrice])

    // Calculate costs and check availability when date changes
    useEffect(() => {
        if (!newCheckoutDate) {
            setAdditionalNights(0)
            setExtensionCost(0)
            setAvailability(null)
            setShowRoomSelector(false)
            return
        }

        const currentCheckoutDate = new Date(booking.checkOut)
        const newDate = new Date(newCheckoutDate)
        const nights = Math.ceil((newDate.getTime() - currentCheckoutDate.getTime()) / (1000 * 60 * 60 * 24))

        if (nights <= 0) {
            setAdditionalNights(0)
            setExtensionCost(0)
            return
        }

        setAdditionalNights(nights)
        setExtensionCost(roomRate * nights)

        // Check availability
        checkAvailability(currentCheckoutDate.toISOString(), newCheckoutDate)
    }, [newCheckoutDate, roomRate, booking.checkOut])

    const checkAvailability = async (startDate: string, endDate: string) => {
        setIsChecking(true)
        try {
            const result = await stayExtensionService.checkRoomAvailability(
                room.id,
                startDate,
                endDate,
                booking.id
            )
            setAvailability(result)

            if (!result.available) {
                // Fetch available rooms for the date range
                const rooms = await stayExtensionService.getAvailableRooms(startDate, endDate)
                setAvailableRooms(rooms)
                setShowRoomSelector(true)
            } else {
                setAvailableRooms([])
                setShowRoomSelector(false)
                setSelectedRoomId(null)
            }
        } catch (error) {
            console.error('Error checking availability:', error)
            toast.error('Failed to check room availability')
        } finally {
            setIsChecking(false)
        }
    }

    const selectedAlternativeRoom = availableRooms.find(r => r.id === selectedRoomId)
    const baseCost = selectedRoomId
        ? (selectedAlternativeRoom?.pricePerNight || 0) * additionalNights
        : extensionCost

    const discount = parseFloat(discountAmount) || 0
    const displayCost = Math.max(0, baseCost - discount)
    const discountError = discount > baseCost ? 'Discount cannot exceed extension cost' : ''

    const handleExtend = async () => {
        if (!newCheckoutDate || additionalNights <= 0) {
            toast.error('Please select a valid new checkout date')
            return
        }

        // If room is not available and no alternative selected
        if (availability && !availability.available && !selectedRoomId) {
            toast.error('Please select an alternative room or cancel')
            return
        }

        if (discountError) {
            return
        }

        setIsExtending(true)
        try {
            const result = await stayExtensionService.extendStay(
                booking.id,
                newCheckoutDate,
                selectedRoomId || undefined,
                user?.id || undefined, // userId if needed
                discount > 0 ? discount : undefined,
                discount > 0 && discountReason ? discountReason : undefined
            )

            if (result.success) {
                // Send notification to guest
                try {
                    await sendStayExtensionNotification(
                        guest,
                        room,
                        {
                            id: booking.id,
                            checkIn: booking.checkIn,
                            checkOut: newCheckoutDate,
                            originalCheckout: booking.checkOut
                        },
                        additionalNights,
                        result.extensionCost || displayCost,
                        result.roomChanged ? selectedRoomId : undefined
                    )
                } catch (notifError) {
                    console.error('Failed to send extension notification:', notifError)
                }

                toast.success(`Stay extended to ${format(new Date(newCheckoutDate), 'MMM dd, yyyy')}!`)
                onOpenChange(false)
                onExtensionComplete?.()
            } else {
                toast.error(result.error || 'Failed to extend stay')
            }
        } catch (error: any) {
            console.error('Extension error:', error)
            toast.error(error.message || 'Failed to extend stay')
        } finally {
            setIsExtending(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarIcon className="h-5 w-5 text-amber-600" />
                        Extend Stay
                    </DialogTitle>
                    <DialogDescription>
                        Extend {guest.name}'s stay in Room {room.roomNumber}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Current Checkout Info */}
                    <div className="bg-slate-50 p-4 rounded-lg">
                        <p className="text-sm text-muted-foreground">Current checkout date:</p>
                        <p className="font-semibold text-lg">{currentCheckout}</p>
                    </div>

                    {/* New Checkout Date Picker */}
                    <div className="space-y-2">
                        <Label htmlFor="newCheckout">New Checkout Date</Label>
                        <Input
                            id="newCheckout"
                            type="date"
                            min={minDate}
                            value={newCheckoutDate}
                            onChange={(e) => setNewCheckoutDate(e.target.value)}
                            className="w-full"
                        />
                    </div>

                    {/* Extension Summary */}
                    {additionalNights > 0 && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-end">
                                <div>
                                    <p className="text-sm text-muted-foreground">Additional Nights:</p>
                                    <p className="text-xl font-semibold">{additionalNights}</p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Rate: {formatCurrencySync(selectedRoomId ? (selectedAlternativeRoom?.pricePerNight || 0) : roomRate, currency)}/night
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm text-muted-foreground">Base Cost:</p>
                                    <p className="text-xl font-semibold">{formatCurrencySync(baseCost, currency)}</p>
                                </div>
                            </div>

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
                                                max={baseCost}
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

                            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200 mt-4">
                                <span className="font-semibold text-amber-900">Final Extension Cost</span>
                                <span className="text-2xl font-bold text-amber-900">
                                    {formatCurrencySync(displayCost, currency)}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Availability Check Status */}
                    {isChecking && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Checking availability...
                        </div>
                    )}

                    {/* Available - Green */}
                    {availability?.available && !isChecking && (
                        <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
                            <CheckCircle2 className="h-5 w-5" />
                            Room is available for extension
                        </div>
                    )}

                    {/* Conflict - Show alternatives */}
                    {availability && !availability.available && !isChecking && (
                        <div className="space-y-4">
                            <div className="flex items-start gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg">
                                <AlertTriangle className="h-5 w-5 mt-0.5" />
                                <div>
                                    <p className="font-medium">Room {room.roomNumber} is not available</p>
                                    <p className="text-sm text-amber-700">
                                        Another booking exists for this period. Please select an alternative room below.
                                    </p>
                                </div>
                            </div>

                            {/* Alternative Rooms */}
                            {availableRooms.length > 0 ? (
                                <div className="space-y-2">
                                    <Label>Select Alternative Room</Label>
                                    <RadioGroup value={selectedRoomId || ''} onValueChange={setSelectedRoomId}>
                                        <div className="space-y-2 max-h-40 overflow-y-auto">
                                            {availableRooms.map((r) => (
                                                <div key={r.id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-slate-50 cursor-pointer">
                                                    <RadioGroupItem value={r.id} id={r.id} />
                                                    <Label htmlFor={r.id} className="flex-1 cursor-pointer">
                                                        <span className="font-medium">Room {r.roomNumber}</span>
                                                        <span className="text-muted-foreground ml-2">({r.roomType})</span>
                                                        <span className="float-right text-amber-600 font-medium">
                                                            {formatCurrencySync(r.pricePerNight, currency)}/night
                                                        </span>
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                    </RadioGroup>
                                </div>
                            ) : (
                                <div className="text-red-600 bg-red-50 p-3 rounded-lg">
                                    <p className="font-medium">No rooms available</p>
                                    <p className="text-sm">There are no alternative rooms available for this period.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleExtend}
                        disabled={
                            isExtending ||
                            isChecking ||
                            !!discountError ||
                            additionalNights <= 0 ||
                            (!availability?.available && !selectedRoomId) ||
                            (availability && !availability.available && availableRooms.length === 0)
                        }
                        className="bg-amber-600 hover:bg-amber-700"
                    >
                        {isExtending ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Extending...
                            </>
                        ) : (
                            `Extend Stay (+${formatCurrencySync(displayCost, currency)})`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

