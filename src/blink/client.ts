/**
 * Blink Client - Now powered by Supabase
 * 
 * This module re-exports the Supabase wrapper which provides
 * a Blink-compatible API. All existing code using blink.auth
 * and blink.db will continue to work.
 */

export { blink, db, auth } from '../lib/supabase-wrapper'

// For backwards compatibility with code using blinkManaged
export { blink as blinkManaged } from '../lib/supabase-wrapper'

// Stub exports for legacy offline sync functionality (no longer needed with Supabase)
export const isOnline = () => typeof navigator !== 'undefined' ? navigator.onLine : true
export const syncQueue = {
    add: async () => { },
    process: async () => { },
    clear: async () => { },
    getAll: async () => []
}
