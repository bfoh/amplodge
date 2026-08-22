/**
 * Supabase Database Wrapper
 *
 * This module provides the data-access API used by `@/lib/db`, backed directly
 * by Supabase. Reads and writes go straight to the network; realtime
 * subscriptions (auth-gated) power live table-update notifications so pages
 * refresh when data changes elsewhere.
 */

import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Table-update pub/sub
// ---------------------------------------------------------------------------
// Pages subscribe to table updates and re-run their loader when the realtime
// channel reports a server-side change.

const tableListeners = new Map<string, Set<() => void>>()

export function onTableUpdated(table: string, cb: () => void): () => void {
  let set = tableListeners.get(table)
  if (!set) {
    set = new Set()
    tableListeners.set(table, set)
  }
  set.add(cb)
  return () => {
    set!.delete(cb)
  }
}

function emitTableUpdated(table: string) {
  const set = tableListeners.get(table)
  if (!set || set.size === 0) return
  // Fire async so the wrapper return value lands first
  queueMicrotask(() => {
    set.forEach(cb => {
      try { cb() } catch (e) { console.warn(`[SupabaseDB] listener for ${table} threw:`, e) }
    })
  })
}

// ---------------------------------------------------------------------------
// Realtime Subscriptions
// ---------------------------------------------------------------------------
// Listen for server-side changes and signal local subscribers. Started from
// App.tsx once a session exists — anonymous visitors never open the websocket.

let realtimeChannel: any = null

function initRealtimeSubscriptions() {
  if (realtimeChannel) return

  console.log('📡 [SupabaseDB] Initializing Realtime Subscriptions...')

  realtimeChannel = supabase
    .channel('db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public' },
      (payload) => {
        const table = payload.table
        // Handle snake_case to camelCase table name mapping if needed.
        // Most tables match, but some (activity_logs) use snake_case in DB
        // and camelCase in TypedDB. We emit both for safety.
        const camelTable = table.replace(/_([a-z])/g, (g) => g[1].toUpperCase())

        emitTableUpdated(table)
        if (camelTable !== table) {
          emitTableUpdated(camelTable)
        }
      }
    )
    .subscribe((status) => {
      console.log(`📡 [SupabaseDB] Realtime status: ${status}`)
    })
}

/**
 * Enable live table-update notifications for authenticated sessions.
 * Idempotent. Called from App.tsx when auth state resolves with a user.
 */
export async function initRealtimeUpdates(): Promise<void> {
  initRealtimeSubscriptions()
}

// ---------------------------------------------------------------------------
// Table wrapper
// ---------------------------------------------------------------------------

/** PostgREST refuses to return more than this in one response, whatever limit is asked for. */
const SERVER_PAGE_LIMIT = 1000

function createTableWrapper(tableName: string) {
  return {
    async list(options: { where?: Record<string, any>; limit?: number; orderBy?: Record<string, any> } = {}) {
      // Rebuilt per page: a PostgREST builder executes when awaited and cannot
      // be awaited twice.
      const buildQuery = () => {
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

        return query
      }

      // PostgREST caps a response at 1000 rows however large a limit is asked
      // for, and says nothing about it — `limit: 5000` on a 1003-row table
      // quietly returns 1000. Every revenue figure is computed from these
      // fetches, so a silent truncation is money going missing from reports.
      //
      // Anything that could exceed the cap is therefore read page by page. A
      // small limit (a lookup, a "latest 5") stays a single request.
      const wanted = options.limit ?? Infinity
      if (wanted <= SERVER_PAGE_LIMIT) {
        const { data, error } = await buildQuery().limit(wanted)
        if (error) {
          console.error(`[SupabaseDB] Error listing ${tableName}:`, error)
          throw error
        }
        return (data || []).map(convertToCamelCase)
      }

      const rows: any[] = []
      for (let from = 0; rows.length < wanted; from += SERVER_PAGE_LIMIT) {
        const { data, error } = await buildQuery().range(from, from + SERVER_PAGE_LIMIT - 1)
        if (error) {
          console.error(`[SupabaseDB] Error listing ${tableName} (page from ${from}):`, error)
          throw error
        }
        const page = data || []
        rows.push(...page)
        if (page.length < SERVER_PAGE_LIMIT) break
      }
      return (wanted === Infinity ? rows : rows.slice(0, wanted)).map(convertToCamelCase)
    },

    /**
     * Fetch ALL rows by paginating server-side via .range(), bypassing the
     * Supabase per-request row cap (default 1000). Use when you need the
     * complete table — counts, dedup passes, etc.
     */
    /**
     * How many rows match, without fetching any of them.
     *
     * Used to say "250 of 1,005" when a list is windowed — a count that drops
     * with no explanation reads as lost data.
     */
    async count(options: { where?: Record<string, any> } = {}): Promise<number | null> {
      let query = supabase.from(tableName).select('id', { count: 'exact', head: true })
      if (options.where) {
        Object.entries(options.where).forEach(([key, value]) => {
          const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            if ('gte' in value) query = query.gte(snakeKey, value.gte)
            else if ('lte' in value) query = query.lte(snakeKey, value.lte)
            else if ('gt' in value) query = query.gt(snakeKey, value.gt)
            else if ('lt' in value) query = query.lt(snakeKey, value.lt)
            else if ('in' in value) query = query.in(snakeKey, value.in)
          } else {
            query = query.eq(snakeKey, value)
          }
        })
      }
      const { count, error } = await query
      if (error) {
        // null, not 0: a failed count is unknown, and reporting it as zero
        // produced "250 of 0" on a page holding 250 rows.
        console.warn(`[SupabaseDB] Count failed for ${tableName}:`, error.message)
        return null
      }
      return count ?? null
    },

    async listAll(options: { where?: Record<string, any>; orderBy?: Record<string, any>; pageSize?: number } = {}) {
      const pageSize = options.pageSize ?? 1000

      const buildBaseQuery = () => {
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
        return query
      }

      try {
        const all: Record<string, any>[] = []
        let offset = 0
        const HARD_CEILING = 100000
        while (offset < HARD_CEILING) {
          const query = buildBaseQuery().range(offset, offset + pageSize - 1)
          const { data, error } = await query
          if (error) throw error
          if (!data || data.length === 0) break
          all.push(...data)
          if (data.length < pageSize) break
          offset += pageSize
        }
        return all.map(convertToCamelCase)
      } catch (err) {
        console.error(`[SupabaseDB] listAll error for ${tableName}:`, err)
        return []
      }
    },

    async get(id: string) {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return null
        }
        throw error
      }
      return convertToCamelCase(data)
    },

    async create(record: Record<string, any>) {
      const snakeRecord = convertToSnakeCase(record)

      const { data, error } = await supabase
        .from(tableName)
        .insert(snakeRecord)
        .select()
        .single()

      if (error) {
        console.error(`[SupabaseDB] Error creating ${tableName}:`, error)
        throw error
      }
      return convertToCamelCase(data)
    },

    async update(id: string, updates: Record<string, any>) {
      const snakeUpdates = convertToSnakeCase(updates)

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
      return convertToCamelCase(data)
    },

    async delete(id: string) {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id)

      if (error) {
        console.error(`[SupabaseDB] Error deleting ${tableName}:`, error)
        throw error
      }
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
// Database tables
// ---------------------------------------------------------------------------

