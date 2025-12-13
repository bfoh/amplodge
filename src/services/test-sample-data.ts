import { blink } from '../blink/client'

/**
 * Test if sample data exists and create it if missing
 * SKIPS in production to avoid seeding test data
 */
export async function testAndCreateSampleData() {
  // Skip in production - don't seed test data
  if (import.meta.env.PROD) {
    console.log('🔒 Production mode: Skipping sample data seeding')
    return { success: true, roomTypes: 0, properties: 0, rooms: 0 }
  }
  
  try {
    console.log('🧪 Testing sample data...')
    
    const db = (blink.db as any)
    
    // Check if we have room types
    const roomTypes = await db.roomTypes.list()
    console.log(`📊 Found ${roomTypes.length} room types:`, roomTypes.map((rt: any) => rt.name))
    
    // Check if we have properties
    const properties = await db.properties.list()
    console.log(`📊 Found ${properties.length} properties:`, properties.map((p: any) => `${p.name} (${p.roomNumber})`))
    
    // Check if we have rooms
    const rooms = await db.rooms.list()
    console.log(`📊 Found ${rooms.length} rooms:`, rooms.map((r: any) => r.roomNumber))
    
    // If no data exists, create it
    if (roomTypes.length === 0 || properties.length === 0) {
      console.log('⚠️ Missing sample data, creating...')
      
      // Create a simple room type
      const roomType = {
        id: 'room_type_standard',
        name: 'Standard Room',
        description: 'Comfortable room with essential amenities',
        basePrice: 80,
        maxOccupancy: 2,
        amenities: JSON.stringify(['Wi-Fi', 'TV', 'Air Conditioning']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      
      try {
        await db.roomTypes.create(roomType)
        console.log('✅ Created room type: Standard Room')
      } catch (error: any) {
        if (error.status === 409) {
          console.log('ℹ️ Room type already exists')
        } else {
          console.error('❌ Failed to create room type:', error.message)
        }
      }
      
      // Create a simple property
      const property = {
        id: 'prop_101',
        name: 'Room 101',
        roomNumber: '101',
        address: 'First Floor',
        propertyTypeId: 'room_type_standard',
        bedrooms: 1,
        bathrooms: 1,
        maxGuests: 2,
        basePrice: 80,
        description: 'Standard room',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      
      try {
        await db.properties.create(property)
        console.log('✅ Created property: Room 101')
      } catch (error: any) {
        if (error.status === 409) {
          console.log('ℹ️ Property already exists')
        } else {
          console.error('❌ Failed to create property:', error.message)
        }
      }
      
      // Create corresponding room record
      const room = {
        id: 'room_101',
        roomNumber: '101',
        roomTypeId: 'room_type_standard',
        status: 'available',
        price: 80,
        imageUrls: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      
      try {
        await db.rooms.create(room)
        console.log('✅ Created room record: 101')
      } catch (error: any) {
        if (error.status === 409) {
          console.log('ℹ️ Room already exists')
        } else {
          console.error('❌ Failed to create room:', error.message)
        }
      }
    }
    
    console.log('✅ Sample data test completed')
    return { success: true, roomTypes: roomTypes.length, properties: properties.length, rooms: rooms.length }
    
  } catch (error) {
    console.error('❌ Sample data test failed:', error)
    return { success: false, error }
  }
}
