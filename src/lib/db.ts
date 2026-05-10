/**
 * Data-layer entrypoint.
 *
 * `db`   — table-CRUD wrapper (Supabase + PouchDB SWR cache + sync queue).
 * `auth` — Supabase Auth surface (signInWithEmail, signUp, me, logout, onAuthStateChanged).
 *
 * Both come from src/lib/supabase-wrapper.ts. Phase 2 may rewrite that file;
 * consumers stay on this stable surface.
 */

export { db, auth, onTableUpdated } from './supabase-wrapper'

// Network status
export { getNetworkOnline as isOnline } from './network-status'

// Offline sync queue — named exports
export {
  enqueue,
  processQueue,
  clearQueue,
  getPendingEntries as getAll,
  getSyncState,
  onSyncStateChange,
} from './sync-queue'

// Legacy-compatible `syncQueue` object — preserved because a handful of call
// sites use `syncQueue.add(...)` style. Keep until Phase 2 migrates them.
import * as sq from './sync-queue'
export const syncQueue = {
  add: sq.enqueue,
  process: sq.processQueue,
  clear: sq.clearQueue,
  getAll: sq.getPendingEntries,
}
