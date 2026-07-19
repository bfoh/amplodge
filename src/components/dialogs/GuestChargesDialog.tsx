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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Edit2, DollarSign, X, Check, Loader2, Package } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { BookingCharge, ChargeCategory } from '@/types'
import { bookingChargesService, CHARGE_CATEGORIES, CreateChargeData } from '@/services/booking-charges-service'
import { inventoryService } from '@/services/inventory-service'
import { InventoryItem } from '@/types'

interface GuestChargesDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    booking: any
    guest: any
    isCheckoutMode?: boolean // If true, charges are read-only
    onChargesUpdated?: () => void
}

export function GuestChargesDialog({
    open,
    onOpenChange,
    booking,
    guest,
    isCheckoutMode = false,
    onChargesUpdated
}: GuestChargesDialogProps) {
    const { currency } = useCurrency()
    const [charges, setCharges] = useState<BookingCharge[]>([])
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
    const [loading, setLoading] = useState(false)
    const [showAddForm, setShowAddForm] = useState(false)
    const [editingChargeId, setEditingChargeId] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    // Form state
    const [description, setDescription] = useState('')
    const [category, setCategory] = useState<ChargeCategory>('food_beverage')
    const [quantity, setQuantity] = useState(1)
    const [unitPrice, setUnitPrice] = useState(0)
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mobile_money' | 'card' | 'pay_later'>('cash')
    const [notes, setNotes] = useState('')
    const [inventoryId, setInventoryId] = useState<string>('')

    // Multi-item staging cart (additive — does not affect the single-add flow above).
    type DraftCharge = { id: string; inventoryId?: string; description: string; category: ChargeCategory; quantity: number; unitPrice: number }
    const [cart, setCart] = useState<DraftCharge[]>([])
    const cartTotal = cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0)

    // Fetch charges when dialog opens
    useEffect(() => {
        if (open && booking) {
            fetchCharges()
            inventoryService.getItems().then(setInventoryItems).catch(console.error)
        }
    }, [open, booking])

    const fetchCharges = async () => {
        if (!booking) return
        setLoading(true)
        try {
            const bookingId = booking.remoteId || booking.id
            const data = await bookingChargesService.getChargesForBooking(bookingId)
            setCharges(data)
        } catch (error) {
            console.error('Failed to fetch charges:', error)
            toast.error('Failed to load charges')
        } finally {
            setLoading(false)
        }
    }

    const resetForm = () => {
        setDescription('')
        setCategory('food_beverage')
        setQuantity(1)
        setUnitPrice(0)
        setPaymentMethod('cash')
        setNotes('')
        setInventoryId('')
        setEditingChargeId(null)
        setShowAddForm(false)
    }

    const handleInventoryChange = (id: string) => {
        if (id === 'none') {
            setInventoryId('')
            return
        }
        const item = inventoryItems.find(i => i.id === id)
        if (item) {
            setInventoryId(id)
            setDescription(item.name)
            setUnitPrice(item.unitPrice)
        }
    }

    const handleAddCharge = async () => {
        if (!description.trim()) {
            toast.error('Please enter a description')
            return
        }
        if (unitPrice < 0) {
            toast.error('Please enter a valid price')
            return
        }

        setSubmitting(true)
        try {
            const bookingId = booking.remoteId || booking.id
            const chargeData: CreateChargeData = {
                bookingId,
                description: description.trim(),
                category,
                quantity,
                unitPrice,
                paymentMethod,
                notes: notes.trim() || undefined,
                inventoryId: inventoryId || undefined
            }

            await bookingChargesService.addCharge(chargeData)
            toast.success('Charge added successfully')
            resetForm()
            fetchCharges()
            onChargesUpdated?.()
        } catch (error: any) {
            console.error('Failed to add charge:', error)
            toast.error(error.message || 'Failed to add charge')
        } finally {
            setSubmitting(false)
        }
    }

    const addToCart = () => {
        if (!description.trim()) { toast.error('Please enter a description'); return }
        if (unitPrice < 0) { toast.error('Please enter a valid price'); return }
        setCart(prev => [...prev, {
            id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            inventoryId: inventoryId || undefined,
            description: description.trim(),
            category,
            quantity,
            unitPrice,
        }])
        // Reset only the item fields; keep the form open, and keep shared
        // category / paymentMethod / notes for the next line.
        setDescription('')
        setQuantity(1)
        setUnitPrice(0)
        setInventoryId('')
    }

    const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id))

    const saveCart = async () => {
        // Include the current form line if filled but not yet added to the list.
        const staged = description.trim()
            ? [...cart, { id: 'current', inventoryId: inventoryId || undefined, description: description.trim(), category, quantity, unitPrice }]
            : cart
        if (staged.length === 0) { toast.error('Add at least one item'); return }

        setSubmitting(true)
        let ok = 0, fail = 0
        for (const c of staged) {
            try {
                const chargeData: CreateChargeData = {
                    bookingId: booking.remoteId || booking.id,
                    description: c.description,
                    category: c.category,
                    quantity: c.quantity,
                    unitPrice: c.unitPrice,
                    paymentMethod,
                    notes: notes.trim() || undefined,
                    inventoryId: c.inventoryId,
                }
                await bookingChargesService.addCharge(chargeData)
                ok++
            } catch (error) {
                fail++
                console.error('Failed to add cart charge:', error)
            }
        }
        setSubmitting(false)
        setCart([])
        resetForm()
        fetchCharges()
        onChargesUpdated?.()
        if (ok) toast.success(`Added ${ok} item${ok > 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`)
        else toast.error('Failed to add charges')
    }

    const handleEditCharge = async (chargeId: string) => {
        setSubmitting(true)
        try {
            await bookingChargesService.updateCharge(chargeId, {
                description: description.trim(),
                category,
                quantity,
                unitPrice,
                paymentMethod,
                notes: notes.trim() || undefined
            })
            toast.success('Charge updated successfully')
            resetForm()
            fetchCharges()
            onChargesUpdated?.()
        } catch (error: any) {
            console.error('Failed to update charge:', error)
            toast.error(error.message || 'Failed to update charge')
        } finally {
            setSubmitting(false)
        }
    }

    const handleDeleteCharge = async (chargeId: string) => {
        if (!confirm('Are you sure you want to delete this charge?')) return

        try {
            await bookingChargesService.deleteCharge(chargeId)
            toast.success('Charge deleted')
            fetchCharges()
            onChargesUpdated?.()
        } catch (error: any) {
            console.error('Failed to delete charge:', error)
            toast.error(error.message || 'Failed to delete charge')
        }
    }

    const startEditCharge = (charge: BookingCharge) => {
        setDescription(charge.description)
        setCategory(charge.category)
        setQuantity(charge.quantity)
        setUnitPrice(charge.unitPrice)
        setPaymentMethod((charge.paymentMethod as 'cash' | 'mobile_money' | 'card' | 'pay_later') || 'cash')
        setNotes(charge.notes || '')
        setInventoryId((charge as any).inventoryId || '')
        setEditingChargeId(charge.id)
        setShowAddForm(true)
    }

    const totalCharges = charges.reduce((sum, c) => sum + (c.amount || 0), 0)
    const roomCost = booking?.totalPrice || booking?.amount || 0
    const grandTotal = roomCost + totalCharges
    const isCheckedOut = booking?.status === 'checked-out'
    const canEdit = !isCheckoutMode && !isCheckedOut

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        Guest Charges - {guest?.name || 'Guest'}
                    </DialogTitle>
                    <DialogDescription>
                        Room {booking?.roomNumber || 'N/A'} •
                        {booking?.checkIn && ` ${format(new Date(booking.checkIn), 'MMM d')} - `}
                        {booking?.checkOut && format(new Date(booking.checkOut), 'MMM d, yyyy')}
                    </DialogDescription>
                </DialogHeader>

                {/* Summary Card */}
                <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                                <p className="text-sm text-muted-foreground">Room Cost</p>
                                <p className="text-lg font-semibold">{formatCurrencySync(roomCost, currency)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Additional Charges</p>
                                <p className="text-lg font-semibold text-primary">{formatCurrencySync(totalCharges, currency)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Grand Total</p>
                                <p className="text-xl font-bold">{formatCurrencySync(grandTotal, currency)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Add/Edit Charge Form */}
                {canEdit && (
                    <>
                        {!showAddForm ? (
                            <Button
                                variant="outline"
                                onClick={() => setShowAddForm(true)}
                                className="w-full"
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                Add Charge
                            </Button>
                        ) : (
                            <Card className="border-primary/20 shadow-sm">
                                <CardContent className="pt-4 space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h4 className="font-medium flex items-center gap-2">
                                            {editingChargeId ? <Edit2 className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                                            {editingChargeId ? 'Edit Charge' : 'Add New Charge'}
                                        </h4>
                                        <Button variant="ghost" size="sm" onClick={resetForm}>
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>

                                    <div className="space-y-3">
                                        {/* Inventory Selection */}
                                        {!editingChargeId && (
                                            <div>
                                                <Label className="text-xs text-muted-foreground mb-1 block">Link to Inventory Item (Optional)</Label>
                                                <Select value={inventoryId || 'none'} onValueChange={handleInventoryChange}>
                                                    <SelectTrigger className="bg-primary/5 border-primary/10">
                                                        <Package className="w-4 h-4 mr-2 text-primary/60" />
                                                        <SelectValue placeholder="Search inventory..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="none">-- Not an inventory item --</SelectItem>
                                                        {inventoryItems.map(item => (
                                                            <SelectItem key={item.id} value={item.id}>
                                                                {item.name} ({item.stockQuantity} in stock)
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}

                                        <div>
                                            <Label htmlFor="description">Description</Label>
                                            <Input
                                                id="description"
                                                value={description}
                                                onChange={(e) => setDescription(e.target.value)}
                                                placeholder="e.g., Room Service - Jollof Rice"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <Label htmlFor="category">Category</Label>
                                                <Select value={category} onValueChange={(v) => setCategory(v as ChargeCategory)}>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {Object.entries(CHARGE_CATEGORIES)
                                                            .filter(([key]) => key !== 'room_extension')
                                                            .map(([key, label]) => (
                                                                <SelectItem key={key} value={key}>{label}</SelectItem>
                                                            ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div>
                                                <Label htmlFor="quantity">Quantity</Label>
                                                <Input
                                                    id="quantity"
                                                    type="number"
                                                    min={1}
                                                    value={quantity}
                                                    onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <Label htmlFor="unitPrice">Unit Price</Label>
                                                <Input
                                                    id="unitPrice"
                                                    type="number"
                                                    min={0}
                                                    step={0.01}
                                                    value={unitPrice}
                                                    onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
                                                />
                                            </div>

                                            <div>
                                                <Label>Total Amount</Label>
                                                <p className="text-lg font-semibold mt-2 text-emerald-700">
                                                    {formatCurrencySync(quantity * unitPrice, currency)}
                                                </p>
                                            </div>
                                        </div>

                                        <div>
                                            <Label>Payment Method</Label>
                                            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as 'cash' | 'mobile_money' | 'card' | 'pay_later')}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="cash">💵 Cash</SelectItem>
                                                    <SelectItem value="mobile_money">📱 Mobile Money</SelectItem>
                                                    <SelectItem value="card">💳 Card</SelectItem>
                                                    <SelectItem value="pay_later">⏳ Pay Later (add to folio)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div>
                                            <Label htmlFor="notes">Notes (Optional)</Label>
                                            <Textarea
                                                id="notes"
                                                value={notes}
                                                onChange={(e) => setNotes(e.target.value)}
                                                placeholder="Any additional notes..."
                                                rows={2}
                                            />
                                        </div>
                                    </div>

                                    {/* Multi-item staging cart (not shown while editing an existing charge) */}
                                    {!editingChargeId && cart.length > 0 && (
                                        <div className="space-y-1.5 pt-2 border-t">
                                            <p className="text-xs font-medium text-muted-foreground">Items to add ({cart.length})</p>
                                            {cart.map(c => (
                                                <div key={c.id} className="flex items-center justify-between text-sm">
                                                    <span className="truncate">{c.description} ({c.quantity}×)</span>
                                                    <span className="flex items-center gap-2">
                                                        <span className="font-medium">{formatCurrencySync(c.quantity * c.unitPrice, currency)}</span>
                                                        <button onClick={() => removeFromCart(c.id)} className="text-destructive hover:opacity-70" aria-label="Remove item">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </span>
                                                </div>
                                            ))}
                                            <div className="flex justify-between text-sm font-semibold pt-1 border-t">
                                                <span>Subtotal</span>
                                                <span>{formatCurrencySync(cartTotal, currency)}</span>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap gap-2 justify-end pt-2">
                                        <Button variant="outline" onClick={resetForm}>
                                            Cancel
                                        </Button>
                                        {!editingChargeId && (
                                            <Button variant="secondary" onClick={addToCart} disabled={submitting} className="gap-1.5">
                                                <Plus className="w-4 h-4" /> Add to list
                                            </Button>
                                        )}
                                        {!editingChargeId && (cart.length > 0 || description.trim().length > 0) && (
                                            <Button onClick={saveCart} disabled={submitting} className="min-w-[100px]">
                                                {submitting ? (
                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                ) : (
                                                    <Check className="w-4 h-4 mr-2" />
                                                )}
                                                Save all
                                            </Button>
                                        )}
                                        <Button
                                            onClick={() => editingChargeId
                                                ? handleEditCharge(editingChargeId)
                                                : handleAddCharge()
                                            }
                                            disabled={submitting}
                                            className="min-w-[100px]"
                                        >
                                            {submitting ? (
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            ) : (
                                                <Check className="w-4 h-4 mr-2" />
                                            )}
                                            {editingChargeId ? 'Update' : 'Add'} Charge
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </>
                )}

                {/* Charges List */}
                <div className="space-y-2">
                    <h4 className="font-medium text-sm text-muted-foreground">
                        Charges ({charges.length})
                    </h4>

                    {loading ? (
                        <div className="flex justify-center py-4">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : charges.length === 0 ? (
                        <p className="text-center py-4 text-muted-foreground italic">
                            No additional charges recorded
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {charges.map((charge) => (
                                <div
                                    key={charge.id}
                                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors group"
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium">{charge.description}</span>
                                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 uppercase font-bold tracking-tight">
                                                {CHARGE_CATEGORIES[charge.category]}
                                            </Badge>
                                            {charge.paymentMethod && (
                                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 uppercase font-bold tracking-tight">
                                                    {charge.paymentMethod === 'cash' ? '💵 Cash'
                                                        : charge.paymentMethod === 'mobile_money' ? '📱 MoMo'
                                                        : charge.paymentMethod === 'pay_later' ? '⏳ Pay Later'
                                                        : '💳 Card'}
                                                </Badge>
                                            )}
                                            {(charge as any).inventoryId && (
                                                <Badge variant="outline" className="text-[10px] h-5 px-1.5 uppercase font-bold tracking-tight border-primary/30 text-primary bg-primary/5">
                                                    <Package className="w-2.5 h-2.5 mr-1" />
                                                    Inventory
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-0.5">
                                            {charge.quantity} × {formatCurrencySync(charge.unitPrice, currency)}
                                            {charge.notes && ` • ${charge.notes}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="font-bold text-base">
                                            {formatCurrencySync(charge.amount, currency)}
                                        </span>
                                        {canEdit && (
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => startEditCharge(charge)}
                                                >
                                                    <Edit2 className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() => handleDeleteCharge(charge.id)}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter className="border-t pt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
