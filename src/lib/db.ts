/**
 * Data-layer entrypoint.
 *
 * `db`   — table-CRUD wrapper (Supabase + PouchDB SWR cache + sync queue).
 * `auth` — Supabase Auth surface (signInWithEmail, signUp, me, logout, onAuthStateChanged).
 *
 * Both come from src/lib/supabase-wrapper.ts. Phase 2 may rewrite that file;
 * consumers stay on this stable surface.
 *
 * NOTE: `db` is intentionally typed as `any`. The pre-refactor codebase
 * silenced the wrapper's loose types with per-call-site `(db as any)`
 * casts (~80 sites). Centralising the cast here preserves identical
 * strictness behavior. Phase 2 introduces typed table accessors and removes
 * this `any`.
 */

import {
  db as _db,
  auth as _auth,
  onTableUpdated as _onTableUpdated,
} from './supabase-wrapper'

export const db: any = _db
export const auth = _auth
export const onTableUpdated = _onTableUpdated

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
