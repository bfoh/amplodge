import { db, auth } from '@/lib/db'

export interface InventoryItem {
  id: string
  name: string
  category: string
  stockQuantity: number
  minThreshold: number
  unitPrice: number
  createdAt: string
  updatedAt: string
}

export interface InventoryTransaction {
  id: string
  inventoryId: string
  type: 'sale' | 'restock' | 'adjustment'
  quantity: number
  remainingStock: number
  staffId?: string
  staffName?: string
  notes?: string
  createdAt: string
}

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
      const rows = await db.inventoryTransactions.list({ limit: 2000, order: { createdAt: 'desc' } })
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
   * Reduce stock for an item. 
   * This is a critical method for real-time accountability.
   */
  async reduceStock(inventoryId: string, quantity: number, staffInfo: { id: string, name: string }, notes: string = ''): Promise<void> {
    const items = await this.getItems()
    const item = items.find(i => i.id === inventoryId)
    if (!item) throw new Error('Inventory item not found')

    const newStock = (item.stockQuantity || 0) - quantity

    // Update item stock
    await this.updateItem(inventoryId, { stockQuantity: newStock })

    // Log transaction
    await this.logTransaction({
      inventoryId,
      type: 'sale',
      quantity: -quantity,
      remainingStock: newStock,
      staffId: staffInfo.id,
      staffName: staffInfo.name,
      notes
    })
  },

  async restockStock(inventoryId: string, quantity: number, staffInfo: { id: string, name: string }, notes: string = ''): Promise<void> {
    const items = await this.getItems()
    const item = items.find(i => i.id === inventoryId)
    if (!item) throw new Error('Inventory item not found')

    const newStock = (item.stockQuantity || 0) + quantity

    // Update item stock
    await this.updateItem(inventoryId, { stockQuantity: newStock })

    // Log transaction
    await this.logTransaction({
      inventoryId,
      type: 'restock',
      quantity,
      remainingStock: newStock,
      staffId: staffInfo.id,
      staffName: staffInfo.name,
      notes
    })
  }
}
