import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { hotelSettingsService } from '@/services/hotel-settings'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency using hotel settings currency (defaults to GHS)
 * This function now uses the hotel's preferred currency instead of hardcoded USD
 * For backward compatibility, it still works with all existing formatUSD calls
 */
export function formatUSD(value: number | string): string {
  return formatCurrencySync(value)
}

/**
 * Format currency using the hotel's preferred currency from settings
 * Falls back to USD if settings are not available
 */
export async function formatCurrency(value: number | string, currency?: string): Promise<string> {
  const n = Number(value)
  if (!isFinite(n)) {
    const defaultCurrency = currency || 'USD'
    return getCurrencySymbol(defaultCurrency) + '0.00'
  }

  try {
    // Get currency from hotel settings if not provided
    let selectedCurrency = currency
    if (!selectedCurrency) {
      try {
        const settings = await hotelSettingsService.getHotelSettings()
        selectedCurrency = settings.currency || 'USD'
      } catch {
        selectedCurrency = 'USD'
      }
    }

    // Format based on currency
    const locale = getCurrencyLocale(selectedCurrency)
    return new Intl.NumberFormat(locale, { 
      style: 'currency', 
      currency: selectedCurrency 
    }).format(n)
  } catch {
    // Fallback formatting
    const defaultCurrency = currency || 'USD'
    return getCurrencySymbol(defaultCurrency) + n.toFixed(2)
  }
}

/**
 * Format currency synchronously using cached settings or provided currency
 * Use this for components that can't use async
 */
export function formatCurrencySync(value: number | string, currency?: string): string {
  const n = Number(value)
  if (!isFinite(n)) {
    const defaultCurrency = currency || 'USD'
    return getCurrencySymbol(defaultCurrency) + '0.00'
  }

  try {
    const selectedCurrency = currency || getCachedCurrency() || 'USD'
    const locale = getCurrencyLocale(selectedCurrency)
    return new Intl.NumberFormat(locale, { 
      style: 'currency', 
      currency: selectedCurrency 
    }).format(n)
  } catch {
    const defaultCurrency = currency || 'USD'
    return getCurrencySymbol(defaultCurrency) + n.toFixed(2)
  }
}

/**
 * Get currency symbol for a given currency code
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'GHS': '₵',
  }
  return symbols[currency] || currency + ' '
}

/**
 * Get appropriate locale for currency formatting
 */
function getCurrencyLocale(currency: string): string {
  const locales: Record<string, string> = {
    'USD': 'en-US',
    'EUR': 'en-EU',
    'GBP': 'en-GB',
    'GHS': 'en-GH',
  }
  return locales[currency] || 'en-US'
}

/**
 * Get cached currency from hotel settings (synchronous)
 */
function getCachedCurrency(): string | null {
  try {
    const cached = hotelSettingsService.getCachedSettings()
    return cached?.currency || null
  } catch {
    return null
  }
}
