/**
 * Offline Cache Layer
 *
 * PouchDB-powered local cache that mirrors critical Supabase tables into
 * IndexedDB for offline access. Reads come from cache first; writes go
 * to both cache and (when online) Supabase.
 *
 * Key design decisions:
 * - One PouchDB instance per table (keeps indexes small and focused)
 * - Documents stored in snake_case to match Supabase columns exactly
 * - camelCase conversion happens at the supabase-wrapper level, not here
 * - Warm-up downloads all rows on first visit; subsequent refreshes are
 *   incremental via updated_at / created_at timestamps
 */

import PouchDB from 'pouchdb-browser'
import PouchDBFind from 'pouchdb-find'

PouchDB.plugin(PouchDBFind)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Tables that will be cached locally for offline access */
export const CACHED_TABLES = [
  'bookings',
  'rooms',
  'room_types',
  'guests',
  'properties',
  'hotel_settings',
  'invoices',
  'staff',
  'housekeeping_tasks',
  'hr_attendance',
  'standalone_sales',
  'booking_charges',
  'notifications',
  'reviews',
] as const

export type CachedTable = (typeof CACHED_TABLES)[number]

/** Metadata key used in localStorage to track per-table sync timestamps */
const SYNC_META_KEY = 'offline_cache_sync_meta'

// ---------------------------------------------------------------------------
// PouchDB instance management
// ---------------------------------------------------------------------------

const dbInstances = new Map<string, PouchDB.Database>()

function getDB(tableName: string): PouchDB.Database {
  if (!dbInstances.has(tableName)) {
    const db = new PouchDB(`amplodge_${tableName}`, { auto_compaction: true })
    dbInstances.set(tableName, db)
  }
  return dbInstances.get(tableName)!
}

// ---------------------------------------------------------------------------
// Sync metadata helpers
// ---------------------------------------------------------------------------

interface SyncMeta {
  [tableName: string]: {
    lastSyncedAt: string // ISO timestamp of last successful sync
    rowCount: number
  }
}

function getSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setSyncMeta(tableName: string, lastSyncedAt: string, rowCount: number) {
  const meta = getSyncMeta()
  meta[tableName] = { lastSyncedAt, rowCount }
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
  } catch (e) {
    console.warn('[OfflineCache] Failed to persist sync meta:', e)
  }
}

/**
 * Returns true if the given table has been synced at least once.
 */
export function isTableCached(tableName: string): boolean {
  const meta = getSyncMeta()
  return !!meta[tableName]?.lastSyncedAt
}

/**
 * Returns the ISO timestamp of the last sync for a table, or null.
 */
export function getLastSyncTime(tableName: string): string | null {
  return getSyncMeta()[tableName]?.lastSyncedAt ?? null
}

// ---------------------------------------------------------------------------
// Core cache operations
// ---------------------------------------------------------------------------

/**
 * Populate the local cache for a table from a full Supabase fetch.
 * Existing local docs that are no longer in the remote set are removed.
 *
 * @param tableName  The Supabase table name (snake_case)
 * @param rows       Array of row objects from Supabase (snake_case keys)
 */
export async function warmTable(tableName: string, rows: Record<string, any>[]): Promise<void> {
  const db = getDB(tableName)
  const startTime = Date.now()

  try {
    // Fetch all existing local docs
    const existing = await db.allDocs({ include_docs: false })
    const localRevs = new Map(existing.rows.map(r => [r.id, r.value.rev]))
    const remoteIds = new Set<string>()

    // Upsert all remote rows
    const bulkDocs: any[] = []
    for (const row of rows) {
      const docId = String(row.id)
      remoteIds.add(docId)

      const existingRev = localRevs.get(docId)

      bulkDocs.push({
        ...row,
        _id: docId,
        ...(existingRev ? { _rev: existingRev } : {}),
      })
    }

    // Remove local docs not in remote set (deleted on server)
    for (const r of existing.rows) {
      const localId = r.id
      if (!remoteIds.has(localId) && !localId.startsWith('_design/')) {
        bulkDocs.push({ _id: localId, _rev: r.value.rev, _deleted: true })
      }
    }

    if (bulkDocs.length > 0) {
      const result = await db.bulkDocs(bulkDocs)
      const errors = result.filter((r: any) => r.error)
      if (errors.length > 0) {
        console.warn(`[OfflineCache] ${tableName}: ${errors.length} bulk write errors`, errors.slice(0, 3))
      }
    }

    setSyncMeta(tableName, new Date().toISOString(), rows.length)
    console.log(
      `[OfflineCache] ✅ Warmed ${tableName}: ${rows.length} rows in ${Date.now() - startTime}ms`
    )
  } catch (err) {
    console.error(`[OfflineCache] ❌ Failed to warm ${tableName}:`, err)
    throw err
  }
}

