import { blink } from '@/blink/client'

export async function forceResetGuests() {
  if (sessionStorage.getItem('guests_cleared')) return

  try {
    console.log('🚨 FORCE RESET: Clearing guest database...')
    const db = blink.db as any
    let deletedCount = 0
    let hasMore = true

    while (hasMore) {
      const guests = await db.guests.list({ limit: 100 })
      if (!guests || guests.length === 0) {
        hasMore = false
        break
      }

      console.log(`Found ${guests.length} guests to delete...`)
      for (const guest of guests) {
        await db.guests.delete(guest.id)
        deletedCount++
      }
    }

    console.log(`✅ FORCE RESET COMPLETE: Deleted ${deletedCount} guests`)
    sessionStorage.setItem('guests_cleared', 'true')
    
    if (deletedCount > 0) {
      alert(`System Cleaned: ${deletedCount} guest records have been deleted.`)
      window.location.reload() // Reload to update UI counters
    }
  } catch (error) {
    console.error('❌ Force reset failed:', error)
  }
}

