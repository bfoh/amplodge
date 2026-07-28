/**
 * Sync Queue — Offline Mutation Queue (self-healing)
 *
 * When the app can't reach Supabase, write operations (create, update, delete)
 * are queued in a dedicated PouchDB database. They are then replayed against
 * Supabase in chronological order.
 *
 * The bug this rewrite kills: previously the queue was drained ONLY at the
 * instant the app flipped offline→online, and an entry that failed MAX_RETRIES
 * times was marked terminally `'failed'` and never retried again — producing the
 * permanently stuck "1 failed" badge users saw. If the online transition never
 * fired (e.g. the connectivity detector was trapped offline) the queue never
 * drained at all.
 *
 * Design now:
 * - FIFO by timestamp; last-write-wins conflict resolution.
 * - A background auto-sync scheduler drains the queue on an interval whenever
 *   we're online — no dependence on catching the exact reconnect moment.
 * - Entries NEVER dead-end. A failing entry backs off with capped exponential
 *   delay and keeps retrying forever, so transient outages always self-heal.
 * - `failedCount` in the observable state means "has errored and is waiting on
 *   a backoff retry" (still auto-retrying) — never "given up".
 */

import { getNetworkOnline } from './network-status'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncOperation = 'create' | 'update' | 'delete'

export interface QueueEntry {
  _id: string
  _rev?: string
  table: string
  operation: SyncOperation
  recordId: string // The id of the record in the actual table
  payload: Record<string, any> // The data to create/update (empty for delete)
  timestamp: string // ISO string — ordering key
  retries: number
  lastError?: string
  // 'failed' is retained in the union for backward-compat with old queued docs
  // written before this rewrite, but the new code never assigns it — entries
  // stay 'pending' and keep retrying. 'processing' is transient during a drain.
  status: 'pending' | 'processing' | 'failed'
  nextRetryAt?: string
}

export type SyncStatus = 'idle' | 'syncing' | 'error'

export interface SyncState {
  status: SyncStatus
  pendingCount: number
  failedCount: number
  lastSyncedAt: string | null
  currentMessage?: string
}

type SyncListener = (state: SyncState) => void
type SyncExecutor = (entry: QueueEntry) => Promise<void>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUEUE_DB_NAME = 'amplodge_sync_queue'
const RETRY_DELAY_BASE_MS = 2000 // Exponential backoff base: 2s, 4s, 8s, …
const MAX_BACKOFF_MS = 5 * 60 * 1000 // …capped at 5 min so it keeps trying, slowly
const AUTO_SYNC_INTERVAL_MS = 15_000 // Background drain cadence while online
const LAST_SYNC_KEY = 'offline_sync_last_completed'

// ---------------------------------------------------------------------------
// Singleton queue
// ---------------------------------------------------------------------------

// PouchDB is imported lazily so the queue's storage engine stays out of the
// startup bundle (the global `PouchDB` type namespace comes from @types/pouchdb).
let queueDBPromise: Promise<PouchDB.Database> | null = null

