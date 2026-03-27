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
import { activityLogService } from '@/services/activity-log-service'
import { RefreshCw, Plus, Tag } from 'lucide-react'

export function SetPricesPage() {
  const db = (blink.db as any)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { currency } = useCurrency()

  // Default room types to seed if none exist
  const defaultRoomTypes = [
    { name: 'Standard Room', capacity: 2, basePrice: 100 },
    { name: 'Executive Suite', capacity: 2, basePrice: 250 },
    { name: 'Deluxe Room', capacity: 2, basePrice: 150 },
    { name: 'Family Room', capacity: 4, basePrice: 200 },
    { name: 'Presidential Suite', capacity: 5, basePrice: 500 }
  ]

  const loadRoomTypes = async () => {
    setLoading(true)
    try {
      const types = await db.roomTypes.list({ orderBy: { column: 'createdAt', ascending: true } })
      console.log('📊 [SetPrices] Loaded room types:', types.length)
      console.log('📊 [SetPrices] Room types data:', JSON.stringify(types, null, 2))
      if (types.length > 0) {
        console.log('📊 [SetPrices] First room type keys:', Object.keys(types[0]))
        console.log('📊 [SetPrices] First room type capacity:', types[0].capacity)
      }
      setRoomTypes(types || [])
    } catch (err) {
      console.error('Failed to load room types', err)
      toast.error('Failed to load room types')
      setRoomTypes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRoomTypes()
  }, [])

  const seedDefaultTypes = async () => {
    setSaving(true)
    try {
      toast.info('Creating room types...')
      console.log('🔧 [SetPrices] Starting to create default room types...')

      // Check which types already exist
      let existingTypes: RoomType[] = []
      try {
        existingTypes = await db.roomTypes.list() || []
        console.log('📊 [SetPrices] Existing room types:', existingTypes.length)
      } catch (listErr) {
        console.warn('⚠️ [SetPrices] Could not list existing room types:', listErr)
        // Continue anyway - table might not exist yet
      }

      const existingNames = new Set(existingTypes.map((t: RoomType) => t.name?.toLowerCase()))

      let created = 0
      let errors: string[] = []

      for (const type of defaultRoomTypes) {
        const existingType = existingTypes.find((t: RoomType) => t.name?.toLowerCase() === type.name.toLowerCase())

        if (!existingType) {
          // Create new room type
          try {
            console.log(`📝 [SetPrices] Creating room type: ${type.name}`)
            const result = await db.roomTypes.create({
              id: crypto.randomUUID(),
              name: type.name,
              capacity: type.capacity,
              basePrice: type.basePrice,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            })
            console.log(`✅ [SetPrices] Created: ${type.name}`, result)
            created++
          } catch (createErr: any) {
            console.error(`❌ [SetPrices] Failed to create ${type.name}:`, createErr)
            errors.push(`${type.name}: ${createErr?.message || 'Unknown error'}`)
          }
        } else if (!existingType.capacity) {
          // Update existing room type that's missing capacity
          try {
            console.log(`🔄 [SetPrices] Updating ${type.name} with capacity: ${type.capacity}`)
            await db.roomTypes.update(existingType.id, { capacity: type.capacity })
            console.log(`✅ [SetPrices] Updated: ${type.name}`)
            created++
          } catch (updateErr: any) {
            console.error(`❌ [SetPrices] Failed to update ${type.name}:`, updateErr)
            errors.push(`${type.name}: ${updateErr?.message || 'Unknown error'}`)
          }
        } else {
          console.log(`ℹ️ [SetPrices] Skipping ${type.name} - already exists with capacity`)
        }
      }

      if (created > 0) {
        toast.success(`Created ${created} room types`)
      } else if (errors.length > 0) {
        toast.error(`Failed to create room types: ${errors[0]}`)
        console.error('❌ [SetPrices] All errors:', errors)
      } else {
        toast.info('All room types already exist')
      }

      // Reload room types
      await loadRoomTypes()
    } catch (error: any) {
      console.error('❌ [SetPrices] Failed to seed room types:', error)
      toast.error(`Failed to create room types: ${error?.message || 'Check console for details'}`)
    } finally {
      setSaving(false)
    }
  }

  const dirtyCount = useMemo(() => Object.keys(edited).length, [edited])

  const handleChange = (id: string, value: string) => {
    setEdited((prev) => ({ ...prev, [id]: value }))
  }

  // Sync price update to all rooms that use this room type
  const syncPriceToRooms = async (roomTypeId: string, newPrice: number) => {
    try {
      // Find all rooms with this room type
      const rooms = await db.rooms.list({ where: { roomTypeId } })

      // Update each room's price
      for (const room of rooms) {
        await db.rooms.update(room.id, { price: newPrice })
      }

      // Also update properties that reference this room type
      const properties = await blink.db.properties.list({ where: { propertyTypeId: roomTypeId } })
      for (const prop of properties) {
        await blink.db.properties.update(prop.id, { basePrice: newPrice })
      }

      console.log(`✅ Synced price to ${rooms.length} rooms and ${properties.length} properties`)
    } catch (err) {
      console.warn('Failed to sync price to rooms:', err)
    }
  }

  const saveOne = async (id: string) => {
    const newValue = Number(edited[id])
    if (!isFinite(newValue) || newValue <= 0) {
      toast.error('Enter a valid price')
      return
    }
    setSaving(true)
    try {
      // Update room type
      await db.roomTypes.update(id, {
        basePrice: newValue,
        updatedAt: new Date().toISOString()
      })

      // Sync to all rooms using this type
      await syncPriceToRooms(id, newValue)

      // Optimistic UI update
      setRoomTypes((prev) => prev.map((rt) => (rt.id === id ? { ...rt, basePrice: newValue } as RoomType : rt)))
      setEdited((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      toast.success('Price updated globally')

      // Log price change
      try {
        const user = await blink.auth.me().catch(() => null)
        const roomType = roomTypes.find(rt => rt.id === id)
        await activityLogService.log({
          action: 'updated',
          entityType: 'room',
          entityId: id,
          details: {
            roomTypeName: roomType?.name || 'Unknown',
            oldPrice: roomType?.basePrice || 0,
            newPrice: newValue,
            priceChange: true,
            updatedAt: new Date().toISOString()
          },
          userId: user?.id || 'system'
        })
      } catch (logError) {
        console.error('Activity logging failed:', logError)
      }
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
      for (const [id, val] of Object.entries(edited)) {
        const price = Number(val)
        if (isFinite(price) && price > 0) {
          await db.roomTypes.update(id, {
            basePrice: price,
            updatedAt: new Date().toISOString()
          })
          await syncPriceToRooms(id, price)
        }
      }

      // Optimistic UI
      setRoomTypes((prev) => prev.map((rt) => (edited[rt.id] ? { ...rt, basePrice: Number(edited[rt.id]) } : rt)))
      setEdited({})
      toast.success('All prices updated globally')

      // Log bulk price update
      try {
        const user = await blink.auth.me().catch(() => null)
        const changes = Object.entries(edited).map(([id, val]) => {
          const rt = roomTypes.find(r => r.id === id)
          return `${rt?.name || 'Unknown'}: ${rt?.basePrice || 0} → ${val}`
        }).join(', ')
        await activityLogService.log({
          action: 'updated',
          entityType: 'room',
          entityId: 'bulk-price-update',
          details: {
            bulkUpdate: true,
            changes,
            count: dirtyCount,
            updatedAt: new Date().toISOString()
          },
          userId: user?.id || 'system'
        })
      } catch (logError) {
        console.error('Activity logging failed:', logError)
      }
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
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Tag className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Set Prices</h1>
          </div>
          <p className="text-sm text-muted-foreground">Manage base prices for each room type. These prices appear on the public Rooms page.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadRoomTypes} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={saveAll} disabled={saving || dirtyCount === 0}>
            {saving ? 'Saving…' : dirtyCount > 0 ? `Save all (${dirtyCount})` : 'Save all'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Room types</CardTitle>
          <CardDescription>Edit the base price per night</CardDescription>
        </CardHeader>
        <CardContent>
          {roomTypes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground mb-4">No room types found in the database.</p>
              <Button onClick={seedDefaultTypes} disabled={saving}>
                <Plus className="w-4 h-4 mr-2" />
                {saving ? 'Creating...' : 'Create Default Room Types'}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Type</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Capacity</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Current Price</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">New Price</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 w-32">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roomTypes.map((rt) => (
                  <TableRow key={rt.id}>
                    <TableCell className="font-medium">{rt.name}</TableCell>
                    <TableCell>{rt.capacity || '-'}</TableCell>
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default SetPricesPage

