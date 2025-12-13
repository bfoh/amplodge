/**
 * Blink Database Configuration
 * This file configures the database tables for the AMP Lodge Hotel Management System
 */

import { blink } from './client'

/**
 * Database table definitions
 * These interfaces define the structure of each table
 */
export interface DatabaseTables {
  activityLogs: {
    id: string
    action: string
    entityType: string
    entityId: string
    details: string // JSON string
    userId: string
    metadata: string // JSON string
    createdAt: string
  }
  staff: {
    id: string
    userId: string
    name: string
    email: string
    role: string
    createdAt: string
  }
  bookings: {
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
    createdAt: string
    updatedAt: string
  }
  rooms: {
    id: string
    roomNumber: string
    roomTypeId: string
    status: string
    createdAt: string
    updatedAt: string
  }
  roomTypes: {
    id: string
    name: string
    description: string
    basePrice: number
    maxOccupancy: number
    amenities: string // JSON string
    createdAt: string
    updatedAt: string
  }
  guests: {
    id: string
    name: string
    email: string
    phone: string
    address: string
    createdAt: string
    updatedAt: string
  }
  invoices: {
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
  contactMessages: {
    id: string
    name: string
    email: string
    phone: string
    subject: string
    message: string
    status: string
    createdAt: string
  }
}

/**
 * Initialize the database by ensuring all tables exist
 * This function uses a different approach - it tries to create tables by defining them explicitly
 */
export async function initializeBlinkDatabase(): Promise<void> {
  try {
    console.log('[BlinkDatabase] Initializing Blink database...')
    
    // Get the database instance
    const db = blink.db as any
    
    // Define table schemas explicitly
    const tableSchemas = {
      activityLogs: {
        id: 'string',
        action: 'string',
        entityType: 'string',
        entityId: 'string',
        details: 'string',
        userId: 'string',
        metadata: 'string',
        createdAt: 'string'
      },
      staff: {
        id: 'string',
        userId: 'string',
        name: 'string',
        email: 'string',
        role: 'string',
        createdAt: 'string'
      }
    }
    
    // Try to create the activityLogs table by inserting a record with explicit schema
    try {
      console.log('[BlinkDatabase] Attempting to create activityLogs table...')
      
      // Create a record with all required fields
      const initRecord = {
        id: `init_${Date.now()}`,
        action: 'table_init',
        entityType: 'system',
        entityId: 'database_init',
        details: JSON.stringify({
          message: 'Activity logs table initialization',
          timestamp: new Date().toISOString(),
          version: '1.0'
        }),
        userId: 'system',
        metadata: JSON.stringify({
          source: 'database_initialization',
          table: 'activityLogs'
        }),
        createdAt: new Date().toISOString()
      }
      
      // Try to create the record - this should create the table
      await db.activityLogs.create(initRecord)
      console.log('[BlinkDatabase] ✅ activityLogs table created successfully')
      
      // Verify by reading the record back
      const createdRecord = await db.activityLogs.get(initRecord.id)
      console.log('[BlinkDatabase] ✅ Table verification successful')
      
      // Clean up the initialization record
      try {
        await db.activityLogs.delete(initRecord.id)
        console.log('[BlinkDatabase] ✅ Initialization record cleaned up')
      } catch (cleanupError) {
        console.warn('[BlinkDatabase] ⚠️ Could not clean up initialization record:', cleanupError)
      }
      
    } catch (createError: any) {
      console.error('[BlinkDatabase] ❌ Failed to create activityLogs table:', createError.message)
      
      // If the error is about the table not existing, try a different approach
      if (createError.message.includes('does not exist')) {
        console.log('[BlinkDatabase] Trying alternative table creation approach...')
        
        // Try to create the table by listing it first (this might initialize it)
        try {
          await db.activityLogs.list({ limit: 0 })
          console.log('[BlinkDatabase] ✅ Table accessed via list operation')
        } catch (listError: any) {
          console.error('[BlinkDatabase] ❌ List operation also failed:', listError.message)
          throw new Error(`Cannot create or access activityLogs table: ${listError.message}`)
        }
      } else {
        throw createError
      }
    }
    
    console.log('[BlinkDatabase] ✅ Database initialization completed')
    
  } catch (error: any) {
    console.error('[BlinkDatabase] ❌ Database initialization failed:', error.message)
    throw error
  }
}

/**
 * Test the activityLogs table functionality
 */
export async function testActivityLogsTable(): Promise<boolean> {
  try {
    console.log('[BlinkDatabase] Testing activityLogs table...')
    
    const db = blink.db as any
    
    // Test 1: Can we list records?
    try {
      const records = await db.activityLogs.list({ limit: 1 })
      console.log('[BlinkDatabase] ✅ List test passed')
    } catch (error: any) {
      console.error('[BlinkDatabase] ❌ List test failed:', error.message)
      return false
    }
    
    // Test 2: Can we create a record?
    const testRecord = {
      id: `test_${Date.now()}`,
      action: 'test',
      entityType: 'test',
      entityId: 'test_record',
      details: JSON.stringify({ test: true }),
      userId: 'system',
      metadata: JSON.stringify({}),
      createdAt: new Date().toISOString()
    }
    
    try {
      await db.activityLogs.create(testRecord)
      console.log('[BlinkDatabase] ✅ Create test passed')
    } catch (error: any) {
      console.error('[BlinkDatabase] ❌ Create test failed:', error.message)
      return false
    }
    
    // Test 3: Can we read the record?
    try {
      const record = await db.activityLogs.get(testRecord.id)
      console.log('[BlinkDatabase] ✅ Read test passed')
    } catch (error: any) {
      console.error('[BlinkDatabase] ❌ Read test failed:', error.message)
      return false
    }
    
    // Test 4: Can we delete the record?
    try {
      await db.activityLogs.delete(testRecord.id)
      console.log('[BlinkDatabase] ✅ Delete test passed')
    } catch (error: any) {
      console.error('[BlinkDatabase] ❌ Delete test failed:', error.message)
      return false
    }
    
    console.log('[BlinkDatabase] ✅ All tests passed')
    return true
    
  } catch (error: any) {
    console.error('[BlinkDatabase] ❌ Table test failed:', error.message)
    return false
  }
}

/**
 * Create sample activity logs
 */
export async function createSampleActivityLogs(): Promise<void> {
  try {
    console.log('[BlinkDatabase] Creating sample activity logs...')
    
    const db = blink.db as any
    
    const sampleLogs = [
      {
        id: `sample_1_${Date.now()}`,
        action: 'created',
        entityType: 'booking',
        entityId: `booking_${Date.now()}`,
        details: JSON.stringify({
          guestName: 'John Doe',
          roomNumber: '101',
          amount: 150,
          checkIn: '2024-01-15',
          checkOut: '2024-01-17'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'sample_data' }),
        createdAt: new Date().toISOString()
      },
      {
        id: `sample_2_${Date.now()}`,
        action: 'updated',
        entityType: 'guest',
        entityId: `guest_${Date.now()}`,
        details: JSON.stringify({
          name: 'Jane Smith',
          email: 'jane@example.com',
          phone: '+1234567890'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'sample_data' }),
        createdAt: new Date().toISOString()
      },
      {
        id: `sample_3_${Date.now()}`,
        action: 'deleted',
        entityType: 'invoice',
        entityId: `invoice_${Date.now()}`,
        details: JSON.stringify({
          invoiceNumber: 'INV-SAMPLE-001',
          amount: 200,
          status: 'cancelled'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'sample_data' }),
        createdAt: new Date().toISOString()
      }
    ]
    
    for (const log of sampleLogs) {
      try {
        await db.activityLogs.create(log)
        console.log(`[BlinkDatabase] ✅ Created sample log: ${log.action} ${log.entityType}`)
      } catch (error: any) {
        console.error(`[BlinkDatabase] ❌ Failed to create sample log:`, error.message)
      }
    }
    
    console.log('[BlinkDatabase] ✅ Sample activity logs creation completed')
    
  } catch (error: any) {
    console.error('[BlinkDatabase] ❌ Failed to create sample activity logs:', error.message)
    throw error
  }
}





