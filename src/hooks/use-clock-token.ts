/**
 * Shared rotation logic for the staff clock-in QR code.
 *
 * Fetches a fresh server-signed (HMAC) token via the admin-only
 * `get_clock_token` RPC, counts down to expiry, and rotates ~2s before the
 * window closes. On failure it retries with exponential backoff (3s, 6s,
 * 12s … capped at 30s) and the countdown then tracks the next retry.
 *
 * Failure surfacing:
 * - `error` is a short user-facing line; `detail` is the raw cause
 *   (PostgREST message) for diagnostics.
 * - `failures` counts consecutive failures so UIs can escalate messaging.
 * - After ~90s of continuous failure the stale QR is hidden — a displayed
 *   code that the server will reject is worse than no code.
 *
 * Used by the HR page QR panel and the dedicated /staff/qr-display kiosk.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getClockToken, mintClockNonceKiosk } from '@/services/attendance-service'

const HIDE_STALE_AFTER_MS = 90_000

/** Optional device-scoped kiosk credential. When supplied the hook mints via
 *  the anon kiosk RPC (no admin session needed); otherwise it uses the
 *  admin-only mint. */
export interface KioskCreds {
  id: string
  key: string
}

function messageFor(error: string): string {
  switch (error) {
    case 'not_admin':
      return 'Admin access required to display the clock-in code.'
    case 'permission_denied':
      return 'Server setup incomplete — the database is missing execute grants for clock-in functions. Apply the grants-fix migration (20260723) in the Supabase SQL editor.'
    case 'not_authenticated':
      return 'Session expired — please log out and log in again.'
    case 'bad_kiosk':
      return 'This kiosk is not registered or has been revoked. Re-provision it from HR → Kiosks.'
    default:
      return 'Could not fetch a clock-in code — retrying…'
  }
}

export function useClockToken(kioskCreds?: KioskCreds | null) {
  const [token, setToken] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [windowSecs, setWindowSecs] = useState(60)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [failures, setFailures] = useState(0)
  const secondsRef = useRef(0)
  const fetchingRef = useRef(false)
  const attemptRef = useRef(0)
  const failedSinceRef = useRef<number | null>(null)

  const fetchToken = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const res = kioskCreds
        ? await mintClockNonceKiosk(kioskCreds.id, kioskCreds.key)
        : await getClockToken()
      if ('error' in res) {
        if (failedSinceRef.current === null) failedSinceRef.current = Date.now()
        setError(messageFor(res.error))
        setDetail(res.detail ?? res.error)
        setFailures(++attemptRef.current)
        const wait = Math.min(30, 3 * 2 ** (attemptRef.current - 1))
        secondsRef.current = wait
        setSecondsLeft(wait)
        // A hard setup failure (missing grants) won't heal by retrying, and a
        // long-dead QR must not stay scannable — hide it after 90s of failure.
        if (Date.now() - failedSinceRef.current > HIDE_STALE_AFTER_MS) {
          setToken(null)
        }
      } else {
        attemptRef.current = 0
        failedSinceRef.current = null
        setError(null)
        setDetail(null)
        setFailures(0)
        setToken(res.token)
        setWindowSecs(res.expiresIn)
        secondsRef.current = res.expiresIn
        setSecondsLeft(res.expiresIn)
      }
    } finally {
      fetchingRef.current = false
    }
  }, [kioskCreds])

  useEffect(() => {
    fetchToken()
    const id = setInterval(() => {
      secondsRef.current -= 1
      if (secondsRef.current <= 2) {
        fetchToken() // rotate (or retry) when ~2s remain
        if (secondsRef.current <= 0) secondsRef.current = 0
      }
      setSecondsLeft(Math.max(0, secondsRef.current))
    }, 1000)
    return () => clearInterval(id)
  }, [fetchToken])

  return { token, secondsLeft, windowSecs, error, detail, failures }
}
