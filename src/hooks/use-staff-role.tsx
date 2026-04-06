import { useState, useEffect, useCallback, useRef } from 'react'
import { blink } from '@/blink/client'
import type { StaffRole } from '@/lib/rbac'
import { getNetworkOnline } from '@/lib/network-status'

// Cache helper functions
const CACHE_KEY_PREFIX = 'staff_role_cache_'
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7 days (for offline support)
const CACHE_REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes (refresh from network when online)

function saveToCache(userId: string, staffRecord: StaffRecord, role: StaffRole) {
  try {
    const cacheData = {
      staffRecord,
      role,
      timestamp: Date.now()
    }
    localStorage.setItem(`${CACHE_KEY_PREFIX}${userId}`, JSON.stringify(cacheData))
  } catch (error) {
    console.warn('Failed to save staff role to cache:', error)
  }
}

function loadFromCache(userId: string): { staffRecord: StaffRecord; role: StaffRole; isStale: boolean } | null {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}${userId}`)
    if (!cached) return null

    const cacheData = JSON.parse(cached)
    const age = Date.now() - cacheData.timestamp
    const isExpired = age > CACHE_EXPIRY
    const isStale = age > CACHE_REFRESH_INTERVAL

    // If expired AND online, purge the cache
    if (isExpired && getNetworkOnline()) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${userId}`)
      return null
    }

    // If expired but offline, still return it (stale data > no data)
    if (isExpired && !getNetworkOnline()) {
      console.log('[useStaffRole] 📴 Using expired cache (offline mode)')
    }

    return {
      staffRecord: cacheData.staffRecord,
      role: cacheData.role,
      isStale,
    }
  } catch (error) {
    console.warn('Failed to load staff role from cache:', error)
    return null
  }
}

function clearCache(userId: string) {
  try {
    localStorage.removeItem(`${CACHE_KEY_PREFIX}${userId}`)
  } catch (error) {
    console.warn('Failed to clear staff role cache:', error)
  }
}

interface StaffRecord {
  id: string
  userId: string  // SDK converts to/from user_id automatically
  name: string
  email: string
  role: string
  createdAt: string
}