function getQueueDB(): Promise<PouchDB.Database> {
  if (!queueDBPromise) {
    queueDBPromise = import('pouchdb-browser').then(
      (pouch) => new pouch.default(QUEUE_DB_NAME, { auto_compaction: true })
    )
  }
  return queueDBPromise
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

let currentState: SyncState = {
  status: 'idle',
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
}

const listeners: Set<SyncListener> = new Set()

function notifyListeners() {
  listeners.forEach(fn => fn({ ...currentState }))
}

function allEntries(rows: PouchDB.Core.AllDocsResponse<{}>['rows']): QueueEntry[] {
  return rows
    .filter(r => r.doc && !r.id.startsWith('_design/'))
    .map(r => r.doc as unknown as QueueEntry)
}

async function refreshCounts() {
  const db = await getQueueDB()
  try {
    const all = await db.allDocs({ include_docs: true })
    const docs = allEntries(all.rows)
    // failedCount = has errored and is waiting on a retry (still auto-retrying).
    // pendingCount = fresh, not-yet-attempted (or in-flight first attempt).
    currentState.failedCount = docs.filter(d => d.retries > 0).length
    currentState.pendingCount = docs.filter(d => d.retries === 0).length
  } catch {
    // DB not ready yet
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Subscribe to sync state changes. Returns an unsubscribe function.
 */
export function onSyncStateChange(listener: SyncListener): () => void {
  listeners.add(listener)
  // Immediately emit current state
  listener({ ...currentState })
  return () => listeners.delete(listener)
}

/**
 * Get the current sync state (snapshot).
 */
export function getSyncState(): SyncState {
  return { ...currentState }
}

/**
 * Add a mutation to the sync queue.
 */
export async function enqueue(
  table: string,
  operation: SyncOperation,
  recordId: string,
  payload: Record<string, any> = {}
): Promise<void> {
  const db = await getQueueDB()
  const entry: QueueEntry = {
    _id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    table,
    operation,
    recordId,
    payload,
    timestamp: new Date().toISOString(),
    retries: 0,
    status: 'pending',
  }

  await db.put(entry)
  await refreshCounts()
  notifyListeners()
  console.log(`[SyncQueue] ➕ Queued ${operation} on ${table}/${recordId}`)

  // If we happen to be online, flush right away rather than waiting for the
  // next background tick — keeps latency low for brief-connectivity writes.
  if (getNetworkOnline()) triggerSync()
}

/**
 * Get all entries that are due to sync now (oldest first). Includes entries
 * left mid-flight ('processing') by a previous crashed drain so they recover.
 */
export async function getPendingEntries(): Promise<QueueEntry[]> {
  const db = await getQueueDB()
  const all = await db.allDocs({ include_docs: true })
  const now = Date.now()

  return allEntries(all.rows)
    .filter(e => {
      if (e.nextRetryAt && new Date(e.nextRetryAt).getTime() > now) return false
      return true
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/**
 * Get entries that have errored at least once and are awaiting a retry.
 * (Still auto-retrying — this is not a terminal state.)
 */
export async function getFailedEntries(): Promise<QueueEntry[]> {
  const db = await getQueueDB()
  const all = await db.allDocs({ include_docs: true })
  return allEntries(all.rows)
    .filter(e => e.retries > 0)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/** Backoff for the Nth retry, capped so entries keep trying indefinitely. */
function backoffFor(retries: number): number {
  const raw = RETRY_DELAY_BASE_MS * Math.pow(2, Math.max(retries - 1, 0))
  return Math.min(raw, MAX_BACKOFF_MS)
}

/**
 * Process the sync queue: replay every due entry against Supabase.
 *
 * @param executor A function that performs the Supabase operation for an entry.
 *                 It should throw on failure.
 */
export async function processQueue(
  executor: SyncExecutor
): Promise<{ processed: number; failed: number }> {
  const entries = await getPendingEntries()

  if (entries.length === 0) {
    return { processed: 0, failed: 0 }
  }

  currentState.status = 'syncing'
  currentState.currentMessage = `Syncing ${entries.length} change${entries.length === 1 ? '' : 's'}...`
  notifyListeners()

  const db = await getQueueDB()
  let processed = 0
  let failed = 0

  for (const entry of entries) {
    // Mark as processing (persist with the freshest _rev to avoid conflicts).
    try {
      const current = await db.get(entry._id)
      await db.put({ ...entry, _rev: (current as any)._rev, status: 'processing' })
    } catch {
      // Entry vanished (already synced/removed elsewhere) — skip it.
      continue
    }

    try {
      await executor(entry)

      // Success — remove from queue.
      const latest = await db.get(entry._id)
      await db.remove(latest)
      processed++

      currentState.currentMessage = `Synced ${processed}/${entries.length}...`
      await refreshCounts()
      notifyListeners()
    } catch (err: any) {
      // Failure — bump retries and back off. NEVER dead-end: the entry stays
      // 'pending' and will be retried on a later drain once its backoff elapses.
      entry.retries++
      entry.lastError = err?.message || String(err)
      const backoffMs = backoffFor(entry.retries)
      entry.status = 'pending'
      entry.nextRetryAt = new Date(Date.now() + backoffMs).toISOString()
      failed++

      console.warn(
        `[SyncQueue] ⚠️ ${entry.operation} on ${entry.table}/${entry.recordId} failed (attempt ${entry.retries}); retrying in ${Math.round(backoffMs / 1000)}s`,
        err
      )

      try {
        const latest = await db.get(entry._id)
        await db.put({ ...entry, _rev: (latest as any)._rev })
      } catch { /* entry gone — ignore */ }
      await refreshCounts()
      notifyListeners()
    }
  }

  // Update final state.
  const now = new Date().toISOString()
  await refreshCounts()
  currentState.status = currentState.failedCount > 0 ? 'error' : 'idle'
  currentState.lastSyncedAt = now
  currentState.currentMessage = undefined
  try {
    localStorage.setItem(LAST_SYNC_KEY, now)
  } catch { /* ignore */ }

  notifyListeners()

  console.log(`[SyncQueue] ✅ Processed ${processed}, deferred ${failed} for retry`)
  return { processed, failed }
}

// ---------------------------------------------------------------------------
// Auto-sync scheduler
// ---------------------------------------------------------------------------
// Drains the queue on a background interval whenever we're online, so nothing
// depends on catching the exact offline→online moment. A single drain runs at a
// time (isDraining lock) so overlapping triggers can't double-process.

let registeredExecutor: SyncExecutor | null = null
let autoSyncTimer: ReturnType<typeof setInterval> | null = null
let isDraining = false

/**
 * Run a drain now if we're online, not already draining, and an executor is
 * registered. Safe to call as often as you like — it self-throttles.
 */
export async function triggerSync(): Promise<void> {
  if (isDraining || !registeredExecutor || !getNetworkOnline()) return

  // Cheap early-out: nothing due → don't churn.
  const due = await getPendingEntries()
  if (due.length === 0) return

  isDraining = true
  try {
    await processQueue(registeredExecutor)
  } catch (err) {
    console.warn('[SyncQueue] drain error:', err)
  } finally {
    isDraining = false
  }
}

/**
 * Register the executor and start the background auto-sync loop. Idempotent —
 * calling again just updates the executor.
 */
export function startAutoSync(executor: SyncExecutor): void {
  registeredExecutor = executor
  if (autoSyncTimer) return

  autoSyncTimer = setInterval(() => {
    triggerSync().catch(() => {})
  }, AUTO_SYNC_INTERVAL_MS)

  // Kick an immediate attempt so a page load with a backlog flushes promptly.
  triggerSync().catch(() => {})
}

/**
 * Retry errored entries immediately (used by the "Retry failed" button):
 * clears their backoff and attempt count, then triggers a drain.
 */
export async function retryFailed(): Promise<number> {
  const entries = await getFailedEntries()
  const db = await getQueueDB()
  let reset = 0

  for (const entry of entries) {
    try {
      const latest = await db.get(entry._id)
      await db.put({
        ...entry,
        _rev: (latest as any)._rev,
        status: 'pending',
        retries: 0,
        lastError: undefined,
        nextRetryAt: undefined,
      })
      reset++
    } catch { /* entry gone — ignore */ }
  }

  await refreshCounts()
  notifyListeners()
  triggerSync().catch(() => {})
  return reset
}

/**
 * Clear all entries from the sync queue.
 */
export async function clearQueue(): Promise<void> {
  const db = await getQueueDB()
  const all = await db.allDocs({ include_docs: true })
  const toDelete = allEntries(all.rows).map(d => ({ ...d, _deleted: true }) as any)

  if (toDelete.length > 0) {
    await db.bulkDocs(toDelete)
  }

  currentState = {
    status: 'idle',
    pendingCount: 0,
    failedCount: 0,
    lastSyncedAt: currentState.lastSyncedAt,
  }
  notifyListeners()
  console.log('[SyncQueue] 🗑️ Queue cleared')
}

/**
 * Get the last sync completion time from localStorage.
 */
export function getLastSyncCompletedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY)
  } catch {
    return null
  }
}

// Counts initialize on first use (startAutoSync / enqueue). Deliberately not
// run at module load — that would pull PouchDB into every visitor's startup.
