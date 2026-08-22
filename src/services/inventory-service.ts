import { db, auth } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import type { InventoryItem, InventoryTransaction } from '@/types'

/** True when PostgREST reports the RPC itself does not exist (migration not applied). */
function isMissingFunctionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true
  const msg = (error.message || '').toLowerCase()
  return msg.includes('could not find the function') || msg.includes('does not exist')
}

// ─── Service ──────────────────────────────────────────────────────────────────
export const inventoryService = {
  async getItems(): Promise<InventoryItem[]> {
    try {
      const rows = await db.inventory.list({ limit: 1000 })
      return (rows || []) as InventoryItem[]
    } catch (e) {
      console.warn('[inventoryService] getItems failed:', e)
      return []
    }
  },

  async addItem(data: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<InventoryItem> {
    const record: any = {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const created = await db.inventory.create(record)
    return created as InventoryItem
  },

  async updateItem(id: string, data: Partial<InventoryItem>): Promise<InventoryItem> {
    const record = {
      ...data,
      updatedAt: new Date().toISOString(),
    }
    const updated = await db.inventory.update(id, record)
    return updated as InventoryItem
  },

  async deleteItem(id: string): Promise<void> {
    await db.inventory.delete(id)
  },

  async logTransaction(data: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<InventoryTransaction> {
    const record: any = {
      ...data,
      createdAt: new Date().toISOString(),
    }
    const created = await db.inventoryTransactions.create(record)
    return created as InventoryTransaction
  },

  async getTransactions(inventoryId?: string): Promise<InventoryTransaction[]> {
    try {
      const rows = await db.inventoryTransactions.list({ limit: 2000, orderBy: { createdAt: 'desc' } })
      const transactions = (rows || []) as InventoryTransaction[]
      if (inventoryId) {
        return transactions.filter(t => t.inventoryId === inventoryId)
      }
      return transactions
    } catch (e) {
      console.warn('[inventoryService] getTransactions failed:', e)
      return []
    }
  },

  /**
   * Move stock and log the movement, as one atomic operation.
   *
   * Negative delta = sale/consumption, positive = restock. The arithmetic
   * happens inside Postgres (see supabase/migrations/20260822_atomic_inventory_stock.sql)
   * because doing it here — read, subtract, write — lost one of any two
   * concurrent movements: both read the same starting figure and the second
   * write overwrote the first.
   *
   * Falls back to the old client-side path only when the RPC is absent (the
   * migration has not been applied yet), so deploying this ahead of the
   * migration is safe.
   */
  async adjustStock(
    inventoryId: string,
    delta: number,
    type: 'sale' | 'restock' | 'adjustment',
    staffInfo: { id: string, name: string },
    notes: string = ''
  ): Promise<number> {
    if (!delta) return 0

    const { data, error } = await supabase.rpc('adjust_inventory_stock', {
      p_inventory_id: inventoryId,
      p_delta: delta,
      p_type: type,
      p_staff_id: staffInfo.id || null,
      p_staff_name: staffInfo.name || null,
      p_notes: notes,
    })

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data
      return Number(row?.remaining_stock ?? row?.remainingStock ?? 0)
    }

    if (!isMissingFunctionError(error)) throw new Error(error.message || 'Failed to adjust stock')

    console.warn('[inventoryService] adjust_inventory_stock RPC unavailable — falling back to non-atomic update. Apply supabase/migrations/20260822_atomic_inventory_stock.sql.')
    return this.adjustStockNonAtomic(inventoryId, delta, type, staffInfo, notes)
  },

  /** Pre-RPC path. Racy by nature — only used when the RPC is missing. */
  async adjustStockNonAtomic(
    inventoryId: string,
    delta: number,
    type: 'sale' | 'restock' | 'adjustment',
    staffInfo: { id: string, name: string },
    notes: string
  ): Promise<number> {
    const items = await this.getItems()
    const item = items.find(i => i.id === inventoryId)
    if (!item) throw new Error('Inventory item not found')

    const newStock = (item.stockQuantity || 0) + delta
    await this.updateItem(inventoryId, { stockQuantity: newStock })
    await this.logTransaction({
      inventoryId,
      type,
      quantity: delta,
      remainingStock: newStock,
      staffId: staffInfo.id,
      staffName: staffInfo.name,
      notes,
    })
    return newStock
  },

  /**
   * Reduce stock for an item.
   * This is a critical method for real-time accountability.
   */
  async reduceStock(inventoryId: string, quantity: number, staffInfo: { id: string, name: string }, notes: string = ''): Promise<void> {
    await this.adjustStock(inventoryId, -Math.abs(quantity), 'sale', staffInfo, notes)
  },

  async restockStock(inventoryId: string, quantity: number, staffInfo: { id: string, name: string }, notes: string = ''): Promise<void> {
    await this.adjustStock(inventoryId, Math.abs(quantity), 'restock', staffInfo, notes)
  }
}
