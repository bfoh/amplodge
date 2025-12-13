import { useEffect, useState } from 'react'
import { bookingEngine } from '@/services/booking-engine'
import { AlertCircle, CheckCircle, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function OfflineStatusBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [pendingSyncs, setPendingSyncs] = useState(0)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Subscribe to sync status changes
    const unsubscribe = bookingEngine.onSyncStatusChange((status, message) => {
      setSyncStatus(status)
      setSyncMessage(message || '')
      
      if (status === 'synced') {
        setTimeout(() => setSyncStatus('idle'), 3000)
      }
    })

    // Check pending syncs periodically
    const checkPending = async () => {
      const pending = await bookingEngine.getPendingSyncBookings()
      setPendingSyncs(pending.length)
    }
    
    checkPending()
    const interval = setInterval(checkPending, 5000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsubscribe()
      clearInterval(interval)
    }
  }, [])

  const handleManualSync = async () => {
    try {
      await bookingEngine.syncWithRemote()
    } catch (error) {
      console.error('Manual sync failed:', error)
    }
  }

  if (isOnline && syncStatus === 'idle' && pendingSyncs === 0) {
    return null
  }

  return (
    <div className="fixed top-20 left-0 right-0 z-50 px-4">
      <div className="max-w-5xl mx-auto">
        {!isOnline && (
          <Alert className="bg-orange-50 border-orange-200 mb-2">
            <WifiOff className="h-4 w-4 text-orange-600" />
            <AlertDescription className="flex items-center justify-between">
              <span className="text-orange-800 font-medium">
                Offline Mode — Bookings will be saved locally and synced when online
              </span>
            </AlertDescription>
          </Alert>
        )}

        {isOnline && pendingSyncs > 0 && (
          <Alert className="bg-blue-50 border-blue-200 mb-2">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="flex items-center justify-between">
              <span className="text-blue-800">
                {pendingSyncs} booking{pendingSyncs > 1 ? 's' : ''} pending sync
              </span>
              <button
                onClick={handleManualSync}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium text-sm"
                disabled={syncStatus === 'syncing'}
              >
                <RefreshCw className={`h-3 w-3 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                Sync Now
              </button>
            </AlertDescription>
          </Alert>
        )}

        {syncStatus === 'syncing' && (
          <Alert className="bg-blue-50 border-blue-200 mb-2">
            <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />
            <AlertDescription className="text-blue-800">
              {syncMessage || 'Syncing...'}
            </AlertDescription>
          </Alert>
        )}

        {syncStatus === 'synced' && (
          <Alert className="bg-green-50 border-green-200 mb-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="flex items-center gap-2 text-green-800">
              <Wifi className="h-4 w-4" />
              {syncMessage || 'All bookings synced'}
            </AlertDescription>
          </Alert>
        )}

        {syncStatus === 'error' && (
          <Alert className="bg-red-50 border-red-200 mb-2">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {syncMessage || 'Sync error occurred'}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  )
}
