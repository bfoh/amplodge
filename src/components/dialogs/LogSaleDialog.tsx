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
import { Loader2, Package, Plus, Trash2 } from 'lucide-react'
import { standaloneSalesService, SALE_CATEGORIES } from '@/services/standalone-sales-service'
import { inventoryService } from '@/services/inventory-service'
import { StandaloneSale, InventoryItem } from '@/types'

interface LogSaleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staffId: string
  staffName: string
  onSuccess?: () => void
}

type SaleLine = {
  id: string
  inventoryId?: string
  description: string
  category: StandaloneSale['category']
  quantity: number
  unitPrice: string
}

const newLine = (): SaleLine => ({
  id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  description: '',
  category: 'food_beverage',
  quantity: 1,
  unitPrice: '',
})

const lineTotal = (l: SaleLine) => l.quantity * (parseFloat(l.unitPrice) || 0)

export function LogSaleDialog({ open, onOpenChange, staffId, staffName, onSuccess }: LogSaleDialogProps) {
  const { currency } = useCurrency()
  const sym = getCurrencySymbol(currency)
  const [lines, setLines] = useState<SaleLine[]>([])
  const [draft, setDraft] = useState<SaleLine>(newLine())
  const [paymentMethod, setPaymentMethod] = useState<StandaloneSale['paymentMethod']>('cash')
  const [notes, setNotes] = useState('')
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [saving, setSaving] = useState(false)

  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0) + lineTotal(draft)

  useEffect(() => {
    if (open) {
      inventoryService.getItems().then(setInventoryItems).catch(console.error)
    }
  }, [open])

  const reset = () => {
    setLines([])
    setDraft(newLine())
    setPaymentMethod('cash')
    setNotes('')
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const handleInventoryChange = (id: string) => {
    if (id === 'none') {
      setDraft(d => ({ ...d, inventoryId: undefined }))
      return
    }
    const item = inventoryItems.find(i => i.id === id)
    if (item) {
      setDraft(d => ({ ...d, inventoryId: id, description: item.name, unitPrice: item.unitPrice.toString() }))
    }
  }

  const validateLine = (l: SaleLine): boolean => {
    if (!l.description.trim()) { toast.error('Description is required'); return false }
    if (!l.unitPrice || parseFloat(l.unitPrice) <= 0) { toast.error('Unit price must be greater than 0'); return false }
    if (l.quantity < 1) { toast.error('Quantity must be at least 1'); return false }
    return true
  }

  const addLine = () => {
    if (!validateLine(draft)) return
    setLines(prev => [...prev, draft])
    setDraft(newLine())
  }

  const removeLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id))

  const handleSubmit = async () => {
    // Include the draft line if the user filled it but didn't click "Add item".
    const toSave = draft.description.trim() ? [...lines, draft] : lines
    if (toSave.length === 0) { toast.error('Add at least one item'); return }
    for (const l of toSave) if (!validateLine(l)) return

    setSaving(true)
    let ok = 0, fail = 0
    for (const l of toSave) {
      try {
        await standaloneSalesService.addSale({
          description: l.description.trim(),
          category: l.category,
          quantity: l.quantity,
          unitPrice: parseFloat(l.unitPrice),
          amount: lineTotal(l),
          notes: notes.trim(),
          staffId,
          staffName,
          saleDate: format(new Date(), 'yyyy-MM-dd'),
          paymentMethod,
          inventoryId: l.inventoryId,
        })
        ok++
      } catch (e) {
        fail++
        console.error('[LogSaleDialog] line failed', e)
      }
    }
    setSaving(false)

    if (ok) {
      toast.success(`Logged ${ok} item${ok > 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`)
      reset()
      onOpenChange(false)
      onSuccess?.()
    } else {
      toast.error('Failed to log sale')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Log a Sale
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Added lines */}
          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map(l => (
                <div key={l.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{l.description}</p>
                    <p className="text-muted-foreground">{l.quantity} × {sym}{(parseFloat(l.unitPrice) || 0).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{sym}{lineTotal(l).toLocaleString()}</span>
                    <button onClick={() => removeLine(l.id)} className="text-destructive hover:opacity-70" aria-label="Remove item">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Draft add-line */}
          <div className="space-y-4 rounded-lg border border-dashed p-3">
            <div className="space-y-1.5">
              <Label>Link to Inventory Item (Optional)</Label>
              <Select value={draft.inventoryId || 'none'} onValueChange={handleInventoryChange}>
                <SelectTrigger><SelectValue placeholder="Search inventory..." /></SelectTrigger>
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

            <div className="space-y-1.5">
              <Label htmlFor="sale-desc">Description <span className="text-destructive">*</span></Label>
              <Input
                id="sale-desc"
                placeholder="e.g. Bottled water"
                value={draft.description}
                onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={draft.category}
                  onValueChange={(v) => setDraft(d => ({ ...d, category: v as StandaloneSale['category'] }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SALE_CATEGORIES).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sale-qty">Quantity</Label>
                <Input
                  id="sale-qty"
                  type="number"
                  min="1"
                  step="1"
                  value={draft.quantity}
                  onChange={(e) => setDraft(d => ({ ...d, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sale-price">Unit Price <span className="text-destructive">*</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{sym}</span>
                <Input
                  id="sale-price"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={draft.unitPrice}
                  onChange={(e) => setDraft(d => ({ ...d, unitPrice: e.target.value }))}
                  className="pl-8"
                />
              </div>
            </div>

            <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={addLine}>
              <Plus className="w-4 h-4" /> Add item
            </Button>
          </div>

          {/* Shared payment method */}
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as StandaloneSale['paymentMethod'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">💵 Cash</SelectItem>
                <SelectItem value="mobile_money">📱 Mobile Money</SelectItem>
                <SelectItem value="card">💳 Card</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="sale-notes">Notes (optional)</Label>
            <Textarea
              id="sale-notes"
              placeholder="Any additional details…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Grand total */}
          {grandTotal > 0 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2 flex justify-between text-sm">
              <span className="text-emerald-700 font-medium">Total</span>
              <span className="font-bold text-emerald-700">{sym} {grandTotal.toLocaleString('en-GH', { minimumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || (lines.length === 0 && !draft.description.trim())} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
