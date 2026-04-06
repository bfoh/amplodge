/**
 * Network Status — Reactive online/offline detection
 *
 * Provides both a React hook and imperative helpers to track connectivity.
 *
 * Why not just `navigator.onLine`?
 * - On some mobile networks and captive portals, navigator.onLine returns true
 *   even though requests are failing. We add a lightweight heartbeat check that
 *   pings the Supabase health endpoint to verify real connectivity.
 * - We also listen to the native `online`/`offline` events for instant detection.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How often (ms) to verify connectivity via a fetch probe */
const HEARTBEAT_INTERVAL_MS = 30_000 // 30 seconds

/** Timeout for the heartbeat fetch probe */
const HEARTBEAT_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Reactive state (singleton outside React)
// ---------------------------------------------------------------------------

type NetworkListener = (online: boolean) => void

let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
const _listeners = new Set<NetworkListener>()

function setOnline(value: boolean) {
  if (_isOnline === value) return
  _isOnline = value
  console.log(`[NetworkStatus] ${value ? '🟢 Online' : '🔴 Offline'}`)
  _listeners.forEach(fn => fn(value))
}

// ---------------------------------------------------------------------------
// Browser event listeners (set up once)
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true))
  window.addEventListener('offline', () => setOnline(false))
}

// ---------------------------------------------------------------------------
// Heartbeat (optional background check)
// ---------------------------------------------------------------------------

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

async function heartbeatCheck(): Promise<boolean> {
  // Only check if browser thinks we're online — no point pinging if offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setOnline(false)
    return false
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS)

    // Use a lightweight endpoint — just check if we can reach the internet.
    // We use the Supabase URL (already configured) or a fallback.
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const checkUrl = supabaseUrl
      ? `${supabaseUrl}/rest/v1/?limit=0`
      : 'https://httpbin.org/get'

    const res = await fetch(checkUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: supabaseUrl
        ? {
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}`,
          }
        : {},
      // Bypass the Netlify proxy for heartbeat so we test actual connectivity
      cache: 'no-store',
    })

    clearTimeout(timeout)
    const alive = res.ok || res.status === 401 || res.status === 406 // Supabase returns 406 for HEAD on REST
    setOnline(alive)
    return alive
  } catch {
    setOnline(false)
    return false
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return
  // Do an immediate check
  heartbeatCheck()
  heartbeatTimer = setInterval(heartbeatCheck, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

// Start heartbeat on module load
if (typeof window !== 'undefined') {
  startHeartbeat()
}

// ---------------------------------------------------------------------------
// Imperative API
// ---------------------------------------------------------------------------

/**
 * Returns the current online status.
 */
export function getNetworkOnline(): boolean {
  return _isOnline
}

/**
 * Subscribe to network status changes. Returns an unsubscribe function.
 */
export function onNetworkChange(listener: NetworkListener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

/**
 * Force a connectivity check right now.
 */
export async function checkConnectivity(): Promise<boolean> {
  return heartbeatCheck()
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface NetworkState {
  isOnline: boolean
  /** Trigger a manual connectivity check */
  checkNow: () => Promise<boolean>
}

/**
 * React hook that provides reactive online/offline status.
 *
 * Usage:
 * ```tsx
 * const { isOnline } = useNetworkStatus()
 * ```
 */
export function useNetworkStatus(): NetworkState {
  const [isOnline, setIsOnline] = useState(_isOnline)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const unsub = onNetworkChange(online => {
      if (mountedRef.current) setIsOnline(online)
    })
    // Sync with current global state in case it changed before mount
    setIsOnline(_isOnline)
    return () => {
      mountedRef.current = false
      unsub()
    }
  }, [])

  const checkNow = useCallback(async () => {
    const result = await heartbeatCheck()
    if (mountedRef.current) setIsOnline(result)
    return result
  }, [])

  return { isOnline, checkNow }
}
