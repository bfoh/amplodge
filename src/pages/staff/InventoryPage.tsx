import { useState, useEffect } from 'react'
import { useSubscription } from '@/hooks/use-subscription'
import { db, auth } from '@/lib/db'
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
  Package2,
  Users,
  ChevronDown,
  Calendar,
  Wallet,
  TrendingDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { revenueService } from '@/services/revenue-service'
import { analyticsService } from '@/services/analytics-service'
import { inventoryService } from '@/services/inventory-service'
import { type InventoryItem } from '@/types'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function InventoryPage() {
  const { currency } = useCurrency()
  const inventoryUpdate = useSubscription('inventory')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  
  // Restock state
  const [isRestockOpen, setIsRestockOpen] = useState(false)
  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null)
  const [restockAmount, setRestockAmount] = useState(0)
  const [restockNotes, setRestockNotes] = useState('')
  const [currentUser, setCurrentUser] = useState<{ id: string, email: string } | null>(null)
  
  // Form state
  const [form, setForm] = useState({
    name: '',
    category: 'drinks',
    stockQuantity: 0,
    minThreshold: 5,
    unitPrice: 0,
  })

  // Revenue Track State
  const [activeTab, setActiveTab] = useState<'inventory' | 'revenue'>('inventory')
  const [revPeriod, setRevPeriod] = useState<'weekly' | 'monthly' | 'yearly'>('weekly')
  const [allCharges, setAllCharges] = useState<any[]>([])
  const [allSales, setAllSales] = useState<any[]>([])
  const [revBookings, setRevBookings] = useState<any[]>([])
  const [allStaff, setAllStaff] = useState<any[]>([])
  const [isTableExpanded, setIsTableExpanded] = useState(false)

  useEffect(() => {
    loadInventory()
    fetchUser()
    loadRevenueData()
  }, [inventoryUpdate])

  const loadRevenueData = async () => {
    try {
      const shared = await analyticsService.prefetchSharedData() || {} as any
      const { chargesRaw = [], standaloneSales = [], bookings = [], staff = [] } = shared
      setAllCharges(chargesRaw)
      setAllSales(standaloneSales)
      setRevBookings(bookings)
      setAllStaff(staff)
    } catch (e) {
      console.error('Failed to load revenue data', e)
      // Ensure state is always safe arrays even on error
      setAllCharges([])
      setAllSales([])
      setRevBookings([])
      setAllStaff([])
    }
  }

  const fetchUser = async () => {
    const user = await auth.me()
    if (user) setCurrentUser(user as any)
  }

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

  const handleRestock = async () => {
    if (!restockItem) return
    if (restockAmount <= 0) return toast.error('Please enter a valid amount')

    try {
      await inventoryService.restockStock(
        restockItem.id, 
        restockAmount, 
        { 
          id: currentUser?.id || 'system', 
          name: currentUser?.email?.split('@')[0] || 'Admin' 
        },
        restockNotes
      )
      toast.success(`Successfully restocked ${restockItem.name}`)
      setIsRestockOpen(false)
      setRestockAmount(0)
      setRestockNotes('')
      loadInventory()
    } catch (e) {
      toast.error('Failed to restock item')
    }
  }

  const filteredItems = items.filter(item => 
    (item.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (item.category || '').toLowerCase().includes(search.toLowerCase())
  )

  const lowStockItems = items.filter(i => i.stockQuantity <= i.minThreshold)
  const totalValue = items.reduce((sum, i) => sum + (i.stockQuantity * i.unitPrice), 0)

  // ── Revenue Logic ───────────────────────────────────────────────────────
  const getPeriodRange = (type: 'weekly' | 'monthly' | 'yearly') => {
    const now = new Date()
    const start = new Date()
    if (type === 'weekly') {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      start.setDate(diff)
      start.setHours(0, 0, 0, 0)
    } else if (type === 'monthly') {
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
    } else {
      start.setMonth(0, 1)
      start.setHours(0, 0, 0, 0)
    }
    return { start, end: now }
  }

  const period = getPeriodRange(revPeriod)
  const filteredCharges = allCharges.filter(c => {
    const d = new Date(c.createdAt || c.created_at)
    return d >= period.start && d <= period.end
  })
  const filteredSales = allSales.filter(s => {
    const d = new Date(s.saleDate || s.sale_date)
    return d >= period.start && d <= period.end
  })

  const bookingsMap = new Map(revBookings.map(b => [b.id, b]))
  const staffLookup = new Map(allStaff.map(s => [s.id, s.name]))
  const staffUserLookup = new Map(allStaff.map(s => [s.userId || s.user_id, s.name]))
  
  const resolveStaffName = (id?: string, name?: string) => {
    if (!id || id === 'system' || id === 'unknown') {
      if (name && name !== 'System' && name !== 'unknown') return name
      return 'System'
    }
    return staffLookup.get(id) || staffUserLookup.get(id) || name || 'System'
  }

  const allEntries = [
    ...filteredCharges
      .filter(c => c.category !== 'room_extension')
      .map(c => {
      const b = bookingsMap.get(c.bookingId || c.booking_id)
      return {
        id: c.id,
        date: c.createdAt || c.created_at,
        description: c.description || 'Charge',
        category: c.category || 'other',
        staffName: resolveStaffName(c.createdBy || c.created_by, c.createdByName || c.created_by_name),
        amount: Number(c.amount || 0),
        paymentMethod: c.paymentMethod || c.payment_method || (c.notes?.toLowerCase().includes('cash') ? 'cash' : ''),
        guestName: b?.guestName || b?.guest?.fullName || c.guestName || '—',
        roomNumber: b?.roomNumber || '—'
      }
    }),
    ...filteredSales.map(s => ({
      id: s.id,
      date: s.saleDate || s.sale_date,
      description: s.description || 'Walk-in Sale',
      category: s.category || 'other',
      staffName: resolveStaffName(s.staffId || s.staff_id || (s as any).createdBy || (s as any).created_by, s.staffName || s.staff_name || (s as any).createdByName || (s as any).created_by_name),
      amount: Number(s.amount || 0),
      paymentMethod: s.paymentMethod || s.payment_method || '',
      guestName: 'Walk-in',
      roomNumber: '—'
    }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const totalRevenue = allEntries.reduce((s, e) => s + e.amount, 0)

  const staffMap: Record<string, { name: string, amount: number }> = {}
  allEntries.forEach(e => {
    const name = e.staffName
    if (!staffMap[name]) staffMap[name] = { name, amount: 0 }
    staffMap[name].amount += e.amount
  })
  const staffEntries = Object.values(staffMap).sort((a, b) => b.amount - a.amount)

  const normPay = (m: string) => {
    const l = (m || '').toLowerCase()
    if (l.includes('cash')) return 'cash'
    if (l.includes('momo') || l.includes('mobile')) return 'mobile_money'
    if (l.includes('card') || l.includes('pos')) return 'card'
    return 'other'
  }

  const payAmounts = { cash: 0, momo: 0, card: 0, other: 0 }
  allEntries.forEach(e => {
    const m = normPay(e.paymentMethod)
    if (m === 'cash') payAmounts.cash += e.amount
    else if (m === 'mobile_money') payAmounts.momo += e.amount
    else if (m === 'card') payAmounts.card += e.amount
    else payAmounts.other += e.amount
  })
  const payTotal = Object.values(payAmounts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Tabs Switcher */}
      <div className="flex p-1 bg-muted/50 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('inventory')}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all",
            activeTab === 'inventory' ? "bg-white shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Package className="w-4 h-4" />
          Product Management
        </button>
        <button
          onClick={() => setActiveTab('revenue')}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all",
            activeTab === 'revenue' ? "bg-white shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <TrendingUp className="w-4 h-4" />
          Sales Performance
        </button>
      </div>

      {activeTab === 'inventory' ? (
        <>
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
                    <Select 
                      value={form.category} 
                      onValueChange={val => setForm(f => ({ ...f, category: val }))}
                    >
                      <SelectTrigger id="category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="drinks">Drinks</SelectItem>
                        <SelectItem value="water">Water</SelectItem>
                        <SelectItem value="wine">Wine</SelectItem>
                        <SelectItem value="biscuits">Biscuits</SelectItem>
                        <SelectItem value="snacks">Snacks</SelectItem>
                        <SelectItem value="toiletries">Toiletries</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
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
        <CardHeader className="pb-3 px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="text-lg">Product List</CardTitle>
            <div className="relative w-full sm:w-64">
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
        <CardContent className="p-0 sm:p-6">
          {/* Desktop Table View */}
          <div className="hidden md:block rounded-md border mx-0 sm:mx-0">
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
                            <Badge variant="outline" className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Low Stock
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">
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
                                setRestockItem(item)
                                setIsRestockOpen(true)
                              }}>
                                <Plus className="w-4 h-4 mr-2" />
                                Restock
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setEditingItem(item)
                                setForm({
                                  name: item.name,
                                  category: item.category,
                                  stockQuantity: item.stockQuantity,
                                  minThreshold: item.minThreshold,
                                  unitPrice: item.unitPrice,
                                Lyn: item.Lyn || 0,
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

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-border border-t">
            {loading ? (
              <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Loading products...</span>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">No products found.</div>
            ) : (
              filteredItems.map((item) => {
                const isLow = item.stockQuantity <= item.minThreshold
                const isOut = item.stockQuantity <= 0
                
                return (
                  <div 
                    key={item.id} 
                    className="p-4 bg-white active:scale-[0.99] transition-transform space-y-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-sm text-stone-800 truncate">{item.name}</p>
                          <Badge variant="outline" className="text-[9px] h-4 uppercase tracking-tighter font-black py-0 px-1.5 border-stone-200 text-stone-500">
                            {item.category}
                          </Badge>
                        </div>
                        <p className="text-lg font-black text-primary">
                          {formatCurrencySync(item.unitPrice, currency)}
                        </p>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-stone-50 active:bg-stone-100 shrink-0">
                            <MoreVertical className="w-4 h-4 text-stone-400" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => {
                            setRestockItem(item)
                            setIsRestockOpen(true)
                          }} className="py-2.5">
                            <Plus className="w-4 h-4 mr-2" />
                            Add Stock
                          </DropdownMenuItem>
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
                          }} className="py-2.5">
                            <Edit className="w-4 h-4 mr-2" />
                            Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive py-2.5" onClick={() => handleDelete(item.id)}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete Item
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex items-center justify-between bg-stone-50 rounded-xl p-3 border border-stone-100">
                      <div className="space-y-0.5">
                        <p className="text-[9px] uppercase tracking-tighter font-bold text-stone-400">Inventory Status</p>
                        <div className="flex items-center gap-1.5">
                          {isOut ? (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-rose-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
                              Out of Stock
                            </span>
                          ) : isLow ? (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                              Low Stock
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                              In Stock
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right space-y-0.5 border-l border-stone-200 pl-4">
                        <p className="text-[9px] uppercase tracking-tighter font-bold text-stone-400">Current Qty</p>
                        <p className={cn(
                          "text-xl font-black",
                          isOut ? "text-rose-600" : isLow ? "text-amber-600" : "text-stone-800"
                        )}>
                          {item.stockQuantity}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
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

      {/* Restock Dialog */}
      <Dialog open={isRestockOpen} onOpenChange={setIsRestockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restock Item: {restockItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="restock-amount">Amount to Add</Label>
              <Input 
                id="restock-amount" 
                type="number" 
                placeholder="Enter quantity..."
                value={restockAmount || ''}
                onChange={e => setRestockAmount(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="restock-notes">Notes (Optional)</Label>
              <Input 
                id="restock-notes" 
                placeholder="e.g. New delivery from supplier" 
                value={restockNotes}
                onChange={e => setRestockNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRestockOpen(false)}>Cancel</Button>
            <Button onClick={handleRestock} className="bg-emerald-600 hover:bg-emerald-700 text-white">Confirm Restock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Revenue Track Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Sales Performance</h1>
              <p className="text-muted-foreground text-sm">Monitor revenue from products, drinks, and other hotel services.</p>
            </div>
            <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg">
              {(['weekly', 'monthly', 'yearly'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setRevPeriod(t)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all",
                    revPeriod === t ? "bg-white shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Revenue Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-orange-50 border-orange-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-orange-800">Period Revenue</CardTitle>
                <TrendingUp className="w-4 h-4 text-orange-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-700">{formatCurrencySync(totalRevenue, currency)}</div>
                <p className="text-xs text-orange-600/70 mt-1 capitalize">{revPeriod} total sales</p>
              </CardContent>
            </Card>
            <Card className="bg-emerald-50 border-emerald-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-emerald-800">Cash Collected</CardTitle>
                <Wallet className="w-4 h-4 text-emerald-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-700">{formatCurrencySync(payAmounts.cash, currency)}</div>
                <p className="text-xs text-emerald-600/70 mt-1">Physical cash on hand</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-50 border-blue-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-blue-800">Total Transactions</CardTitle>
                <History className="w-4 h-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-700">{allEntries.length}</div>
                <p className="text-xs text-blue-600/70 mt-1">Charges & walk-in sales</p>
              </CardContent>
            </Card>
          </div>

          {/* Staff Performance & Payment Methods */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Staff Sales Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {staffEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic text-center py-4">No staff sales recorded</p>
                ) : (
                  <div className="space-y-4">
                    {staffEntries.map((s, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium">{s.name}</span>
                          <span className="font-bold">{formatCurrencySync(s.amount, currency)}</span>
                        </div>
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all duration-1000" 
                            style={{ width: `${totalRevenue > 0 ? (s.amount / totalRevenue) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  Payment Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { label: 'Cash', amount: payAmounts.cash, color: 'bg-emerald-500' },
                    { label: 'Mobile Money', amount: payAmounts.momo, color: 'bg-blue-500' },
                    { label: 'Card/POS', amount: payAmounts.card, color: 'bg-purple-500' },
                    { label: 'Other', amount: payAmounts.other, color: 'bg-slate-400' }
                  ].map((p, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("w-2 h-2 rounded-full", p.color)} />
                          {p.label}
                        </span>
                        <span className="font-bold">{formatCurrencySync(p.amount, currency)}</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full transition-all duration-1000", p.color)}
                          style={{ width: `${payTotal > 0 ? (p.amount / payTotal) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Entries Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 px-4 sm:px-6">
              <CardTitle className="text-sm font-semibold">Recent Transactions</CardTitle>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs h-8 gap-1.5"
                onClick={() => setIsTableExpanded(!isTableExpanded)}
              >
                {isTableExpanded ? 'Hide' : 'Show All'}
                <ChevronDown className={cn("w-3 h-3 transition-transform", isTableExpanded && "rotate-180")} />
              </Button>
            </CardHeader>
            <CardContent className="p-0 sm:p-6">
              {/* Desktop Table View */}
              <div className="hidden md:block rounded-md border overflow-hidden mx-0 sm:mx-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Date</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Item/Service</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Guest</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Room</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Staff</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Payment</TableHead>
                      <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-muted-foreground italic">No transactions found for this period</TableCell>
                      </TableRow>
                    ) : (
                      (isTableExpanded ? allEntries : allEntries.slice(0, 10)).map((e, idx) => (
                        <tr key={idx} className="text-xs hover:bg-muted/20 transition-colors border-b last:border-0">
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                            {new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </td>
                          <td className="px-4 py-3 font-medium">{e.description}</td>
                          <td className="px-4 py-3 text-muted-foreground">{e.guestName}</td>
                          <td className="px-4 py-3 text-muted-foreground">{(e as any).roomNumber || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground">{e.staffName}</td>
                          <td className="px-4 py-3 capitalize text-[10px] font-semibold text-muted-foreground">
                            {e.paymentMethod || '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-bold tabular-nums">
                            {formatCurrencySync(e.amount, currency)}
                          </td>
                        </tr>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden divide-y divide-border border-t">
                {allEntries.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground italic">No transactions found.</div>
                ) : (
                  (isTableExpanded ? allEntries : allEntries.slice(0, 10)).map((e, idx) => (
                    <div 
                      key={idx} 
                      className="p-4 bg-white active:scale-[0.99] transition-transform space-y-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <p className="font-bold text-sm text-stone-800 truncate">{e.description}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">
                              {new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                            <Badge variant="outline" className="text-[9px] h-4 uppercase tracking-tighter font-black py-0 px-1.5 border-stone-200 text-stone-500">
                              {e.category}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm font-black text-stone-900 tabular-nums">
                          {formatCurrencySync(e.amount, currency)}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 bg-stone-50 rounded-xl p-3 border border-stone-100">
                        <div className="space-y-0.5">
                          <p className="text-[9px] uppercase tracking-tighter font-bold text-stone-400">Guest / Room</p>
                          <p className="text-[11px] font-bold text-stone-700 truncate">
                            {e.guestName} {e.roomNumber !== '—' ? `· Room ${e.roomNumber}` : ''}
                          </p>
                        </div>
                        <div className="text-right space-y-0.5 border-l border-stone-200 pl-4">
                          <p className="text-[9px] uppercase tracking-tighter font-bold text-stone-400">Staff / Payment</p>
                          <p className="text-[11px] font-bold text-stone-700 truncate">
                            {e.staffName} · <span className="capitalize">{e.paymentMethod || 'Other'}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {!isTableExpanded && allEntries.length > 10 && (
                <div className="text-center mt-4 pb-4">
                  <Button variant="outline" size="sm" className="w-[90%] sm:w-auto" onClick={() => setIsTableExpanded(true)}>
                    View All {allEntries.length} Transactions
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
