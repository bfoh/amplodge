import { useState, useEffect, useCallback, useRef } from 'react'
import { blink } from '@/blink/client'
import type { StaffRole } from '@/lib/rbac'

// Cache helper functions
const CACHE_KEY_PREFIX = 'staff_role_cache_'
const CACHE_EXPIRY = 5 * 60 * 1000 // 5 minutes

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

function loadFromCache(userId: string): { staffRecord: StaffRecord; role: StaffRole } | null {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}${userId}`)
    if (!cached) return null

    const cacheData = JSON.parse(cached)
    const isExpired = Date.now() - cacheData.timestamp > CACHE_EXPIRY

    if (isExpired) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${userId}`)
      return null
    }

    return {
      staffRecord: cacheData.staffRecord,
      role: cacheData.role
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
          name: cached.staffRecord.name
        })
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
    let currentUserId: string | null = null

    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      const newUserId = state.user?.id || null

      // Only reload if userId actually changed
      if (newUserId !== currentUserId) {
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
          if (currentUserId) {
            clearCache(currentUserId)
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