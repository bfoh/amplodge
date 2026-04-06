/**
 * Supabase Database Wrapper — with Offline Support
 *
 * This module provides a Blink-compatible API using Supabase as the backend,
 * augmented with PouchDB-based offline caching and a sync queue.
 *
 * Read flow:
 *   1. Read from PouchDB cache (instant)
 *   2. If online, also fetch from Supabase in the background and update cache
 *   3. Returns cache data immediately for fast UI
 *
 * Write flow:
 *   1. Write to PouchDB cache (optimistic, instant)
 *   2. If online, write to Supabase and update cache with server response
 *   3. If offline, enqueue the mutation in the sync queue
 */

import { supabase } from './supabase'
import * as offlineCache from './offline-cache'
import * as syncQueue from './sync-queue'
import { getNetworkOnline, onNetworkChange } from './network-status'

// ---------------------------------------------------------------------------
// Cache warm-up management
// ---------------------------------------------------------------------------

const warmupInProgress = new Set<string>()
const warmupComplete = new Set<string>()

/**
 * Warm the cache for a specific table by fetching all rows from Supabase.
 * Runs once per session per table.
 */
async function ensureWarm(tableName: string): Promise<void> {
  if (warmupComplete.has(tableName) || warmupInProgress.has(tableName)) return
  if (!getNetworkOnline()) return // Can't warm if offline

  warmupInProgress.add(tableName)
  try {
    const { data, error } = await supabase.from(tableName).select('*')
    if (error) {
      console.warn(`[SupabaseDB] Warmup failed for ${tableName}:`, error.message)
      return
    }
    if (data) {
      await offlineCache.warmTable(tableName, data)
      warmupComplete.add(tableName)
    }
  } catch (err) {
    console.warn(`[SupabaseDB] Warmup exception for ${tableName}:`, err)
  } finally {
    warmupInProgress.delete(tableName)
  }
}

/**
 * Background refresh: fetch from Supabase and update cache silently.
 * Returns the fresh data if successful, null otherwise.
 */
