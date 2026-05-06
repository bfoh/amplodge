import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getCurrencySymbol } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { toast } from 'sonner'
import { Loader2, Package } from 'lucide-react'
import { standaloneSalesService, SALE_CATEGORIES, type StandaloneSale } from '@/services/standalone-sales-service'
import { inventoryService, type InventoryItem } from '@/services/inventory-service'

interface LogSaleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staffId: string
  staffName: string
  onSuccess?: () => void
}

const EMPTY_FORM = {
  description: '',
  category: 'food_beverage' as StandaloneSale['category'],
  quantity: 1,
  unitPrice: '',
  paymentMethod: 'cash' as StandaloneSale['paymentMethod'],
  notes: '',
  inventoryId: undefined as string | undefined,
}

export function LogSaleDialog({ open, onOpenChange, staffId, staffName, onSuccess }: LogSaleDialogProps) {
  const { currency } = useCurrency()
  const [form, setForm] = useState(EMPTY_FORM)
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [saving, setSaving] = useState(false)

  const amount = form.quantity * (parseFloat(form.unitPrice) || 0)

  useEffect(() => {
    if (open) {
      inventoryService.getItems().then(setInventoryItems).catch(console.error)
    }
  }, [open])

  const reset = () => {
    setForm(EMPTY_FORM)
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const handleInventoryChange = (id: string) => {
    if (id === 'none') {
      setForm(f => ({ ...f, inventoryId: undefined }))
      return
    }
    const item = inventoryItems.find(i => i.id === id)
    if (item) {
      setForm(f => ({
        ...f,
        inventoryId: id,
        description: item.name,
        unitPrice: item.unitPrice.toString(),
      }))
    }
  }

  const handleSubmit = async () => {
    if (!form.description.trim()) { toast.error('Description is required'); return }
    if (!form.unitPrice || parseFloat(form.unitPrice) <= 0) { toast.error('Unit price must be greater than 0'); return }
    if (form.quantity < 1) { toast.error('Quantity must be at least 1'); return }

    setSaving(true)
    try {
      await standaloneSalesService.addSale({
        description: form.description.trim(),
        category: form.category,
        quantity: form.quantity,
        unitPrice: parseFloat(form.unitPrice),
        amount,
        notes: form.notes.trim(),
        staffId,
        staffName,
        saleDate: format(new Date(), 'yyyy-MM-dd'),
        paymentMethod: form.paymentMethod,
        inventoryId: form.inventoryId,
      })
      toast.success('Sale logged successfully')
      reset()
      onOpenChange(false)
      onSuccess?.()
    } catch (e) {
      toast.error('Failed to log sale')
      console.error('[LogSaleDialog]', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Log a Sale
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Inventory Selection */}
          <div className="space-y-1.5">
            <Label>Link to Inventory Item (Optional)</Label>
            <Select value={form.inventoryId || 'none'} onValueChange={handleInventoryChange}>
              <SelectTrigger>
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

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="sale-desc">Description <span className="text-destructive">*</span></Label>
            <Input
              id="sale-desc"
              placeholder="e.g. Bottled water x2, Soft drink"
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Category */}
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm(f => ({ ...f, category: v as StandaloneSale['category'] }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SALE_CATEGORIES).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Payment Method */}
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select
                value={form.paymentMethod}
                onValueChange={(v) => setForm(f => ({ ...f, paymentMethod: v as StandaloneSale['paymentMethod'] }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">💵 Cash</SelectItem>
                  <SelectItem value="mobile_money">📱 Mobile Money</SelectItem>
                  <SelectItem value="card">💳 Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Qty + Unit Price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sale-qty">Quantity</Label>
              <Input
                id="sale-qty"
                type="number"
                min="1"
                step="1"
                value={form.quantity}
                onChange={(e) => setForm(f => ({ ...f, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sale-price">Unit Price <span className="text-destructive">*</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {getCurrencySymbol(currency)}
                </span>
                <Input
                  id="sale-price"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={form.unitPrice}
                  onChange={(e) => setForm(f => ({ ...f, unitPrice: e.target.value }))}
                  className="pl-8"
                />
              </div>
            </div>
          </div>

          {/* Amount preview */}
          {amount > 0 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2 flex justify-between text-sm">
              <span className="text-emerald-700 font-medium">Total Amount</span>
              <span className="font-bold text-emerald-700">{getCurrencySymbol(currency)} {amount.toLocaleString('en-GH', { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="sale-notes">Notes (optional)</Label>
            <Textarea
              id="sale-notes"
              placeholder="Any additional details…"
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Log Sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
