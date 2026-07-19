/**
 * Standalone Sales Service
 * Tracks walk-in / non-booking sales (bar, restaurant, etc.)
 * Table: standaloneSales — created by SQL migration in supabase/migrations/.
 */

import { db, auth } from '@/lib/db'
import { format } from 'date-fns'
import { inventoryService } from './inventory-service'
import type { StandaloneSale } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export const SALE_CATEGORIES: Record<StandaloneSale['category'], string> = {
  food_beverage: 'Food & Beverage',
  room_service:  'Room Service',
  minibar:       'Minibar',
  other:         'Other',
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const standaloneSalesService = {
  async addSale(
    data: Omit<StandaloneSale, 'id' | 'createdAt'>
  ): Promise<StandaloneSale> {
    const record: StandaloneSale = {
      ...data,
      id: `sale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    }
    
    try {
      await db.standaloneSales.create(record)
      
      // If linked to inventory, reduce stock in real-time
      if (data.inventoryId) {
        await inventoryService.reduceStock(
          data.inventoryId, 
          data.quantity, 
          { id: data.staffId, name: data.staffName },
          `Linked to sale: ${data.description}`
        )
      }
    } catch (e) {
      console.warn('[standaloneSalesService] create failed (table may not exist yet):', e)
      // Retry once — wrapper occasionally races on first insert into a freshly cached table
      await db.standaloneSales.create(record)
      
      if (data.inventoryId) {
        await inventoryService.reduceStock(
          data.inventoryId, 
          data.quantity, 
          { id: data.staffId, name: data.staffName },
          `Linked to sale: ${data.description}`
        )
      }
    }
    return record
  },

  /** Fetch sales for a specific staff member within a date range (inclusive). */
  async getSalesForStaff(
    staffId: string,
    weekStart: string,
    weekEnd: string
  ): Promise<StandaloneSale[]> {
    try {
      const rows = await db.standaloneSales.list({ limit: 2000 })
      return ((rows || []) as StandaloneSale[]).filter((s) => {
        const sid = (s as any).staffId || (s as any).staff_id || ''
        const sd  = (s as any).saleDate || (s as any).sale_date || ''
        return sid === staffId && sd >= weekStart && sd <= weekEnd
      })
    } catch (e) {
      console.warn('[standaloneSalesService] getSalesForStaff failed (table may not exist yet):', e)
      return []
    }
  },

  /** Fetch ALL sales for a week (admin view). */
  async getAllSalesForWeek(
    weekStart: string,
    weekEnd: string
  ): Promise<StandaloneSale[]> {
    try {
      const rows = await db.standaloneSales.list({ limit: 2000 })
      return ((rows || []) as StandaloneSale[]).filter((s) => {
        const sd = (s as any).saleDate || (s as any).sale_date || ''
        return sd >= weekStart && sd <= weekEnd
      })
    } catch (e) {
      console.warn('[standaloneSalesService] getAllSalesForWeek failed:', e)
      return []
    }
  },

  /** Fetch ALL sales ever (for analytics). */
  async getAllSales(): Promise<StandaloneSale[]> {
    try {
      const rows = await db.standaloneSales.list({ limit: 5000 })
      return (rows || []) as StandaloneSale[]
    } catch (e) {
      console.warn('[standaloneSalesService] getAllSales failed:', e)
      return []
    }
  },

  async deleteSale(id: string): Promise<void> {
    try {
      const existingSale = await db.standaloneSales.get(id) as StandaloneSale | undefined
      if (existingSale && existingSale.inventoryId && existingSale.quantity) {
        try {
          const me = await auth.me().catch(() => null)
          const staffInfo = me ? { id: me.id, name: me.email?.split('@')[0] || 'Staff' } : { id: 'system', name: 'System' }
          await inventoryService.restockStock(
            existingSale.inventoryId,
            existingSale.quantity,
            staffInfo,
            `Reversed standalone sale: ${existingSale.description}`
          )
        } catch (invError) {
          console.error('[standaloneSalesService] Failed to restock stock during sale deletion:', invError)
        }
      }
    } catch (e) {
      console.warn('[standaloneSalesService] Failed to fetch sale for reversal:', e)
    }

    await db.standaloneSales.delete(id)
  },
}
