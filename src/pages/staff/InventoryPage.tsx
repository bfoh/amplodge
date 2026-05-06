import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { 
  Package, 
  Search, 
  Plus, 
  AlertTriangle, 
  TrendingUp, 
  ArrowRight, 
  History,
  MoreVertical,
  Edit,
  Trash2,
  Package2
} from 'lucide-react'
import { inventoryService, type InventoryItem } from '@/services/inventory-service'
import { toast } from 'sonner'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { Link } from 'react-router-dom'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function InventoryPage() {
  const { currency } = useCurrency()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  
  // Form state
  const [form, setForm] = useState({
    name: '',
    category: 'drinks',
    stockQuantity: 0,
    minThreshold: 5,
    unitPrice: 0,
  })

  useEffect(() => {
    loadInventory()
  }, [])

  const loadInventory = async () => {
    setLoading(true)
    try {
      const data = await inventoryService.getItems()
      setItems(data)
    } catch (e) {
      toast.error('Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!form.name) return toast.error('Item name is required')
    
    try {
      if (editingItem) {
        await inventoryService.updateItem(editingItem.id, form)
        toast.success('Item updated successfully')
      } else {
        await inventoryService.addItem(form)
        toast.success('Item added successfully')
      }
      setIsAddOpen(false)
      setEditingItem(null)
      setForm({ name: '', category: 'drinks', stockQuantity: 0, minThreshold: 5, unitPrice: 0 })
      loadInventory()
    } catch (e) {
      toast.error('Failed to save item')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return
    try {
      await inventoryService.deleteItem(id)
      toast.success('Item deleted')
      loadInventory()
    } catch (e) {
      toast.error('Failed to delete item')
    }
  }

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.category.toLowerCase().includes(search.toLowerCase())
  )

  const lowStockItems = items.filter(i => i.stockQuantity <= i.minThreshold)
  const totalValue = items.reduce((sum, i) => sum + (i.stockQuantity * i.unitPrice), 0)

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Management</h1>
          <p className="text-muted-foreground text-sm">Monitor stock levels and manage hotel supplies in real-time.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="gap-2">
            <Link to="/staff/inventory/transactions">
              <History className="w-4 h-4" />
              Transactions
            </Link>
          </Button>
          <Dialog open={isAddOpen} onOpenChange={(open) => {
            setIsAddOpen(open)
            if (!open) {
              setEditingItem(null)
              setForm({ name: '', category: 'drinks', stockQuantity: 0, minThreshold: 5, unitPrice: 0 })
            }
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="w-4 h-4" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Inventory Item'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Item Name</Label>
                  <Input 
                    id="name" 
                    placeholder="e.g. Bottled Water 500ml" 
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Input 
                      id="category" 
                      placeholder="drinks, snacks, etc." 
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="price">Unit Price ({currency})</Label>
                    <Input 
                      id="price" 
                      type="number" 
                      value={form.unitPrice}
                      onChange={e => setForm(f => ({ ...f, unitPrice: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="stock">Current Stock</Label>
                    <Input 
                      id="stock" 
                      type="number" 
                      value={form.stockQuantity}
                      onChange={e => setForm(f => ({ ...f, stockQuantity: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="threshold">Alert Threshold</Label>
                    <Input 
                      id="threshold" 
                      type="number" 
                      value={form.minThreshold}
                      onChange={e => setForm(f => ({ ...f, minThreshold: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button onClick={handleSave}>Save Item</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all categories</p>
          </CardContent>
        </Card>
        <Card className={lowStockItems.length > 0 ? "bg-rose-50 border-rose-100" : "bg-muted/50"}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
            <AlertTriangle className={lowStockItems.length > 0 ? "w-4 h-4 text-rose-500 animate-pulse" : "w-4 h-4 text-muted-foreground"} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${lowStockItems.length > 0 ? 'text-rose-600' : ''}`}>{lowStockItems.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Items below threshold</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{formatCurrencySync(totalValue, currency)}</div>
            <p className="text-xs text-muted-foreground mt-1">Potential revenue</p>
          </CardContent>
        </Card>
      </div>

      {/* Table Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Product List</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-center">Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">Loading inventory...</TableCell>
                  </TableRow>
                ) : filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">No items found.</TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item) => {
                    const isLow = item.stockQuantity <= item.minThreshold
                    const isOut = item.stockQuantity <= 0
                    
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{item.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrencySync(item.unitPrice, currency)}
                        </TableCell>
                        <TableCell className="text-center font-bold">
                          {item.stockQuantity}
                        </TableCell>
                        <TableCell>
                          {isOut ? (
                            <Badge variant="destructive" className="gap-1">
                              Out of Stock
                            </Badge>
                          ) : isLow ? (
                            <Badge variant="warning" className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Low Stock
                            </Badge>
                          ) : (
                            <Badge variant="success" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">
                              In Stock
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => {
                                setEditingItem(item)
                                setForm({
                                  name: item.name,
                                  category: item.category,
                                  stockQuantity: item.stockQuantity,
                                  minThreshold: item.minThreshold,
                                  unitPrice: item.unitPrice,
                                })
                                setIsAddOpen(true)
                              }}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(item.id)}>
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Low Stock Highlight Grid */}
      {lowStockItems.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-rose-600">
            <AlertTriangle className="w-4 h-4" />
            Stock Replenishment Needed
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {lowStockItems.slice(0, 4).map(item => (
              <div key={item.id} className="p-4 rounded-xl border border-rose-100 bg-rose-50/50 flex flex-col gap-2 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-1 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Package2 className="w-12 h-12" />
                </div>
                <p className="text-xs font-semibold text-rose-600 uppercase tracking-wider">{item.category}</p>
                <p className="font-bold truncate">{item.name}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm text-muted-foreground">Current: <span className="font-bold text-rose-700">{item.stockQuantity}</span></span>
                  <span className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-medium">Threshold: {item.minThreshold}</span>
                </div>
              </div>
            ))}
            {lowStockItems.length > 4 && (
              <Button variant="ghost" className="h-full border border-dashed border-rose-200 text-rose-600 hover:bg-rose-50" asChild>
                <Link to="/staff/inventory/transactions" className="flex flex-col gap-1 items-center justify-center">
                  <span className="text-lg font-bold">+{lowStockItems.length - 4} More</span>
                  <span className="text-xs opacity-70 flex items-center gap-1">View all alerts <ArrowRight className="w-3 h-3" /></span>
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
