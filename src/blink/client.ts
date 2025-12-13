import { createClient } from '@blinkdotnew/sdk'

// Main client for authentication operations (headless mode)
export const blink = createClient({
  projectId: 'amp-lodge-hotel-management-system-j2674r7k',
  authRequired: false,
  auth: {
    mode: 'headless'
  }
})

// Managed client for operations that need managed mode
export const blinkManaged = createClient({
  projectId: 'amp-lodge-hotel-management-system-j2674r7k',
  authRequired: false,
  auth: {
    mode: 'managed'
  }
})
