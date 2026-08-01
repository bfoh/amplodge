import { AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useClockStatus } from '@/hooks/use-clock-status'
import { useStaffRole } from '@/hooks/use-staff-role'
import { auth } from '@/lib/db'
import { cn } from '@/lib/utils'

/**
 * Non-blocking nudge shown at booking/check-in/check-out action points when
 * the currently authenticated staff member isn't clocked in. Never disables
 * the underlying action — this is a soft reminder plus a one-click escape
 * hatch for the "wait, this isn't my session" moment.
 */
export function ClockStatusWarning({ className }: { className?: string }) {
  const { isClockedIn } = useClockStatus()
  const { staffRecord } = useStaffRole()
  const navigate = useNavigate()

  // null = still loading, true = clocked in — only render when we've
  // positively confirmed the staff member is NOT clocked in.
  if (isClockedIn !== false) return null

  const handleLogout = async () => {
    await auth.logout()
    navigate('/staff/login', { replace: true })
  }

  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800', className)}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>
        You're not clocked in — this will still be recorded under {staffRecord?.name ? `${staffRecord.name}'s` : 'your'} account.{' '}
        Not you?{' '}
        <button type="button" onClick={handleLogout} className="underline font-medium hover:text-amber-900">
          Log out
        </button>
      </span>
    </div>
  )
}
