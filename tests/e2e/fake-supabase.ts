/**
 * Stand-in for src/lib/supabase: the inventory RPC.
 *
 * The arithmetic runs in one synchronous block with no await between the read
 * and the write, mirroring what the row lock guarantees in Postgres. Awaiting
 * mid-way would model the very lost update the RPC exists to prevent.
 */
import { __store, db } from './fake-db'

export const supabase = {
  async rpc(fn: string, params: any) {
    if (fn !== 'adjust_inventory_stock') {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    }
    const rows = __store['inventory'] || []
    const item = rows.find((r: any) => r.id === params.p_inventory_id)
    if (!item) return { data: null, error: { code: 'P0002', message: 'inventory item not found' } }
    if (!params.p_delta) return { data: null, error: { code: '22023', message: 'delta must be non-zero' } }

    item.stockQuantity = Number(item.stockQuantity || 0) + params.p_delta
    item.updatedAt = new Date().toISOString()
    const remaining = item.stockQuantity

    await db.inventoryTransactions.create({
      inventoryId: params.p_inventory_id, type: params.p_type, quantity: params.p_delta,
      remainingStock: remaining, staffId: params.p_staff_id, staffName: params.p_staff_name, notes: params.p_notes,
    })
    return { data: [{ remaining_stock: remaining, transaction_id: 'tx' }], error: null }
  },
  from() { return { select: () => ({ data: [], error: null }) } },
  channel() { return { on() { return this }, subscribe() { return this } } },
  removeChannel() {},
}
