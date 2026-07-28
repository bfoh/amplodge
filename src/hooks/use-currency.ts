import { useState, useEffect } from 'react'
import { hotelSettingsService } from '@/services/hotel-settings'
import { onTableUpdated } from '@/lib/db'

/**
 * Hook to get and use the current hotel currency throughout the app.
 *
 * Event-driven, no polling: same-tab changes arrive via the
 * 'hotel-settings-changed' CustomEvent fired by updateHotelSettings; changes
 * from other devices arrive via the hotel_settings realtime/SWR subscription.
 * (The old version polled Supabase every 5s from every mounted consumer —
 * a constant network drain, brutal on slow connections.)
 */
export function useCurrency() {
  const [currency, setCurrency] = useState<string>('GHS')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadCurrency = async () => {
      try {
        const settings = await hotelSettingsService.getHotelSettings()
        if (!cancelled) setCurrency(settings.currency || 'GHS')
      } catch (error) {
        console.error('Failed to load currency:', error)
        if (!cancelled) setCurrency('GHS')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadCurrency()

    // Same-tab: Settings page saved new settings.
    const onLocalChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.currency) setCurrency(detail.currency)
    }
    window.addEventListener('hotel-settings-changed', onLocalChange)

    // Cross-device: hotel_settings changed elsewhere (realtime / SWR refresh).
    const unsubscribe = onTableUpdated('hotel_settings', () => {
      hotelSettingsService.refreshSettings().then(() => {
        const cached = hotelSettingsService.getCachedSettings()
        if (!cancelled && cached?.currency) setCurrency(cached.currency)
      }).catch(() => {})
    })

    return () => {
      cancelled = true
      window.removeEventListener('hotel-settings-changed', onLocalChange)
      unsubscribe()
    }
  }, [])

  return { currency, loading }
}
