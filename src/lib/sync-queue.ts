/**
 * Sync Queue — Offline Mutation Queue
 *
 * When the app is offline, write operations (create, update, delete) are queued
 * in a dedicated PouchDB database. When connectivity is restored, the queue is
 * replayed in chronological order against Supabase.
 *
 * Design:
 * - Queue entries are ordered by timestamp (FIFO)
 * - Each entry records: table, operation, payload, id, and retry count
 * - Failed entries are retried up to MAX_RETRIES times before being flagged
 * - Conflict resolution: last-write-wins (offline change overwrites server)
 * - Status observable pattern for UI indicators
 */

import PouchDB from 'pouchdb-browser'

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUEUE_DB_NAME = 'amplodge_sync_queue'
const MAX_RETRIES = 5
const RETRY_DELAY_BASE_MS = 2000 // Exponential backoff: 2s, 4s, 8s, 16s, 32s
const LAST_SYNC_KEY = 'offline_sync_last_completed'

// ---------------------------------------------------------------------------
// Singleton queue
// ---------------------------------------------------------------------------

let queueDB: PouchDB.Database | null = null

function getQueueDB(): PouchDB.Database {
  if (!queueDB) {
    queueDB = new PouchDB(QUEUE_DB_NAME, { auto_compaction: true })
  }
  return queueDB
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

async function refreshCounts() {
  const db = getQueueDB()
  try {
    const all = await db.allDocs({ include_docs: true })
    const docs = all.rows
      .filter(r => r.doc && !r.id.startsWith('_design/'))
      .map(r => r.doc as unknown as QueueEntry)

    currentState.pendingCount = docs.filter(d => d.status === 'pending' || d.status === 'processing').length
    currentState.failedCount = docs.filter(d => d.status === 'failed').length
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
  const db = getQueueDB()
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
}

/**
 * Get all pending queue entries (oldest first).
 */
export async function getPendingEntries(): Promise<QueueEntry[]> {
  const db = getQueueDB()
  const all = await db.allDocs({ include_docs: true })
  const now = Date.now()
  
  return all.rows
    .filter(r => r.doc && !r.id.startsWith('_design/'))
    .map(r => r.doc as unknown as QueueEntry)
    .filter(e => {
      if (e.status !== 'pending') return false
      if (e.nextRetryAt && new Date(e.nextRetryAt).getTime() > now) return false
      return true
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/**
 * Get all failed queue entries.
 */
export async function getFailedEntries(): Promise<QueueEntry[]> {
  const db = getQueueDB()
  const all = await db.allDocs({ include_docs: true })
  return all.rows
    .filter(r => r.doc && !r.id.startsWith('_design/'))
    .map(r => r.doc as unknown as QueueEntry)
    .filter(e => e.status === 'failed')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/**
 * Process the sync queue. Called when connectivity is restored.
 *
 * @param executor A function that actually performs the Supabase operation.
 *                 It receives the queue entry and should throw on failure.
 */
export async function processQueue(
  executor: (entry: QueueEntry) => Promise<void>
): Promise<{ processed: number; failed: number }> {
  const entries = await getPendingEntries()

  if (entries.length === 0) {
    return { processed: 0, failed: 0 }
  }

  currentState.status = 'syncing'
  currentState.currentMessage = `Syncing ${entries.length} changes...`
  notifyListeners()

  const db = getQueueDB()
  let processed = 0
  let failed = 0

  for (const entry of entries) {
    // Mark as processing
    entry.status = 'processing'
    await db.put({ ...entry })

    try {
      await executor(entry)

      // Success — remove from queue
      const latest = await db.get(entry._id)
      await db.remove(latest)
      processed++

      currentState.currentMessage = `Synced ${processed}/${entries.length}...`
      await refreshCounts()
      notifyListeners()
    } catch (err: any) {
      entry.retries++
      entry.lastError = err?.message || String(err)

      if (entry.retries >= MAX_RETRIES) {
        entry.status = 'failed'
        failed++
        console.error(
          `[SyncQueue] ❌ Permanently failed ${entry.operation} on ${entry.table}/${entry.recordId}:`,
          err
        )
      } else {
        // Backoff delay before next retry
        const backoffMs = RETRY_DELAY_BASE_MS * Math.pow(2, entry.retries - 1)
        entry.status = 'pending'
        entry.nextRetryAt = new Date(Date.now() + backoffMs).toISOString()
        
        console.warn(
          `[SyncQueue] ⚠️ Retry ${entry.retries}/${MAX_RETRIES} scheduled for ${entry.operation} on ${entry.table}/${entry.recordId} in ${backoffMs}ms`
        )
      }

      // Update the entry in the queue
      const latest = await db.get(entry._id)
      await db.put({ ...entry, _rev: (latest as any)._rev })
      await refreshCounts()
      notifyListeners()
    }
  }

  // Update final state
  const now = new Date().toISOString()
  currentState.status = failed > 0 ? 'error' : 'idle'
  currentState.lastSyncedAt = now
  currentState.currentMessage = undefined
  try {
    localStorage.setItem(LAST_SYNC_KEY, now)
  } catch { /* ignore */ }

  await refreshCounts()
  notifyListeners()

  console.log(`[SyncQueue] ✅ Processed ${processed}, failed ${failed}`)
  return { processed, failed }
}

/**
 * Retry all failed entries (resets their status to pending).
 */
export async function retryFailed(): Promise<number> {
  const entries = await getFailedEntries()
  const db = getQueueDB()
  let reset = 0

  for (const entry of entries) {
    const latest = await db.get(entry._id)
    await db.put({
      ...entry,
      _rev: (latest as any)._rev,
      status: 'pending',
      retries: 0,
      lastError: undefined,
    })
    reset++
  }

  await refreshCounts()
  notifyListeners()
  return reset
}

/**
 * Clear all entries from the sync queue (both pending and failed).
 */
export async function clearQueue(): Promise<void> {
  const db = getQueueDB()
  const all = await db.allDocs({ include_docs: true })
  const toDelete = all.rows
    .filter(r => r.doc && !r.id.startsWith('_design/'))
    .map(r => ({ ...r.doc, _deleted: true }) as any)

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

// Initialize counts on module load
refreshCounts().catch(() => {})
