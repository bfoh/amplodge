import { useEffect, useState } from 'react'
import { getCurrentAttendanceState } from '@/services/attendance-service'

/**
 * Is the currently authenticated staff member actually clocked in right now?
 * Backed by getCurrentAttendanceState(), which is RLS-scoped to the caller —
 * so this always reflects whoever the browser is currently authenticated as,
 * not necessarily whoever is physically at the keyboard. Used to nudge
 * "you're not clocked in — is this really your session?" at the moments
 * that matter most (booking/check-in/check-out), without ever blocking.
 */
export function useClockStatus() {
  const [isClockedIn, setIsClockedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    getCurrentAttendanceState()
      .then((state) => { if (!cancelled) setIsClockedIn(!!state.open) })
      .catch(() => { if (!cancelled) setIsClockedIn(null) })
    return () => { cancelled = true }
  }, [])

  return { isClockedIn }
}
