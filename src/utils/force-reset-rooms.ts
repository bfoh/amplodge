import { db, auth } from '@/lib/db'

export async function forceResetRooms(): Promise<void> {
  if (typeof window === 'undefined') return
  if (sessionStorage.getItem('rooms_reset') === '1') return

  try {
    console.log('🧹 [ForceResetRooms] Resetting room and property statuses...')

    const rooms = await db.rooms.list({ limit: 1000 })
    let roomsUpdated = 0
    for (const room of rooms) {
      if (room.status !== 'available') {
        await db.rooms.update(room.id, { status: 'available' })
        roomsUpdated++
      }
    }

    const properties = await db.properties.list({ limit: 1000 }).catch(() => [])
    let propertiesUpdated = 0
    if (Array.isArray(properties)) {
      for (const property of properties) {
        if (property.status && property.status !== 'active') {
          await db.properties.update(property.id, { status: 'active' })
          propertiesUpdated++
        }
      }
    }

    console.log(`✅ [ForceResetRooms] Completed. Rooms updated: ${roomsUpdated}, properties updated: ${propertiesUpdated}`)
    sessionStorage.setItem('rooms_reset', '1')
  } catch (error) {
    console.warn('⚠️ [ForceResetRooms] Failed to reset room statuses:', error)
  }
}

