import { useEffect, useMemo, useState } from 'react'
import { blink } from '@/blink/client'
import type { RoomType } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatCurrencySync, getCurrencySymbol } from '@/lib/utils'
import { toast } from 'sonner'
import { useCurrency } from '@/hooks/use-currency'

export function SetPricesPage() {
  const db = (blink.db as any)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { currency } = useCurrency()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const types = await db.roomTypes.list<RoomType>({ orderBy: { createdAt: 'asc' } })
        setRoomTypes(types)
      } catch (err) {
        console.error('Failed to load room types', err)
        toast.error('Failed to load room types')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const dirtyCount = useMemo(() => Object.keys(edited).length, [edited])

  const handleChange = (id: string, value: string) => {
    setEdited((prev) => ({ ...prev, [id]: value }))
  }

  const saveOne = async (id: string) => {
    const newValue = Number(edited[id])
    if (!isFinite(newValue) || newValue <= 0) {
      toast.error('Enter a valid price')
      return
    }
    setSaving(true)
    try {
      // Optimistic UI
      setRoomTypes((prev) => prev.map((rt) => (rt.id === id ? { ...rt, basePrice: newValue } as RoomType : rt)))
      await db.roomTypes.update(id, { basePrice: newValue })
      setEdited((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      toast.success('Price updated')
    } catch (err) {
      console.error('Update failed', err)
      toast.error('Failed to update price')
    } finally {
      setSaving(false)
    }
  }

  const saveAll = async () => {
    if (dirtyCount === 0) return
    setSaving(true)
    try {
      const ops = Object.entries(edited).map(async ([id, val]) => {
        const price = Number(val)
        if (isFinite(price) && price > 0) {
          await db.roomTypes.update(id, { basePrice: price })
        }
      })
      // Optimistic
      setRoomTypes((prev) => prev.map((rt) => (edited[rt.id] ? { ...rt, basePrice: Number(edited[rt.id]) } : rt)))
      await Promise.all(ops)
      setEdited({})
      toast.success('All changes saved')
    } catch (err) {
      console.error('Bulk save failed', err)
      toast.error('Failed to save all changes')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Loading room types...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Set prices</h2>
          <p className="text-sm text-muted-foreground">Manage base prices for each room type. These prices appear on the public Rooms page.</p>
        </div>
        <Button onClick={saveAll} disabled={saving || dirtyCount === 0}>
          {saving ? 'Saving…' : dirtyCount > 0 ? `Save all (${dirtyCount})` : 'Save all'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Room types</CardTitle>
          <CardDescription>Edit the base price per night</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Capacity</TableHead>
                <TableHead>Current price</TableHead>
                <TableHead>New price</TableHead>
                <TableHead className="w-32">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roomTypes.map((rt) => (
                <TableRow key={rt.id}>
                  <TableCell className="font-medium">{rt.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{rt.capacity}</TableCell>
                  <TableCell>{formatCurrencySync(rt.basePrice, currency)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{getCurrencySymbol(currency)}</span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="decimal"
                        className="w-40"
                        value={edited[rt.id] ?? String(rt.basePrice ?? '')}
                        onChange={(e) => handleChange(rt.id, e.target.value)}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => saveOne(rt.id)} disabled={saving}>
                      Save
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default SetPricesPage