export const db = {
  users: createTableWrapper('users'),
  staff: createTableWrapper('staff'),
  rooms: createTableWrapper('rooms'),
  roomTypes: createTableWrapper('room_types'),
  guests: createTableWrapper('guests'),
  bookings: createTableWrapper('bookings'),
  // Read-only view: the reservations list with special_requests already parsed
  // server-side. See 20260822_reservations_list_view.sql.
  reservationsList: createTableWrapper('reservations_list'),
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
  inventory: createTableWrapper('inventory'),
  inventoryTransactions: createTableWrapper('inventory_transactions'),
  bookingGroups: createTableWrapper('booking_groups'),
}

// ---------------------------------------------------------------------------
// Auth wrapper with session caching
// ---------------------------------------------------------------------------
// The localStorage session cache keeps login resilient across transient
// network/server errors (Supabase 5xx) without granting anything the server
// wouldn't: every privileged operation still requires a valid JWT.

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
    // Read the current user BEFORE clearing anything so we can also drop
    // their cached staff role — otherwise a stale role/name can outlive
    // this logout (previously only cleared reactively by a SIGNED_OUT
    // listener in use-staff-role.tsx, which may not even be mounted).
    // Matters most for the shared front-desk terminal: the next person to
    // log in must never see a flash of the previous person's cached role.
    try {
      const cached = getCachedAuthSession()
      if (cached?.id) {
        // Prefix must match CACHE_KEY_PREFIX in src/hooks/use-staff-role.tsx.
        localStorage.removeItem(`staff_role_cache_${cached.id}`)
      }
    } catch { /* ignore */ }

    clearCachedAuthSession()

    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('[SupabaseAuth] Logout error:', error)
      throw error
    }
  },

  async me() {
    // Distinguish 4 cases:
    //   1. Supabase returns user → trust it, refresh cache
    //   2. Supabase returns null user (no error) → real signed-out, clear cache
    //   3. AuthApiError (real 4xx auth response) → token rejected, clear cache
    //   4. Network error / 5xx → fall back to cached session
    let supabaseError: unknown = null
    let supabaseUser: { id: string; email: string | undefined } | null = null

    try {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error) {
        supabaseError = error
      } else if (user) {
        supabaseUser = { id: user.id, email: user.email }
      }
    } catch (networkErr) {
      supabaseError = networkErr
    }

    // Case 1: Supabase responded with a user
    if (supabaseUser) {
      cacheAuthSession(supabaseUser)
      return supabaseUser
    }

    // Case 2: Supabase responded successfully with NO user → real signed-out
    if (!supabaseError) {
      clearCachedAuthSession()
      return null
    }

    // Case 3: AuthApiError → token rejected (revoked, expired, malformed)
    const isAuthError = supabaseError && typeof supabaseError === 'object'
      && 'name' in supabaseError
      && (supabaseError as any).name === 'AuthApiError'
    if (isAuthError) {
      console.log('[SupabaseAuth] 🚪 AuthApiError — clearing cache and signing out')
      clearCachedAuthSession()
      return null
    }

    // Case 4: Network/server error → fall back to cache
    return getCachedAuthSession()
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

    // Get current session — distinguish error type same as me()
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        // Real auth error → clear cache, no user
        const isAuthError = error && typeof error === 'object' && 'name' in error
          && (error as any).name === 'AuthApiError'
        if (isAuthError) {
          clearCachedAuthSession()
          callback({ isLoading: false, user: null })
        } else {
          // Treat as network error — fall back to cache
          const cached = getCachedAuthSession()
          callback({ isLoading: false, user: cached })
        }
        return
      }

      const user = session?.user
        ? { id: session.user.id, email: session.user.email }
        : null

      if (user) {
        cacheAuthSession(user)
      } else {
        // Real signed-out — clear cache so refresh doesn't restore stale session
        clearCachedAuthSession()
      }

      callback({ isLoading: false, user })
    }).catch(() => {
      // Network error — try cached session
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
