import { useState, useEffect } from 'react'
import { hotelSettingsService } from '@/services/hotel-settings'

/**
 * Hook to get and use the current hotel currency throughout the app
 * Automatically updates when currency changes in settings
 */
export function useCurrency() {
  const [currency, setCurrency] = useState<string>('GHS')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadCurrency = async () => {
      try {
        const settings = await hotelSettingsService.getHotelSettings()
        setCurrency(settings.currency || 'GHS')
      } catch (error) {
        console.error('Failed to load currency:', error)
        setCurrency('GHS')
      } finally {
        setLoading(false)
      }
    }

    loadCurrency()

    // Refresh currency periodically to catch changes
    const interval = setInterval(() => {
      hotelSettingsService.refreshSettings().then(() => {
        const cached = hotelSettingsService.getCachedSettings()
        if (cached?.currency) {
          setCurrency(cached.currency)
        }
      }).catch(() => {
        // Ignore errors on refresh
      })
    }, 5000) // Check every 5 seconds

    return () => clearInterval(interval)
  }, [])

  return { currency, loading }
}

