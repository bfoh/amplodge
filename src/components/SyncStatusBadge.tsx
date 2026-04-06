/**
 * SyncStatusBadge — Small badge showing sync state
 *
 * Designed to sit in the sidebar footer or header.
 * Shows a dot + label for connectivity and sync status.
 */

import { useState, useEffect } from 'react'
import { useNetworkStatus } from '@/lib/network-status'
import { onSyncStateChange, type SyncState } from '@/lib/sync-queue'
import { cn } from '@/lib/utils'

export function SyncStatusBadge() {
  const { isOnline } = useNetworkStatus()
  const [syncState, setSyncState] = useState<SyncState>({
    status: 'idle',
    pendingCount: 0,
    failedCount: 0,
    lastSyncedAt: null,
  })

  useEffect(() => {
    const unsub = onSyncStateChange(setSyncState)
    return unsub
  }, [])

  const dotColor = !isOnline
    ? 'bg-amber-500'
    : syncState.status === 'syncing'
    ? 'bg-blue-500 animate-pulse'
    : syncState.failedCount > 0
    ? 'bg-red-500'
    : 'bg-emerald-500'

  const label = !isOnline
    ? 'Offline'
    : syncState.status === 'syncing'
    ? 'Syncing...'
    : syncState.pendingCount > 0
    ? `${syncState.pendingCount} pending`
    : syncState.failedCount > 0
    ? `${syncState.failedCount} failed`
    : 'Online'

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', dotColor)} />
      <span className="truncate">{label}</span>
      {syncState.pendingCount > 0 && isOnline && (
        <span className="ml-auto text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
          {syncState.pendingCount}
        </span>
      )}
    </div>
  )
}
