import { blink } from './client'

/**
 * Database schema configuration for AMP Lodge Hotel Management System
 * This file ensures all required tables are properly defined and accessible
 */

export interface ActivityLogSchema {
  id: string
  action: string
  entityType: string
  entityId: string
  details: string // JSON string
  userId: string
  metadata: string // JSON string
  createdAt: string
}

export interface StaffSchema {
  id: string
  userId: string
  name: string
  email: string
  role: string
  createdAt: string
}

export interface BookingSchema {
  id: string
  userId: string | null
  guestId: string
  roomId: string
  checkIn: string
  checkOut: string
  status: string
  totalPrice: number
  numGuests: number
  specialRequests: string
}

export interface RoomSchema {
  id: string
  roomNumber: string
  roomTypeId: string
  status: string
  price: number
  imageUrls: string
}

export interface RoomTypeSchema {
  id: string
  name: string
  description: string
  basePrice: number
  maxOccupancy: number
  amenities: string // JSON string
  createdAt: string
  updatedAt: string
}

export interface GuestSchema {
  id: string
  name: string
  email: string
  phone: string
  address: string
}

export interface InvoiceSchema {
  id: string
  guestId: string
  bookingId: string
  invoiceNumber: string
  totalAmount: number
  status: string
  items: string // JSON string
  createdAt: string
  updatedAt: string
}

export interface ContactMessageSchema {
  id: string
  name: string
  email: string
  phone: string
  subject: string
  message: string
  status: string
  createdAt: string
}

export interface PropertySchema {
  id: string
  name: string
  roomNumber: string
  address: string
  propertyTypeId: string
  bedrooms: number
  bathrooms: number
  maxGuests: number
  basePrice: number
  description: string
  status: string
  createdAt: string
  updatedAt: string
}

/**
 * Initialize database schema and ensure all tables are accessible
 */
export async function initializeDatabaseSchema(): Promise<void> {
  try {
    console.log('[DatabaseSchema] Initializing database schema...')
    
    // Test access to each table to ensure they exist
    const tables = [
      'activityLogs',
      'staff', 
      'bookings',
      'rooms',
      'roomTypes',
      'guests',
      'invoices',
      'contactMessages',
      'properties'
    ]
    
    for (const tableName of tables) {
      try {
        // Try to list records to test table access
        await (blink.db as any)[tableName].list({ limit: 1 })
        console.log(`[DatabaseSchema] ✅ Table '${tableName}' is accessible`)
      } catch (error: any) {
        console.warn(`[DatabaseSchema] ⚠️ Table '${tableName}' may not exist or is not accessible:`, error.message)
        
        // For activityLogs, try to create a test record to initialize the table
        if (tableName === 'activityLogs') {
          try {
            const testLog = {
              id: `test_${Date.now()}`,
              action: 'test',
              entityType: 'test',
              entityId: 'test',
              details: JSON.stringify({ test: true }),
              userId: 'system',
              metadata: JSON.stringify({}),
              createdAt: new Date().toISOString(),
            }
            await (blink.db as any)[tableName].create(testLog)
            console.log(`[DatabaseSchema] ✅ Created test record in '${tableName}' table`)
            
            // Clean up test record
            try {
              await (blink.db as any)[tableName].delete(testLog.id)
              console.log(`[DatabaseSchema] ✅ Cleaned up test record from '${tableName}' table`)
            } catch (cleanupError) {
              console.warn(`[DatabaseSchema] ⚠️ Could not clean up test record:`, cleanupError)
            }
          } catch (createError: any) {
            console.error(`[DatabaseSchema] ❌ Failed to create test record in '${tableName}':`, createError.message)
          }
        }
      }
    }
    
    console.log('[DatabaseSchema] Database schema initialization completed')
  } catch (error) {
    console.error('[DatabaseSchema] Failed to initialize database schema:', error)
    throw error
  }
}

/**
 * Create a sample activity log to test the system
 */
export async function createSampleActivityLog(): Promise<void> {
  try {
    const sampleLog = {
      id: `sample_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      action: 'created',
      entityType: 'test',
      entityId: `test_${Date.now()}`,
      details: JSON.stringify({
        message: 'Sample activity log created for testing',
        timestamp: new Date().toISOString(),
        test: true
      }),
      userId: 'system',
      metadata: JSON.stringify({
        source: 'schema-test',
        version: '1.0'
      }),
      createdAt: new Date().toISOString(),
    }
    
    await (blink.db as any).activityLogs.create(sampleLog)
    console.log('[DatabaseSchema] ✅ Sample activity log created successfully')
  } catch (error: any) {
    console.error('[DatabaseSchema] ❌ Failed to create sample activity log:', error.message)
    throw error
  }
}

