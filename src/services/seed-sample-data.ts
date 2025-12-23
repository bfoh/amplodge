import { blink } from '../blink/client'

/**
 * @deprecated This file is LEGACY code from the Blink era.
 * After migrating to Supabase, seeding should be done via Supabase or disabled.
 * This file is retained for reference only.
 * 
 * Seed sample room types and properties for AMP Lodge
 * This ensures the booking system has data to work with
 * SKIPS in production - only runs in development
 */
export async function seedSampleData() {
  // Skip seeding in production - production should use real data
  if (import.meta.env.PROD) {
    console.log('🔒 Production mode: Skipping sample data seeding')
    return { success: true, skipped: true }
  }

  try {
    console.log('🌱 Seeding sample data...')
    console.warn('⚠️ DEPRECATED: seed-sample-data.ts is legacy code from Blink era.')

    const db = (blink.db as any)

    // Check if we need to log out first (in case seed ran while another user was logged in)
    const currentAuthUser = await blink.auth.me()
    const wasAlreadyLoggedIn = !!currentAuthUser

    // DEPRECATED: Admin login for seeding removed - use Supabase Auth
    if (!currentAuthUser) {
      console.warn('⚠️ Not logged in. Seeding requires authentication via Supabase Auth.')
    }

    // Seed room types
    const roomTypes = [
      {
        id: 'room_type_standard',
        name: 'Standard Room',
        description: 'Comfortable room with essential amenities',
        basePrice: 100,
        maxOccupancy: 2,
        amenities: JSON.stringify(['Wi-Fi', 'TV', 'Air Conditioning', 'Private Bathroom']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'room_type_executive',
        name: 'Executive Suite',
        description: 'Premium accommodation with extra space and luxury features',
        basePrice: 250,
        maxOccupancy: 2,
        amenities: JSON.stringify(['Wi-Fi', 'TV', 'Air Conditioning', 'Private Bathroom', 'Mini Bar', 'Living Room', 'Work Desk']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'room_type_deluxe',
        name: 'Deluxe Room',
        description: 'Spacious room with premium amenities',
        basePrice: 150,
        maxOccupancy: 2,
        amenities: JSON.stringify(['Wi-Fi', 'TV', 'Air Conditioning', 'Private Bathroom', 'Mini Bar', 'Balcony']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'room_type_family',
        name: 'Family Room',
        description: 'Ideal for families with extra space',
        basePrice: 200,
        maxOccupancy: 4,
        amenities: JSON.stringify(['Wi-Fi', 'TV', 'Air Conditioning', 'Private Bathroom', 'Mini Bar', 'Balcony', 'Living Room', 'Kitchenette']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'room_type_presidential',
        name: 'Presidential Suite',
        description: 'Our most luxurious accommodation with exclusive amenities and premium services',
        basePrice: 500,
        maxOccupancy: 5,
        amenities: JSON.stringify(['Wi-Fi', 'TV', 'Air Conditioning', 'Private Bathroom', 'Mini Bar', 'Balcony', 'Living Room', 'Kitchenette', 'Private Dining', 'Butler Service', 'Jacuzzi']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]

    // Check existing room types
    const existingRoomTypes = await db.roomTypes.list()
    console.log(`📊 Found ${existingRoomTypes.length} existing room types`)

    // Create room types if they don't exist
    for (const roomType of roomTypes) {
      const exists = existingRoomTypes.some((rt: any) => rt.id === roomType.id)
      if (!exists) {
        try {
          await db.roomTypes.create(roomType)
          console.log(`✅ Created room type: ${roomType.name}`)
        } catch (error: any) {
          if (error.status === 409 || error.message?.includes('Constraint violation')) {
            console.log(`ℹ️ Room type ${roomType.name} already exists`)
          } else {
            console.error(`❌ Failed to create room type ${roomType.name}:`, error.message)
          }
        }
      } else {
        console.log(`ℹ️ Room type ${roomType.name} already exists`)
      }
    }

    // Seed properties (rooms)
    const properties = [
      {
        id: 'prop_101',
        name: 'Room 101',
        roomNumber: '101',
        address: 'First Floor, North Wing',
        propertyTypeId: 'room_type_standard',
        bedrooms: 1,
        bathrooms: 1,
        maxGuests: 2,
        basePrice: 100,
        description: 'Standard room with city view',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'prop_102',
        name: 'Room 102',
        roomNumber: '102',
        address: 'First Floor, North Wing',
        propertyTypeId: 'room_type_standard',
        bedrooms: 1,
        bathrooms: 1,
        maxGuests: 2,
        basePrice: 100,
        description: 'Standard room with garden view',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'prop_201',
        name: 'Room 201',
        roomNumber: '201',
        address: 'Second Floor, South Wing',
        propertyTypeId: 'room_type_deluxe',
        bedrooms: 1,
        bathrooms: 1,
        maxGuests: 2,
        basePrice: 150,
        description: 'Deluxe room with balcony',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'prop_202',
        name: 'Room 202',
        roomNumber: '202',
        address: 'Second Floor, South Wing',
        propertyTypeId: 'room_type_deluxe',
        bedrooms: 1,
        bathrooms: 1,
        maxGuests: 2,
        basePrice: 150,
        description: 'Deluxe room with mountain view',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'prop_301',
        name: 'Family Room 301',
        roomNumber: '301',
        address: 'Third Floor, East Wing',
        propertyTypeId: 'room_type_family',
        bedrooms: 2,
        bathrooms: 2,
        maxGuests: 4,
        basePrice: 200,
        description: 'Spacious family room with panoramic view',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]

    // Check existing properties
    const existingProperties = await db.properties.list()
    console.log(`📊 Found ${existingProperties.length} existing properties`)

    // Create properties if they don't exist
    for (const property of properties) {
      const exists = existingProperties.some((prop: any) => prop.id === property.id)
      if (!exists) {
        try {
          await db.properties.create(property)
          console.log(`✅ Created property: ${property.name}`)
        } catch (error: any) {
          if (error.status === 409 || error.message?.includes('Constraint violation')) {
            console.log(`ℹ️ Property ${property.name} already exists`)
          } else {
            console.error(`❌ Failed to create property ${property.name}:`, error.message)
          }
        }
      } else {
        console.log(`ℹ️ Property ${property.name} already exists`)
      }
    }

    // Create corresponding room records for bookings
    const existingRooms = await db.rooms.list()
    console.log(`📊 Found ${existingRooms.length} existing rooms`)

    for (const property of properties) {
      const exists = existingRooms.some((room: any) => room.roomNumber === property.roomNumber)
      if (!exists) {
        try {
          const room = {
            id: `room_${property.roomNumber}`,
            roomNumber: property.roomNumber,
            roomTypeId: property.propertyTypeId,
            status: 'available',
            price: property.basePrice,
            imageUrls: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
          await db.rooms.create(room)
          console.log(`✅ Created room record: ${property.roomNumber}`)
        } catch (error: any) {
          if (error.status === 409 || error.message?.includes('Constraint violation')) {
            console.log(`ℹ️ Room ${property.roomNumber} already exists`)
          } else {
            console.error(`❌ Failed to create room ${property.roomNumber}:`, error.message)
          }
        }
      } else {
        console.log(`ℹ️ Room ${property.roomNumber} already exists`)
      }
    }

    // Log out if we signed in just for seeding
    if (!wasAlreadyLoggedIn && currentAuthUser) {
      try {
        await blink.auth.logout()
        console.log('🔓 Logged out after seeding')
      } catch (error) {
        console.warn('⚠️ Could not log out after seeding')
      }
    }

    console.log('✅ Sample data seeding completed')
    return { success: true }

  } catch (error) {
    console.error('❌ Failed to seed sample data:', error)
    return { success: false, error }
  }
}