async function backgroundRefresh(
  tableName: string,
  query?: any
): Promise<Record<string, any>[] | null> {
  if (!getNetworkOnline()) return null

  try {
    let q = supabase.from(tableName).select('*')

    // Apply filters if provided (simplified for background refresh)
    if (query?.where) {
      Object.entries(query.where).forEach(([key, value]: [string, any]) => {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          if ('in' in value) q = q.in(snakeKey, value.in)
          else if ('gt' in value) q = q.gt(snakeKey, value.gt)
          else if ('gte' in value) q = q.gte(snakeKey, value.gte)
          else if ('lt' in value) q = q.lt(snakeKey, value.lt)
          else if ('lte' in value) q = q.lte(snakeKey, value.lte)
          else if ('neq' in value) q = q.neq(snakeKey, value.neq)
          else q = q.eq(snakeKey, value)
        } else {
          q = q.eq(snakeKey, value)
        }
      })
    }

    const { data, error } = await q
    if (error) return null

    // Update the full table cache in background (non-blocking)
    if (data && !query?.where) {
      offlineCache.warmTable(tableName, data).catch(() => {})
    } else if (data) {
      // For filtered queries, update individual docs
      for (const row of data) {
        offlineCache.writeOne(tableName, row).catch(() => {})
      }
    }

    return data
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Table wrapper with offline support
// ---------------------------------------------------------------------------

function createTableWrapper(tableName: string) {
  // Kick off background warmup (fire and forget)
  if (typeof window !== 'undefined') {
    // Stagger warmup to avoid overwhelming the network
    const delay = offlineCache.CACHED_TABLES.indexOf(tableName as any) * 500
    setTimeout(() => ensureWarm(tableName), Math.max(delay, 100))
  }

  return {
    async list(options: { where?: Record<string, any>; limit?: number; orderBy?: Record<string, any> } = {}) {
      // --- Try cache first ---
      let cached: Record<string, any>[] | null = null
      if (offlineCache.isTableCached(tableName)) {
        try {
          cached = await offlineCache.readAll(tableName)

          // Apply client-side filtering on cached data
          if (cached && options.where) {
            cached = cached.filter(row => {
              return Object.entries(options.where!).every(([key, value]) => {
                const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
                const rowValue = row[snakeKey] ?? row[key]

                if (value && typeof value === 'object' && !Array.isArray(value)) {
                  if ('in' in value) return value.in.includes(rowValue)
                  if ('gt' in value) return rowValue > value.gt
                  if ('gte' in value) return rowValue >= value.gte
                  if ('lt' in value) return rowValue < value.lt
                  if ('lte' in value) return rowValue <= value.lte
                  if ('neq' in value) return rowValue !== value.neq
                  if ('like' in value) return String(rowValue || '').includes(value.like.replace(/%/g, ''))
                  if ('ilike' in value) return String(rowValue || '').toLowerCase().includes(value.ilike.replace(/%/g, '').toLowerCase())
                  if ('is' in value) return rowValue === value.is
                  return true
                }
                return String(rowValue) === String(value)
              })
            })
          }

          // Apply client-side ordering
          if (cached && options.orderBy) {
            if ('column' in options.orderBy && typeof options.orderBy.column === 'string') {
              const col = options.orderBy.column.replace(/([A-Z])/g, '_$1').toLowerCase()
              const asc = options.orderBy.ascending ?? false
              cached.sort((a, b) => {
                const va = a[col] ?? a[options.orderBy!.column]
                const vb = b[col] ?? b[options.orderBy!.column]
                const cmp = String(va ?? '').localeCompare(String(vb ?? ''))
                return asc ? cmp : -cmp
              })
            } else {
              Object.entries(options.orderBy).forEach(([key, value]) => {
                const col = key.replace(/([A-Z])/g, '_$1').toLowerCase()
                const asc = value === 'asc'
                cached!.sort((a, b) => {
                  const va = a[col] ?? a[key]
                  const vb = b[col] ?? b[key]
                  const cmp = String(va ?? '').localeCompare(String(vb ?? ''))
                  return asc ? cmp : -cmp
                })
              })
            }
          }

          // Apply limit
          if (cached && options.limit) {
            cached = cached.slice(0, options.limit)
          }
        } catch (err) {
          console.warn(`[SupabaseDB] Cache read failed for ${tableName}:`, err)
          cached = null
        }
      }

      // --- Try Supabase (online path) ---
      if (getNetworkOnline()) {
        try {
          let query = supabase.from(tableName).select('*')

          if (options.where) {
            Object.entries(options.where).forEach(([key, value]) => {
              const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
              if (value && typeof value === 'object' && !Array.isArray(value)) {
                if ('in' in value) query = query.in(snakeKey, value.in)
                else if ('gt' in value) query = query.gt(snakeKey, value.gt)
                else if ('gte' in value) query = query.gte(snakeKey, value.gte)
                else if ('lt' in value) query = query.lt(snakeKey, value.lt)
                else if ('lte' in value) query = query.lte(snakeKey, value.lte)
                else if ('neq' in value) query = query.neq(snakeKey, value.neq)
                else if ('like' in value) query = query.like(snakeKey, value.like)
                else if ('ilike' in value) query = query.ilike(snakeKey, value.ilike)
                else if ('is' in value) query = query.is(snakeKey, value.is)
                else {
                  console.warn(`[SupabaseDB] Unknown operator in where clause for ${snakeKey}:`, value)
                }
              } else {
                query = query.eq(snakeKey, value)
              }
            })
          }

          if (options.orderBy) {
            if ('column' in options.orderBy && typeof options.orderBy.column === 'string') {
              const snakeColumn = options.orderBy.column.replace(/([A-Z])/g, '_$1').toLowerCase()
              query = query.order(snakeColumn, { ascending: options.orderBy.ascending ?? false })
            } else {
              Object.entries(options.orderBy).forEach(([key, value]) => {
                const snakeColumn = key.replace(/([A-Z])/g, '_$1').toLowerCase()
                const ascending = value === 'asc'
                query = query.order(snakeColumn, { ascending })
              })
            }
          }

          if (options.limit) {
            query = query.limit(options.limit)
          }

          const { data, error } = await query

          if (error) {
            console.error(`[SupabaseDB] Error listing ${tableName}:`, error)
            // Fall back to cache if available
            if (cached) {
              console.log(`[SupabaseDB] Falling back to cached data for ${tableName}`)
              return cached.map(convertToCamelCase)
            }
            throw error
          }

          // Update cache in background with fresh data
          if (data && !options.where) {
            offlineCache.warmTable(tableName, data).catch(() => {})
          } else if (data) {
            for (const row of data) {
              offlineCache.writeOne(tableName, row).catch(() => {})
            }
          }

          return (data || []).map(convertToCamelCase)
        } catch (err) {
          // Network error — fall back to cache
          if (cached) {
            console.log(`[SupabaseDB] Network error, using cached data for ${tableName}`)
            return cached.map(convertToCamelCase)
          }
          throw err
        }
      }

      // --- Offline: return cache only ---
      if (cached) {
        return cached.map(convertToCamelCase)
      }

      // No cache and offline — return empty
      console.warn(`[SupabaseDB] Offline with no cache for ${tableName}`)
      return []
    },

    async get(id: string) {
      // --- Try Supabase first if online ---
      if (getNetworkOnline()) {
        try {
          const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .eq('id', id)
            .single()

          if (error) {
            if (error.code === 'PGRST116') {
              return null
            }
            // Fall back to cache
            const cached = await offlineCache.readOne(tableName, id)
            if (cached) return convertToCamelCase(cached)
            throw error
          }

          // Update cache
          if (data) {
            offlineCache.writeOne(tableName, data).catch(() => {})
          }
          return convertToCamelCase(data)
        } catch (err) {
          // Network error — try cache
          const cached = await offlineCache.readOne(tableName, id)
          if (cached) return convertToCamelCase(cached)
          throw err
        }
      }

      // --- Offline: cache only ---
      const cached = await offlineCache.readOne(tableName, id)
      return cached ? convertToCamelCase(cached) : null
    },

    async create(record: Record<string, any>) {
      const snakeRecord = convertToSnakeCase(record)

      if (tableName === 'housekeeping_tasks') {
        console.log(`[SupabaseDB] Creating ${tableName} with payload:`, snakeRecord)
      }

      if (getNetworkOnline()) {
        try {
          const { data, error } = await supabase
            .from(tableName)
            .insert(snakeRecord)
            .select()
            .single()

          if (error) {
            console.error(`[SupabaseDB] Error creating ${tableName}:`, error)
            console.error(`[SupabaseDB] Error details - Code: ${error.code}, Message: ${error.message}, Details: ${error.details}`)
            console.error(`[SupabaseDB] Payload sent:`, snakeRecord)
            throw error
          }

          // Write to cache
          if (data) {
            offlineCache.writeOne(tableName, data).catch(() => {})
          }

          return convertToCamelCase(data)
        } catch (err: any) {
          // If it's a network error (not a Supabase error), queue offline
          if (!err?.code && !err?.details) {
            console.log(`[SupabaseDB] Network error on create, queuing offline for ${tableName}`)
            return await this._createOffline(snakeRecord)
          }
          throw err
        }
      }

      // Offline: create in cache and queue
      return await this._createOffline(snakeRecord)
    },

    async _createOffline(snakeRecord: Record<string, any>) {
      // Generate a temporary ID if none exists
      if (!snakeRecord.id) {
        snakeRecord.id = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      }
      if (!snakeRecord.created_at) {
        snakeRecord.created_at = new Date().toISOString()
      }
      if (!snakeRecord.updated_at) {
        snakeRecord.updated_at = new Date().toISOString()
      }

      // Write to local cache
      await offlineCache.writeOne(tableName, snakeRecord)

      // Queue for sync
      await syncQueue.enqueue(tableName, 'create', snakeRecord.id, snakeRecord)

      console.log(`[SupabaseDB] 📴 Created ${tableName} offline: ${snakeRecord.id}`)
      return convertToCamelCase(snakeRecord)
    },

    async update(id: string, updates: Record<string, any>) {
      const snakeUpdates = convertToSnakeCase(updates)

      if (getNetworkOnline()) {
        try {
          const { data, error } = await supabase
            .from(tableName)
            .update(snakeUpdates)
            .eq('id', id)
            .select()
            .single()

          if (error) {
            console.error(`[SupabaseDB] Error updating ${tableName}:`, error)
            throw error
          }

          // Update cache
          if (data) {
            offlineCache.writeOne(tableName, data).catch(() => {})
          }

          return convertToCamelCase(data)
        } catch (err: any) {
          // Network error — go offline path
          if (!err?.code && !err?.details) {
            return await this._updateOffline(id, snakeUpdates)
          }
          throw err
        }
      }

      return await this._updateOffline(id, snakeUpdates)
    },

    async _updateOffline(id: string, snakeUpdates: Record<string, any>) {
      // Read current doc from cache and merge
      const existing = await offlineCache.readOne(tableName, id)
      const merged = { ...existing, ...snakeUpdates, id, updated_at: new Date().toISOString() }

      await offlineCache.writeOne(tableName, merged)
      await syncQueue.enqueue(tableName, 'update', id, snakeUpdates)

      console.log(`[SupabaseDB] 📴 Updated ${tableName}/${id} offline`)
      return convertToCamelCase(merged)
    },

    async delete(id: string) {
      if (getNetworkOnline()) {
        try {
          const { error } = await supabase
            .from(tableName)
            .delete()
            .eq('id', id)

          if (error) {
            console.error(`[SupabaseDB] Error deleting ${tableName}:`, error)
            throw error
          }

          // Remove from cache
          offlineCache.deleteOne(tableName, id).catch(() => {})

          return true
        } catch (err: any) {
          if (!err?.code && !err?.details) {
            return await this._deleteOffline(id)
          }
          throw err
        }
      }

      return await this._deleteOffline(id)
    },

    async _deleteOffline(id: string) {
      await offlineCache.deleteOne(tableName, id)
      await syncQueue.enqueue(tableName, 'delete', id)

      console.log(`[SupabaseDB] 📴 Deleted ${tableName}/${id} offline`)
      return true
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers — case conversion
// ---------------------------------------------------------------------------

function convertToCamelCase(obj: Record<string, any> | null): Record<string, any> | null {
  if (!obj) return null
  const result: Record<string, any> = {}
  Object.entries(obj).forEach(([key, value]) => {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    result[camelKey] = value
  })
  return result
}

function convertToSnakeCase(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  Object.entries(obj).forEach(([key, value]) => {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    result[snakeKey] = value
  })
  return result
}

// ---------------------------------------------------------------------------
// Sync queue processing — execute queued mutations against Supabase
// ---------------------------------------------------------------------------

async function executeSyncEntry(entry: syncQueue.QueueEntry): Promise<void> {
  switch (entry.operation) {
    case 'create': {
      const { error } = await supabase
        .from(entry.table)
        .insert(entry.payload)
        .select()
        .single()

      if (error) {
        // If duplicate / conflict, treat as success (already synced)
        if (error.code === '23505' || error.message?.includes('duplicate')) {
          console.log(`[SyncExecutor] Duplicate detected for ${entry.table}/${entry.recordId}, treating as synced`)
          return
        }
        throw error
      }
      break
    }

    case 'update': {
      const { error } = await supabase
        .from(entry.table)
        .update(entry.payload)
        .eq('id', entry.recordId)

      if (error) throw error
      break
    }

    case 'delete': {
      const { error } = await supabase
        .from(entry.table)
        .delete()
        .eq('id', entry.recordId)

      if (error) throw error
      break
    }
  }
}

// Auto-process queue when coming back online
if (typeof window !== 'undefined') {
  onNetworkChange(async (online) => {
    if (online) {
      console.log('[SupabaseDB] 🔄 Back online — processing sync queue...')
      const result = await syncQueue.processQueue(executeSyncEntry)
      if (result.processed > 0 || result.failed > 0) {
        console.log(`[SupabaseDB] Sync complete: ${result.processed} synced, ${result.failed} failed`)
      }

      // Re-warm critical tables to pick up changes made by other users while offline
      for (const table of offlineCache.CACHED_TABLES) {
        ensureWarm(table)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Database tables
// ---------------------------------------------------------------------------

export const db = {
  users: createTableWrapper('users'),
  staff: createTableWrapper('staff'),
  rooms: createTableWrapper('rooms'),
  roomTypes: createTableWrapper('room_types'),
  guests: createTableWrapper('guests'),
  bookings: createTableWrapper('bookings'),
  bookingCharges: createTableWrapper('booking_charges'),
  invoices: createTableWrapper('invoices'),
  activityLogs: createTableWrapper('activity_logs'),
  contactMessages: createTableWrapper('contact_messages'),
  properties: createTableWrapper('properties'),
  hotelSettings: createTableWrapper('hotel_settings'),
  housekeepingTasks: createTableWrapper('housekeeping_tasks'),
  notifications: createTableWrapper('notifications'),
  reviews: createTableWrapper('reviews'),
  // Channel Manager Tables
  channelConnections: createTableWrapper('channel_connections'),
  channelRoomMappings: createTableWrapper('channel_room_mappings'),
  externalBookings: createTableWrapper('external_bookings'),
  // HR Tables
  hr_attendance: createTableWrapper('hr_attendance'),
  hr_leave_requests: createTableWrapper('hr_leave_requests'),
  hr_payroll: createTableWrapper('hr_payroll'),
  hr_performance_reviews: createTableWrapper('hr_performance_reviews'),
  hr_job_applications: createTableWrapper('hr_job_applications'),
  hr_weekly_revenue: createTableWrapper('hr_weekly_revenue'),
  standaloneSales: createTableWrapper('standalone_sales'),
}

// ---------------------------------------------------------------------------
// Auth wrapper with offline session caching
// ---------------------------------------------------------------------------

const AUTH_CACHE_KEY = 'offline_auth_session'
const AUTH_SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7 days

function cacheAuthSession(user: { id: string; email: string | undefined }) {
  try {
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
      user,
      timestamp: Date.now(),
    }))
  } catch { /* ignore */ }
}

function getCachedAuthSession(): { id: string; email: string | undefined } | null {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.timestamp > AUTH_SESSION_EXPIRY) {
      localStorage.removeItem(AUTH_CACHE_KEY)
      return null
    }
    return parsed.user
  } catch {
    return null
  }
}

function clearCachedAuthSession() {
  try {
    localStorage.removeItem(AUTH_CACHE_KEY)
  } catch { /* ignore */ }
}

export const auth = {
  async signInWithEmail(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      console.error('[SupabaseAuth] Sign in error:', error)
      throw new Error(error.message)
    }

    // Cache session for offline access
    if (data.user) {
      cacheAuthSession({ id: data.user.id, email: data.user.email })
    }

    return data.user
  },

  async signUp(options: { email: string; password: string }) {
    const { data, error } = await supabase.auth.signUp({
      email: options.email,
      password: options.password
    })

    if (error) {
      console.error('[SupabaseAuth] Sign up error:', error)
      throw new Error(error.message)
    }

    // Create user profile record
    if (data.user) {
      try {
        await supabase.from('users').insert({
          id: data.user.id,
          email: data.user.email,
          first_login: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      } catch (profileError) {
        console.warn('[SupabaseAuth] Could not create user profile:', profileError)
      }
    }

    return data.user
  },

  async logout() {
    clearCachedAuthSession()

    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('[SupabaseAuth] Logout error:', error)
      throw error
    }
  },

  async me() {
    // Try Supabase first if online
    if (getNetworkOnline()) {
      try {
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user) {
          // If Supabase says no user, check cache (might be temporary network issue)
          const cached = getCachedAuthSession()
          if (cached) {
            return cached
          }
          return null
        }

        // Cache the session
        cacheAuthSession({ id: user.id, email: user.email })

        return {
          id: user.id,
          email: user.email
        }
      } catch {
        // Network error — fall back to cache
        const cached = getCachedAuthSession()
        return cached || null
      }
    }

    // Offline — use cached session
    const cached = getCachedAuthSession()
    if (cached) {
      console.log('[SupabaseAuth] 📴 Using cached session for offline access')
    }
    return cached || null
  },

  async changePassword(oldPassword: string, newPassword: string) {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (error) {
      console.error('[SupabaseAuth] Change password error:', error)
      throw new Error(error.message)
    }

    return true
  },

  onAuthStateChanged(callback: (state: { isLoading: boolean; user: any | null }) => void) {
    // Initial state
    callback({ isLoading: true, user: null })

    // Get current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user
        ? { id: session.user.id, email: session.user.email }
        : null

      // Cache if we have a user
      if (user) cacheAuthSession(user)

      callback({ isLoading: false, user })
    }).catch(() => {
      // Offline — try cached session
      const cached = getCachedAuthSession()
      callback({ isLoading: false, user: cached })
    })

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user
        ? { id: session.user.id, email: session.user.email }
        : null

      if (user) cacheAuthSession(user)
      if (event === 'SIGNED_OUT') clearCachedAuthSession()

      callback({ isLoading: false, user })
    })

    // Return unsubscribe function
    return () => subscription.unsubscribe()
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const blink = { db, auth }
export default blink
