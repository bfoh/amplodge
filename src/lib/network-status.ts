/**
 * Network Status — reactive online/offline detection tuned for high-latency,
 * intermittent mobile networks (the app's users are largely on Ghanaian mobile
 * data behind the Netlify → Supabase proxy).
 *
 * The offline flag gates a lot of behaviour in supabase-wrapper (stale-cache
 * reads, queued/id-less writes), so a FALSE offline is very disruptive. The old
 * detector flipped offline on a single failed probe and treated any non-2xx
 * response as offline — so one 5s timeout, one radio handoff, or one transient
 * proxy 5xx dropped the whole app into offline mode for up to 30s. That was the
 * "intermittent offline" users complained about.
 *
 * Design principles here:
 *  1. A probe only FAILS on a transport error (fetch throws / times out).
 *     ANY HTTP response — including 4xx/5xx — proves the data path is reachable;
 *     a server error is not the user being offline.
 *  2. Hysteresis: go offline only after several CONSECUTIVE failures; return
 *     online on the very first success. Single blips never surface.
 *  3. Fast, adaptive polling: relaxed when healthy, quick to confirm a genuine
 *     drop, quick to recover. Native online/offline events kick an immediate
 *     re-check instead of being trusted blindly (mobile fires them spuriously).
 *  4. A generous timeout that tolerates real Ghanaian round-trips + cold starts.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Probe timeout — generous for high-latency links + Netlify function cold starts. */
const PROBE_TIMEOUT_MS = 8_000

/** Poll cadence while healthy. */
const POLL_HEALTHY_MS = 30_000

/** Poll cadence while offline — poll faster so recovery is snappy. */
const POLL_RECOVERY_MS = 6_000

/** Poll cadence while failures are accumulating but we're still marked online. */
const POLL_CONFIRM_MS = 2_000

/**
 * Consecutive failed probes required before declaring offline. With
 * POLL_CONFIRM_MS spacing this confirms a genuine outage in a few seconds while
 * absorbing isolated blips. Recovery (offline → online) needs just one success.
 */
const FAILURE_THRESHOLD = 3

// ---------------------------------------------------------------------------
// Reactive state (singleton outside React)
// ---------------------------------------------------------------------------

type NetworkListener = (online: boolean) => void

let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
let _consecutiveFailures = 0
const _listeners = new Set<NetworkListener>()

function setOnline(value: boolean) {
  if (_isOnline === value) return
  _isOnline = value
  console.log(`[NetworkStatus] ${value ? '🟢 Online' : '🔴 Offline'}`)
  _listeners.forEach(fn => fn(value))
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

function probeUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  // Check the app's ACTUAL data path — the Supabase proxy — not a direct
  // Supabase connection (direct connections time out from some regions, e.g.
  // Ghana → Ireland, which is the whole reason the proxy exists).
  return supabaseUrl
    ? `/.netlify/functions/supabase-proxy?_sbpath=${encodeURIComponent('/rest/v1/')}&limit=0`
    : 'https://httpbin.org/get'
}

function recordSuccess(): boolean {
  _consecutiveFailures = 0
  setOnline(true)
  return true
}

function recordFailure(): boolean {
  _consecutiveFailures += 1
  if (_consecutiveFailures >= FAILURE_THRESHOLD) {
    setOnline(false)
  }
  return _isOnline
}

/**
 * One connectivity probe. Resolves to the (possibly unchanged) online state.
 * Only a transport-level error counts as a failure; any HTTP status = reachable.
 */
async function probe(): Promise<boolean> {
  // If the browser is certain there's no radio, treat it as a failure without
  // burning a fetch — but still go through hysteresis so a spurious `offline`
  // event that self-corrects within a poll or two never surfaces.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return recordFailure()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    // We don't inspect the status: reaching the proxy at all (200, 401, 404,
    // 500, …) proves the network path works. Only a throw/abort means offline.
    await fetch(probeUrl(), { method: 'GET', signal: controller.signal, cache: 'no-store' })
    return recordSuccess()
  } catch {
    return recordFailure()
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Adaptive polling loop
// ---------------------------------------------------------------------------

let loopTimer: ReturnType<typeof setTimeout> | null = null
let started = false

function nextDelay(): number {
  if (!_isOnline) return POLL_RECOVERY_MS          // offline: recover fast
  if (_consecutiveFailures > 0) return POLL_CONFIRM_MS // wobbling: confirm fast
  return POLL_HEALTHY_MS                            // healthy: relax
}

function schedule() {
  if (loopTimer) clearTimeout(loopTimer)
  loopTimer = setTimeout(tick, nextDelay())
}

async function tick() {
  await probe()
  schedule()
}

/** Run a probe now (cancels the pending scheduled one and reschedules). */
function probeNow() {
  if (loopTimer) clearTimeout(loopTimer)
  tick()
}

function start() {
  if (started) return
  started = true
  tick()
}

// ---------------------------------------------------------------------------
// Browser event listeners + startup
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  // Don't trust native events blindly — they're noisy on mobile. Use them only
  // to trigger an immediate re-check; the hysteresis above decides the outcome.
  window.addEventListener('online', () => {
    _consecutiveFailures = 0 // give recovery a clean slate
    probeNow()
  })
  window.addEventListener('offline', probeNow)
  start()
}

// ---------------------------------------------------------------------------
// Imperative API
// ---------------------------------------------------------------------------

/** Current online status. */
export function getNetworkOnline(): boolean {
  return _isOnline
}

/** Subscribe to status changes. Returns an unsubscribe function. */
export function onNetworkChange(listener: NetworkListener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

/** Force a connectivity check right now and return the resulting state. */
export async function checkConnectivity(): Promise<boolean> {
  if (loopTimer) clearTimeout(loopTimer)
  const result = await probe()
  schedule()
  return result
}

/**
 * Let real, known-successful traffic mark us online instantly (e.g. a live
 * Supabase query that just returned). Piggybacking on real requests means the
 * flag reflects actual reachability without waiting for the next probe.
 */
export function reportReachable(): void {
  if (!_isOnline || _consecutiveFailures > 0) recordSuccess()
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface NetworkState {
  isOnline: boolean
  /** Trigger a manual connectivity check. */
  checkNow: () => Promise<boolean>
}

/**
 * Reactive online/offline status.
 *
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
    // Sync with current global state in case it changed before mount.
    setIsOnline(_isOnline)
    return () => {
      mountedRef.current = false
      unsub()
    }
  }, [])

  const checkNow = useCallback(async () => {
    const result = await checkConnectivity()
    if (mountedRef.current) setIsOnline(result)
    return result
  }, [])

  return { isOnline, checkNow }
}
