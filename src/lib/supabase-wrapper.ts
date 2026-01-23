/**
 * Supabase Database Wrapper
 * 
 * This module provides a Blink-compatible API using Supabase as the backend.
 * It wraps Supabase operations to match the existing blink.db interface,
 * minimizing changes needed across the codebase.
 */

import { supabase } from './supabase'

// Generic table wrapper that provides CRUD operations
function createTableWrapper(tableName: string) {
    return {
        async list(options: { where?: Record<string, any>; limit?: number; orderBy?: Record<string, any> } = {}) {
            let query = supabase.from(tableName).select('*')

            if (options.where) {
                Object.entries(options.where).forEach(([key, value]) => {
                    // Convert camelCase to snake_case for column names
                    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()

                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        // Handle operators like { in: [...] }, { gt: ... }, etc.
                        if ('in' in value) {
                            query = query.in(snakeKey, value.in)
                        } else if ('gt' in value) {
                            query = query.gt(snakeKey, value.gt)
                        } else if ('gte' in value) {
                            query = query.gte(snakeKey, value.gte)
                        } else if ('lt' in value) {
                            query = query.lt(snakeKey, value.lt)
                        } else if ('lte' in value) {
                            query = query.lte(snakeKey, value.lte)
                        } else if ('neq' in value) {
                            query = query.neq(snakeKey, value.neq)
                        } else if ('like' in value) {
                            query = query.like(snakeKey, value.like)
                        } else if ('ilike' in value) {
                            query = query.ilike(snakeKey, value.ilike)
                        } else if ('is' in value) {
                            query = query.is(snakeKey, value.is)
                        } else {
                            // Fallback for unknown text search or unknown operators
                            // For now, treat as equality if no known operator is found, 
                            // but usually objects imply operators in this shim.
                            console.warn(`[SupabaseDB] Unknown operator in where clause for ${snakeKey}:`, value)
                        }
                    } else {
                        // Simple equality check
                        query = query.eq(snakeKey, value)
                    }
                })
            }

            // Support both formats: { column: 'name', ascending: true } and { columnName: 'asc'|'desc' }
            if (options.orderBy) {
                if ('column' in options.orderBy && typeof options.orderBy.column === 'string') {
                    // New format: { column: 'createdAt', ascending: false }
                    const snakeColumn = options.orderBy.column.replace(/([A-Z])/g, '_$1').toLowerCase()
                    query = query.order(snakeColumn, { ascending: options.orderBy.ascending ?? false })
                } else {
                    // Legacy Blink format: { createdAt: 'desc' }
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
                throw error
            }

            // Convert snake_case to camelCase in response
            return (data || []).map(convertToCamelCase)
        },

        async get(id: string) {
            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .eq('id', id)
                .single()

            if (error) {
                if (error.code === 'PGRST116') {
                    return null // Record not found
                }
                console.error(`[SupabaseDB] Error getting ${tableName}:`, error)
                throw error
            }

            return convertToCamelCase(data)
        },

        async create(record: Record<string, any>) {
            // Convert camelCase to snake_case for insert
            const snakeRecord = convertToSnakeCase(record)

            // Debug logging for housekeeping_tasks
            if (tableName === 'housekeeping_tasks') {
                console.log(`[SupabaseDB] Creating ${tableName} with payload:`, snakeRecord)
            }

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

            return convertToCamelCase(data)
        },


        async update(id: string, updates: Record<string, any>) {
            // Convert camelCase to snake_case for update
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
        }
    }
}

// Helper to convert snake_case to camelCase
function convertToCamelCase(obj: Record<string, any> | null): Record<string, any> | null {
    if (!obj) return null

    const result: Record<string, any> = {}

    Object.entries(obj).forEach(([key, value]) => {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
        result[camelKey] = value
    })

    return result
}

// Helper to convert camelCase to snake_case
function convertToSnakeCase(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    Object.entries(obj).forEach(([key, value]) => {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
        result[snakeKey] = value
    })

    return result
}

// Create database object with all tables
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
}

// Auth wrapper that matches Blink's auth interface
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
        const { error } = await supabase.auth.signOut()

        if (error) {
            console.error('[SupabaseAuth] Logout error:', error)
            throw error
        }
    },

    async me() {
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user) {
            return null
        }

        return {
            id: user.id,
            email: user.email
        }
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
            callback({
                isLoading: false,
                user: session?.user ? { id: session.user.id, email: session.user.email } : null
            })
        })

        // Listen for changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            callback({
                isLoading: false,
                user: session?.user ? { id: session.user.id, email: session.user.email } : null
            })
        })

        // Return unsubscribe function
        return () => subscription.unsubscribe()
    }
}

// Export combined blink-compatible interface
export const blink = {
    db,
    auth
}

export default blink
