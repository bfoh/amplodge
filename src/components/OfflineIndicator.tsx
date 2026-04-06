/**
 * OfflineIndicator — Banner shown when the app is offline
 *
 * Appears at the top of the staff portal when connectivity is lost.
 * Shows pending sync count and allows manual retry of failed items.
 */

import { useState, useEffect } from 'react'
import { WifiOff, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useNetworkStatus } from '@/lib/network-status'
import { onSyncStateChange, retryFailed, type SyncState } from '@/lib/sync-queue'
import { cn } from '@/lib/utils'

export function OfflineIndicator() {
  const { isOnline } = useNetworkStatus()
  const [syncState, setSyncState] = useState<SyncState>({
    status: 'idle',
    pendingCount: 0,
    failedCount: 0,
    lastSyncedAt: null,
  })
  const [isRetrying, setIsRetrying] = useState(false)

  useEffect(() => {
    const unsub = onSyncStateChange(setSyncState)
    return unsub
  }, [])

  const handleRetry = async () => {
    setIsRetrying(true)
    try {
      await retryFailed()
    } finally {
      setIsRetrying(false)
    }
  }

  // Don't show anything when online with no pending changes
  if (isOnline && syncState.pendingCount === 0 && syncState.failedCount === 0 && syncState.status !== 'syncing') {
    return null
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-2 text-sm transition-all duration-300',
        !isOnline
          ? 'bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400'
          : syncState.status === 'syncing'
          ? 'bg-blue-500/10 border-b border-blue-500/20 text-blue-700 dark:text-blue-400'
          : syncState.status === 'error'
          ? 'bg-red-500/10 border-b border-red-500/20 text-red-700 dark:text-red-400'
          : 'bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
      )}
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium">Offline Mode</span>
            <span className="text-xs opacity-75">
              — Changes will sync when reconnected
              {syncState.pendingCount > 0 && (
                <> · {syncState.pendingCount} pending</>
              )}
            </span>
          </>
        ) : syncState.status === 'syncing' ? (
          <>
            <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" />
            <span className="font-medium">Syncing...</span>
            <span className="text-xs opacity-75">
              {syncState.currentMessage || `${syncState.pendingCount} changes remaining`}
            </span>
          </>
        ) : syncState.status === 'error' ? (
          <>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium">{syncState.failedCount} failed to sync</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium">All changes synced</span>
          </>
        )}
      </div>

      {syncState.failedCount > 0 && isOnline && (
        <button
          onClick={handleRetry}
          disabled={isRetrying}
          className={cn(
            'text-xs font-medium px-3 py-1 rounded-md transition-colors',
            'bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50'
          )}
        >
          {isRetrying ? 'Retrying...' : 'Retry failed'}
        </button>
      )}
    </div>
  )
}
