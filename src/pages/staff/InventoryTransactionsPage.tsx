import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  History, 
  ArrowLeft, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  RefreshCcw,
  Search,
  Filter
} from 'lucide-react'
import { inventoryService } from '@/services/inventory-service'
import { type InventoryTransaction, type InventoryItem } from '@/types'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { safeFormatAny } from '@/lib/safe-date'
import { Input } from '@/components/ui/input'

export function InventoryTransactionsPage() {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [items, setItems] = useState<Record<string, InventoryItem>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [txs, invItems] = await Promise.all([
        inventoryService.getTransactions(),
        inventoryService.getItems()
      ])
      
      const itemMap: Record<string, InventoryItem> = {}
      invItems.forEach(i => itemMap[i.id] = i)
      
      setTransactions(txs)
      setItems(itemMap)
    } catch (e) {
      toast.error('Failed to load transaction history')
    } finally {
      setLoading(false)
    }
  }

  const filteredTransactions = transactions.filter(tx => {
    const itemName = items[tx.inventoryId]?.name || ''
    return itemName.toLowerCase().includes(search.toLowerCase()) ||
           tx.staffName?.toLowerCase().includes(search.toLowerCase()) ||
           tx.notes?.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/staff/inventory">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Trail</h1>
            <p className="text-muted-foreground text-sm">Full traceability of all inventory movements and sales.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} className="gap-2">
          <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="py-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by item, staff, or notes..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" className="gap-2">
            <Filter className="w-4 h-4" />
            More Filters
          </Button>
        </CardContent>
      </Card>

      {/* Table Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center">Quantity</TableHead>
                  <TableHead className="text-center">Balance</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">Loading transactions...</TableCell>
                  </TableRow>
                ) : filteredTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">No transactions found.</TableCell>
                  </TableRow>
                ) : (
                  filteredTransactions.map((tx) => {
                    const item = items[tx.inventoryId]

                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          <div className="font-medium">{safeFormatAny(tx.createdAt, 'MMM d, yyyy')}</div>
                          <div className="text-muted-foreground">{safeFormatAny(tx.createdAt, 'HH:mm')}</div>
                        </TableCell>
                        <TableCell className="font-semibold">
                          {item ? item.name : <span className="text-muted-foreground italic">Deleted Item</span>}
                        </TableCell>
                        <TableCell>
                          {tx.type === 'sale' ? (
                            <Badge variant="outline" className="text-emerald-600 bg-emerald-50 border-emerald-100 gap-1">
                              <ArrowDownCircle className="w-3 h-3" />
                              Sale
                            </Badge>
                          ) : tx.type === 'restock' ? (
                            <Badge variant="outline" className="text-blue-600 bg-blue-50 border-blue-100 gap-1">
                              <ArrowUpCircle className="w-3 h-3" />
                              Restock
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground bg-muted/50 gap-1">
                              <RefreshCcw className="w-3 h-3" />
                              Adjustment
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className={`text-center font-bold ${tx.quantity < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                        </TableCell>
                        <TableCell className="text-center font-medium bg-muted/20">
                          {tx.remainingStock}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{tx.staffName || 'System'}</div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[100px]">{tx.staffId}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground italic max-w-[200px] truncate" title={tx.notes || ''}>
                          {tx.notes || '—'}
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
    </div>
  )
}
