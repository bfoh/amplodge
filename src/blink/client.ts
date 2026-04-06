/**
 * Blink Client — Powered by Supabase with Offline Support
 *
 * This module re-exports the Supabase wrapper which provides
 * a Blink-compatible API with offline caching and sync queue.
 */

export { blink, db, auth } from '../lib/supabase-wrapper'

// For backwards compatibility with code using blinkManaged
export { blink as blinkManaged } from '../lib/supabase-wrapper'

// Re-export real offline utilities (replaces stubs)
export { getNetworkOnline as isOnline } from '../lib/network-status'
export {
  enqueue,
  processQueue,
  clearQueue,
  getPendingEntries as getAll,
  getSyncState,
  onSyncStateChange,
} from '../lib/sync-queue'

// Legacy-compatible syncQueue object
import * as sq from '../lib/sync-queue'
export const syncQueue = {
  add: sq.enqueue,
  process: sq.processQueue,
  clear: sq.clearQueue,
  getAll: sq.getPendingEntries,
}
