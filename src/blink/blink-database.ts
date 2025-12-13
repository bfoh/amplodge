/**
 * Blink Database Configuration File
 * This file defines the database schema for the AMP Lodge Hotel Management System
 * This is the proper way to define tables in Blink SDK
 */

import { blink } from './client'

/**
 * Database Tables Configuration
 * This defines the structure of all database tables
 */
export const databaseTables = {
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
  },
  bookings: {
    id: 'string',
    userId: 'string',
    guestId: 'string',
    roomId: 'string',
    checkIn: 'string',
    checkOut: 'string',
    status: 'string',
    totalPrice: 'number',
    numGuests: 'number',
    specialRequests: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  rooms: {
    id: 'string',
    roomNumber: 'string',
    roomTypeId: 'string',
    status: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  roomTypes: {
    id: 'string',
    name: 'string',
    description: 'string',
    basePrice: 'number',
    maxOccupancy: 'number',
    amenities: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  guests: {
    id: 'string',
    name: 'string',
    email: 'string',
    phone: 'string',
    address: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  invoices: {
    id: 'string',
    guestId: 'string',
    bookingId: 'string',
    invoiceNumber: 'string',
    totalAmount: 'number',
    status: 'string',
    items: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  contactMessages: {
    id: 'string',
    name: 'string',
    email: 'string',
    phone: 'string',
    subject: 'string',
    message: 'string',
    status: 'string',
    createdAt: 'string'
  }
}

/**
 * Initialize the database by creating all required tables
 * This function uses a different approach - it tries to create tables by defining them explicitly
 */
export async function initializeBlinkDatabase(): Promise<void> {
  try {
    console.log('[BlinkDB] Initializing Blink database...')
    
    // Get the database instance
    const db = blink.db as any
    
    // Try to create the activityLogs table by inserting a record with explicit schema
    try {
      console.log('[BlinkDB] Attempting to create activityLogs table...')
      
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
      console.log('[BlinkDB] ✅ activityLogs table created successfully')
      
      // Verify by reading the record back
      const createdRecord = await db.activityLogs.get(initRecord.id)
      console.log('[BlinkDB] ✅ Table verification successful')
      
      // Clean up the initialization record
      try {
        await db.activityLogs.delete(initRecord.id)
        console.log('[BlinkDB] ✅ Initialization record cleaned up')
      } catch (cleanupError) {
        console.warn('[BlinkDB] ⚠️ Could not clean up initialization record:', cleanupError)
      }
      
    } catch (createError: any) {
      console.error('[BlinkDB] ❌ Failed to create activityLogs table:', createError.message)
      
      // If the error is about the table not existing, try a different approach
      if (createError.message.includes('does not exist')) {
        console.log('[BlinkDB] Trying alternative table creation approach...')
        
        // Try to create the table by listing it first (this might initialize it)
        try {
          await db.activityLogs.list({ limit: 0 })
          console.log('[BlinkDB] ✅ Table accessed via list operation')
        } catch (listError: any) {
          console.error('[BlinkDB] ❌ List operation also failed:', listError.message)
          throw new Error(`Cannot create or access activityLogs table: ${listError.message}`)
        }
      } else {
        throw createError
      }
    }
    
    console.log('[BlinkDB] ✅ Database initialization completed')
    
  } catch (error: any) {
    console.error('[BlinkDB] ❌ Database initialization failed:', error.message)
    throw error
  }
}

/**
 * Test the activityLogs table functionality
 */
export async function testActivityLogsTable(): Promise<boolean> {
  try {
    console.log('[BlinkDB] Testing activityLogs table...')
    
    const db = blink.db as any
    
    // Test 1: Can we list records?
    try {
      const records = await db.activityLogs.list({ limit: 1 })
      console.log('[BlinkDB] ✅ List test passed')
    } catch (error: any) {
      console.error('[BlinkDB] ❌ List test failed:', error.message)
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
      console.log('[BlinkDB] ✅ Create test passed')
    } catch (error: any) {
      console.error('[BlinkDB] ❌ Create test failed:', error.message)
      return false
    }
    
    // Test 3: Can we read the record?
    try {
      const record = await db.activityLogs.get(testRecord.id)
      console.log('[BlinkDB] ✅ Read test passed')
    } catch (error: any) {
      console.error('[BlinkDB] ❌ Read test failed:', error.message)
      return false
    }
    
    // Test 4: Can we delete the record?
    try {
      await db.activityLogs.delete(testRecord.id)
      console.log('[BlinkDB] ✅ Delete test passed')
    } catch (error: any) {
      console.error('[BlinkDB] ❌ Delete test failed:', error.message)
      return false
    }
    
    console.log('[BlinkDB] ✅ All tests passed')
    return true
    
  } catch (error: any) {
    console.error('[BlinkDB] ❌ Table test failed:', error.message)
    return false
  }
}

/**
 * Create sample activity logs
 */
export async function createSampleActivityLogs(): Promise<void> {
  try {
    console.log('[BlinkDB] Creating sample activity logs...')
    
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
        console.log(`[BlinkDB] ✅ Created sample log: ${log.action} ${log.entityType}`)
      } catch (error: any) {
        console.error(`[BlinkDB] ❌ Failed to create sample log:`, error.message)
      }
    }
    
    console.log('[BlinkDB] ✅ Sample activity logs creation completed')
    
  } catch (error: any) {
    console.error('[BlinkDB] ❌ Failed to create sample activity logs:', error.message)
    throw error
  }
}

/**
 * Force create the activityLogs table by inserting a record
 */
export async function forceCreateActivityLogsTable(): Promise<boolean> {
  try {
    console.log('[BlinkDB] Force creating activityLogs table...')
    
    const db = blink.db as any
    
    // Create a record to force table creation
    const forceRecord = {
      id: `force_create_${Date.now()}`,
      action: 'force_create',
      entityType: 'system',
      entityId: 'force_creation',
      details: JSON.stringify({
        message: 'Force table creation',
        timestamp: new Date().toISOString(),
        method: 'force_create'
      }),
      userId: 'system',
      metadata: JSON.stringify({
        source: 'force_creation',
        created: true
      }),
      createdAt: new Date().toISOString()
    }
    
    console.log('[BlinkDB] Inserting record to force table creation...')
    await db.activityLogs.create(forceRecord)
    console.log('[BlinkDB] ✅ Record created successfully')
    
    // Verify by reading it back
    const createdRecord = await db.activityLogs.get(forceRecord.id)
    console.log('[BlinkDB] ✅ Record verification successful')
    
    // Clean up the record
    await db.activityLogs.delete(forceRecord.id)
    console.log('[BlinkDB] ✅ Record cleaned up')
    
    console.log('[BlinkDB] ✅ Force table creation completed successfully')
    return true
    
  } catch (error: any) {
    console.error('[BlinkDB] ❌ Force table creation failed:', error.message)
    return false
  }
}

// Make functions available globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).initBlinkDB = initializeBlinkDatabase
  (window as any).testBlinkTable = testActivityLogsTable
  (window as any).createBlinkSampleLogs = createSampleActivityLogs
  (window as any).forceCreateBlinkTable = forceCreateActivityLogsTable
  console.log('[BlinkDB] Blink database functions available globally:')
  console.log('  - initBlinkDB() - Initialize Blink database')
  console.log('  - testBlinkTable() - Test activityLogs table')
  console.log('  - createBlinkSampleLogs() - Create sample data')
  console.log('  - forceCreateBlinkTable() - Force create activityLogs table')
}





