/**
 * Shared rotation logic for the staff clock-in QR code.
 *
 * Fetches a fresh server-signed (HMAC) token via the admin-only
 * `get_clock_token` RPC, counts down to expiry, and rotates ~2s before the
 * window closes. On failure it retries with exponential backoff (3s, 6s,
 * 12s … capped at 30s) and the countdown then tracks the next retry.
 *
 * Used by the HR page QR panel and the dedicated /staff/qr-display kiosk.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getClockToken } from '@/services/attendance-service'

export function useClockToken() {
  const [token, setToken] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [windowSecs, setWindowSecs] = useState(60)
  const [error, setError] = useState<string | null>(null)
  const secondsRef = useRef(0)
  const fetchingRef = useRef(false)
  const attemptRef = useRef(0)

  const fetchToken = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const res = await getClockToken()
      if ('error' in res) {
        setError(
          res.error === 'not_admin'
            ? 'Admin access required to display the clock-in code.'
            : 'Could not fetch a clock-in code — retrying…'
        )
        attemptRef.current += 1
        const wait = Math.min(30, 3 * 2 ** (attemptRef.current - 1))
        secondsRef.current = wait
        setSecondsLeft(wait)
      } else {
        attemptRef.current = 0
        setError(null)
        setToken(res.token)
        setWindowSecs(res.expiresIn)
        secondsRef.current = res.expiresIn
        setSecondsLeft(res.expiresIn)
      }
    } finally {
      fetchingRef.current = false
    }
  }, [])

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

  return { token, secondsLeft, windowSecs, error }
}