/**
 * Read all documents from a cached table.
 * Returns snake_case objects (matching Supabase column names).
 */
export async function readAll(tableName: string): Promise<Record<string, any>[]> {
  const db = getDB(tableName)
  try {
    const result = await db.allDocs({ include_docs: true })
    return result.rows
      .filter(r => !r.id.startsWith('_design/') && !(r.doc as any)?._deleted)
      .map(r => {
        const doc = { ...r.doc } as any
        delete doc._id
        delete doc._rev
        // Restore id from _id
        doc.id = r.id
        return doc
      })
  } catch (err) {
    console.error(`[OfflineCache] ❌ Failed to read all from ${tableName}:`, err)
    return []
  }
}

/**
 * Read a single document by id from the cache.
 */
export async function readOne(tableName: string, id: string): Promise<Record<string, any> | null> {
  const db = getDB(tableName)
  try {
    const doc = await db.get(String(id))
    const result = { ...doc } as any
    delete result._rev
    result.id = result._id
    delete result._id
    return result
  } catch (err: any) {
    if (err.status === 404) return null
    console.error(`[OfflineCache] ❌ Failed to read ${tableName}/${id}:`, err)
    return null
  }
}

/**
 * Write a single document to the cache (create or update).
 * This is used for write-through caching after a Supabase mutation.
 */
export async function writeOne(tableName: string, doc: Record<string, any>): Promise<void> {
  const db = getDB(tableName)
  const docId = String(doc.id)

  try {
    // Try to get existing doc for _rev
    let existingRev: string | undefined
    try {
      const existing = await db.get(docId)
      existingRev = existing._rev
    } catch {
      // new document
    }

    await db.put({
      ...doc,
      _id: docId,
      ...(existingRev ? { _rev: existingRev } : {}),
    })
  } catch (err) {
    console.error(`[OfflineCache] ❌ Failed to write ${tableName}/${docId}:`, err)
    throw err
  }
}

/**
 * Delete a single document from the cache.
 */
export async function deleteOne(tableName: string, id: string): Promise<void> {
  const db = getDB(tableName)
  try {
    const doc = await db.get(String(id))
    await db.remove(doc)
  } catch (err: any) {
    if (err.status === 404) return // already gone
    console.error(`[OfflineCache] ❌ Failed to delete ${tableName}/${id}:`, err)
  }
}

/**
 * Count the number of documents in a cached table.
 */
export async function countDocs(tableName: string): Promise<number> {
  const db = getDB(tableName)
  try {
    const info = await db.info()
    return info.doc_count
  } catch {
    return 0
  }
}

/**
 * Destroy the PouchDB for a specific table (full reset).
 */
export async function destroyTable(tableName: string): Promise<void> {
  const db = getDB(tableName)
  try {
    await db.destroy()
    dbInstances.delete(tableName)
    const meta = getSyncMeta()
    delete meta[tableName]
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
    console.log(`[OfflineCache] 🗑️ Destroyed cache for ${tableName}`)
  } catch (err) {
    console.error(`[OfflineCache] ❌ Failed to destroy ${tableName}:`, err)
  }
}

/**
 * Destroy all cached tables (full offline data reset).
 */
export async function destroyAll(): Promise<void> {
  for (const table of CACHED_TABLES) {
    await destroyTable(table)
  }
  localStorage.removeItem(SYNC_META_KEY)
  console.log('[OfflineCache] 🗑️ All caches destroyed')
}

/**
 * Get a summary of all cached tables and their status.
 */
export async function getCacheStatus(): Promise<
  { table: string; synced: boolean; lastSync: string | null; count: number }[]
> {
  const results = []
  for (const table of CACHED_TABLES) {
    const count = await countDocs(table)
    results.push({
      table,
      synced: isTableCached(table),
      lastSync: getLastSyncTime(table),
      count,
    })
  }
  return results
}