export function useStaffRole() {
  const [role, setRole] = useState<StaffRole | null>(null)
  const [staffRecord, setStaffRecord] = useState<StaffRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const isLoadingRef = useRef(false)
  const loadedUserIdRef = useRef<string | null>(null)

  // Computed properties for backward compatibility
  const isOwner = role === 'owner'
  const isAdmin = role === 'admin'
  const isManager = role === 'manager'
  const isStaff = role === 'staff'
  const canManageEmployees = role === 'owner' || role === 'admin'

  // Background refresh from network (non-blocking, no loading state changes)
  const loadStaffRoleFromNetwork = useCallback(async (uid: string) => {
    try {
      let staff = await (blink.db as any).staff.list({
        where: { userId: uid },
        limit: 1,
      })

      if (staff.length === 0) {
        staff = await (blink.db as any).staff.list({
          where: { user_id: uid } as any,
          limit: 1,
        })
      }

      if (staff.length > 0) {
        const record = staff[0] as unknown as StaffRecord
        const staffRole = record.role as StaffRole
        setStaffRecord(record)
        setRole(staffRole)
        saveToCache(uid, record, staffRole)
        console.log('🔄 [useStaffRole] Background refresh complete:', staffRole)
      }
    } catch (err) {
      console.warn('⚠️ [useStaffRole] Background refresh failed:', err)
    }
  }, [])

  const loadStaffRole = useCallback(async (uid: string) => {
    // Prevent duplicate loads for the same user
    if (isLoadingRef.current || loadedUserIdRef.current === uid) {
      console.log('⏭️ [useStaffRole] Skipping duplicate load for userId:', uid)
      return
    }

    try {
      isLoadingRef.current = true
      setLoading(true)
      console.log('🔍 [useStaffRole] Loading staff role for userId:', uid)

      // Try to load from cache first
      const cached = loadFromCache(uid)
      if (cached) {
        setStaffRecord(cached.staffRecord)
        setRole(cached.role)
        loadedUserIdRef.current = uid
        setLoading(false)
        isLoadingRef.current = false
        console.log('✅ [useStaffRole] Loaded from cache:', {
          userId: uid,
          role: cached.role,
          name: cached.staffRecord.name,
          isStale: cached.isStale,
        })

        // If stale but online, refresh in background (non-blocking)
        if (cached.isStale && getNetworkOnline()) {
          console.log('🔄 [useStaffRole] Cache is stale, refreshing in background...')
          // Don't await — fire and forget
          loadStaffRoleFromNetwork(uid).catch(() => {})
        }

        return
      }

      // If offline and no cache, we can't fetch — bail gracefully
      if (!getNetworkOnline()) {
        console.warn('📴 [useStaffRole] Offline with no cache for userId:', uid)
        setRole(null)
        setStaffRecord(null)
        setLoading(false)
        isLoadingRef.current = false
        return
      }

      // Optimized single query with better error handling
      let staff = await (blink.db as any).staff.list({
        where: { userId: uid },
        limit: 1,
        include: ['user'] // Try to include user data in single query
      })

      if (staff.length === 0) {
        // Try snake_case version as fallback
        staff = await (blink.db as any).staff.list({
          where: { user_id: uid } as any,
          limit: 1,
          include: ['user']
        })
      }

      // Fallback: Try looking up by email if userId lookup failed
      if (staff.length === 0) {
        console.log('🔍 [useStaffRole] userId lookup failed, trying email lookup...')
        try {
          const currentUser = await blink.auth.me()
          if (currentUser?.email) {
            staff = await (blink.db as any).staff.list({
              where: { email: currentUser.email },
              limit: 1
            })

            // If found by email, update the userId in the staff record
            if (staff.length > 0 && staff[0].userId !== uid) {
              console.log('🔧 [useStaffRole] Updating staff record with correct userId...')
              try {
                await (blink.db as any).staff.update(staff[0].id, { userId: uid })
                staff[0].userId = uid
                console.log('✅ [useStaffRole] Staff record userId updated successfully')
              } catch (updateError) {
                console.warn('⚠️ [useStaffRole] Could not update staff userId:', updateError)
              }
            }
          }
        } catch (emailLookupError) {
          console.warn('⚠️ [useStaffRole] Email lookup failed:', emailLookupError)
        }
      }

      if (staff.length > 0) {
        const staffRecord = staff[0] as unknown as StaffRecord
        const staffRole = staffRecord.role as StaffRole
        setStaffRecord(staffRecord)
        setRole(staffRole)
        loadedUserIdRef.current = uid

        // Save to cache
        saveToCache(uid, staffRecord, staffRole)

        console.log('✅ [useStaffRole] Staff role loaded successfully:', {
          userId: uid,
          role: staffRole,
          name: staffRecord.name,
          email: staffRecord.email
        })
      } else {
        setRole(null)
        setStaffRecord(null)
        loadedUserIdRef.current = null
        console.warn('❌ [useStaffRole] No staff record found for userId:', uid)
      }
    } catch (error) {
      console.error('❌ [useStaffRole] Failed to load staff role:', error)
      setRole(null)
      setStaffRecord(null)
      loadedUserIdRef.current = null
    } finally {
      setLoading(false)
      isLoadingRef.current = false
    }
  }, [])

  useEffect(() => {
    // Use a sentinel value so the first auth resolution (null user) is always processed
    const UNSET = '__unset__'
    let currentUserId: string | null = UNSET as any

    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      // Wait until auth has fully resolved before acting
      if (state.isLoading) return

      const newUserId = state.user?.id || null

      // Process whenever userId changes OR on the very first resolution
      if (newUserId !== currentUserId) {
        const prevUserId = currentUserId === UNSET ? null : currentUserId as string | null
        currentUserId = newUserId

        if (newUserId) {
          setUserId(newUserId)
          loadStaffRole(newUserId)
        } else {
          setUserId(null)
          setRole(null)
          setStaffRecord(null)
          setLoading(false)
          loadedUserIdRef.current = null
          // Clear cache on logout
          if (prevUserId) {
            clearCache(prevUserId)
          }
        }
      }
    })

    // Listen for manual refresh events
    const handleRefresh = () => {
      if (currentUserId) {
        console.log('🔄 [useStaffRole] Manual refresh triggered')
        loadedUserIdRef.current = null // Force reload
        loadStaffRole(currentUserId)
      }
    }

    window.addEventListener('refreshStaffRole', handleRefresh)

    return () => {
      unsubscribe()
      window.removeEventListener('refreshStaffRole', handleRefresh)
    }
  }, [loadStaffRole])

  return {
    role,
    staffRecord,
    loading,
    userId,
    isOwner,
    isAdmin,
    isManager,
    isStaff,
    canManageEmployees,
    refreshRole: () => {
      if (userId) {
        loadStaffRole(userId)
      }
    }
  }
}