import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '@/lib/db'

// Shared front-desk terminals are the whole reason this exists: a staff
// member finishes a shift, forgets to log out, and the next person just
// keeps working inside their session — every booking/check-in/charge then
// gets attributed to the wrong staff member. 15 minutes of no interaction
// forces a fresh login, closing that window without interrupting normal
// front-desk pauses (a phone call, helping a guest at the door, etc).
const IDLE_TIMEOUT_MS = 15 * 60 * 1000
const WARNING_LEAD_MS = 2 * 60 * 1000 // warn at 13 minutes idle, log out at 15
const ACTIVITY_THROTTLE_MS = 1000 // don't reset timers on every single mousemove pixel

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const

export function useIdleLogout() {
  const [showWarning, setShowWarning] = useState(false)
  const [secondsRemaining, setSecondsRemaining] = useState(Math.floor(WARNING_LEAD_MS / 1000))
  const navigate = useNavigate()

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const countdownRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const lastResetRef = useRef(0)

  const clearAllTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current)
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  const logoutNow = useCallback(async () => {
    clearAllTimers()
    setShowWarning(false)
    try {
      await auth.logout()
    } catch {
      // Proceed to the login screen regardless — a failed remote sign-out
      // shouldn't leave a shared terminal stuck mid-page.
    }
    navigate('/staff/login', { replace: true })
  }, [clearAllTimers, navigate])

  const resetTimer = useCallback(() => {
    clearAllTimers()
    setShowWarning(false)
    setSecondsRemaining(Math.floor(WARNING_LEAD_MS / 1000))

    warnTimerRef.current = setTimeout(() => {
      setShowWarning(true)
      let remaining = Math.floor(WARNING_LEAD_MS / 1000)
      countdownRef.current = setInterval(() => {
        remaining -= 1
        setSecondsRemaining(Math.max(0, remaining))
        if (remaining <= 0 && countdownRef.current) clearInterval(countdownRef.current)
      }, 1000)
    }, IDLE_TIMEOUT_MS - WARNING_LEAD_MS)

    logoutTimerRef.current = setTimeout(logoutNow, IDLE_TIMEOUT_MS)
  }, [clearAllTimers, logoutNow])

  useEffect(() => {
    resetTimer()

    const handleActivity = () => {
      const now = Date.now()
      if (now - lastResetRef.current < ACTIVITY_THROTTLE_MS) return
      lastResetRef.current = now
      resetTimer()
    }

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }))
    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, handleActivity))
      clearAllTimers()
    }
    // Intentionally run once on mount — resetTimer/clearAllTimers are stable
    // via useCallback, and re-subscribing on every render would thrash the
    // event listeners for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Called by the "Stay signed in" button — any real activity already does this too. */
  const stayLoggedIn = resetTimer

  return { showWarning, secondsRemaining, stayLoggedIn, logoutNow }
}
