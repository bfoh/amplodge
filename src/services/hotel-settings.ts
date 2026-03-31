import { blink } from '@/blink/client'

export interface HotelSettings {
  id: string
  name: string
  address: string
  phone: string
  email: string
  website: string
  logoUrl?: string
  taxRate: number
  currency: string
  // Manager notification settings
  managerEmail?: string
  managerPhone?: string
  managerNotificationsEnabled?: boolean
  createdAt: string
  updatedAt: string
}

// Default settings used when database table doesn't exist
const DEFAULT_SETTINGS: HotelSettings = {
  id: 'hotel-settings-amp-lodge',
  name: 'AMP Lodge',
  address: 'AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana',
  phone: '+233 55 500 9697',
  email: 'info@amplodge.org',
  website: 'https://amplodge.org',
  logoUrl: '/amp.png',
  taxRate: 0.10,
  currency: 'GHS',
  // Manager defaults - can be configured in settings
  managerEmail: 'manager@amplodge.org',
  managerPhone: '+233248171409',
  managerNotificationsEnabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

export class HotelSettingsService {
  private static instance: HotelSettingsService
  private settings: HotelSettings | null = null
  private db = blink.db as any
  private tableCheckDone = false
  private tableExists = false

  static getInstance(): HotelSettingsService {
    if (!HotelSettingsService.instance) {
      HotelSettingsService.instance = new HotelSettingsService()
    }
    return HotelSettingsService.instance
  }

  async getHotelSettings(): Promise<HotelSettings> {
    // Return cached settings if available
    if (this.settings) {
      return this.settings
    }

    // If we already checked and table doesn't exist, use defaults silently
    if (this.tableCheckDone && !this.tableExists) {
      this.settings = DEFAULT_SETTINGS
      return this.settings
    }

    try {
      // Only log on first attempt
      if (!this.tableCheckDone) {
        console.log('🏨 [HotelSettings] Loading hotel settings from database...')
      }

      // Try to get existing settings (with error handling for missing table)
      let existingSettings = []
      try {
        existingSettings = await this.db.hotelSettings?.list({ limit: 1 }) || []
        this.tableExists = true
      } catch (tableError: any) {
        this.tableCheckDone = true
        this.tableExists = false
        // Only log once
        console.log('🏨 [HotelSettings] Using default AMP Lodge settings (database table not configured)')
        this.settings = DEFAULT_SETTINGS
        return this.settings
      }

      this.tableCheckDone = true

      if (existingSettings && existingSettings.length > 0) {
        this.settings = existingSettings[0]
        console.log('✅ [HotelSettings] Loaded settings:', this.settings.name)
        return this.settings
      }

      // No settings in table, try to create default
      try {
        await this.db.hotelSettings?.create(DEFAULT_SETTINGS)
        console.log('✅ [HotelSettings] Created default settings')
      } catch (createError: any) {
        // Silently use defaults if create fails
      }

      this.settings = DEFAULT_SETTINGS
      return this.settings

    } catch (error: any) {
      // Use fallback settings silently
      this.settings = DEFAULT_SETTINGS
      this.tableCheckDone = true
      return this.settings
    }
  }

  async updateHotelSettings(updates: Partial<HotelSettings>): Promise<HotelSettings> {
    try {
      console.log('🏨 [HotelSettings] Updating hotel settings...', updates)

      const currentSettings = await this.getHotelSettings()

      // Determine the ID to use. If current is fallback, switch to standard ID
      const settingsId = currentSettings.id === 'fallback-settings'
        ? 'hotel-settings-amp-lodge'
        : currentSettings.id

      const updatedSettings = {
        ...currentSettings,
        ...updates,
        id: settingsId, // Ensure ID is correct
        updatedAt: new Date().toISOString()
      }

      try {
        // Try update first
        await this.db.hotelSettings?.update(settingsId, updatedSettings)
      } catch (updateError: any) {
        console.warn('⚠️ [HotelSettings] Update failed, trying create/upsert...', updateError.message)

        // If update fails (e.g. 404 Not Found), try create
        try {
          await this.db.hotelSettings?.create(updatedSettings)
          console.log('✅ [HotelSettings] Created new settings record')
        } catch (createError: any) {
          // If create fails because it already exists (race condition or 409), 
          // try update one last time or throw
          if (createError.status === 409 || createError.message?.includes('Constraint violation')) {
            console.log('ℹ️ [HotelSettings] Record exists (409), retrying update...')
            await this.db.hotelSettings?.update(settingsId, updatedSettings)
          } else {
            throw createError
          }
        }
      }

      this.settings = updatedSettings

      console.log('✅ [HotelSettings] Settings updated successfully')
      return updatedSettings

    } catch (error: any) {
      console.error('❌ [HotelSettings] Failed to update settings:', error)
      throw new Error(`Failed to update hotel settings: ${error.message}`)
    }
  }

  async refreshSettings(): Promise<void> {
    this.settings = null
    await this.getHotelSettings()
  }

  getCachedSettings(): HotelSettings | null {
    return this.settings
  }
}

// Export singleton instance
export const hotelSettingsService = HotelSettingsService.getInstance()
