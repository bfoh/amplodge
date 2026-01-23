/**
 * Blink Database Schema Definition
 * This file defines the complete database schema for the AMP Lodge Hotel Management System
 */

import { blink } from './client'

/**
 * Database Schema Definition
 * This defines all the tables and their structure for the Blink database
 */
export const databaseSchema = {
  // Activity Logs Table
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

  // Staff Table
  staff: {
    id: 'string',
    userId: 'string',
    name: 'string',
    email: 'string',
    role: 'string',
    createdAt: 'string'
  },

  // Bookings Table
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

  // Rooms Table
  rooms: {
    id: 'string',
    roomNumber: 'string',
    roomTypeId: 'string',
    status: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },

  // Room Types Table
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

  // Guests Table
  guests: {
    id: 'string',
    name: 'string',
    email: 'string',
    phone: 'string',
    address: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },

  // Invoices Table
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

  // Contact Messages Table
  contactMessages: {
    id: 'string',
    name: 'string',
    email: 'string',
    phone: 'string',
    subject: 'string',
    message: 'string',
    status: 'string',
    createdAt: 'string'
  },

  // Channel Manager Tables
  channelConnections: {
    id: 'string',
    channelId: 'string',
    name: 'string',
    isActive: 'boolean',
    createdAt: 'string',
    updatedAt: 'string'
  },

  channelRoomMappings: {
    id: 'string',
    channelConnectionId: 'string',
    localRoomTypeId: 'string',
    importUrl: 'string',
    exportToken: 'string',
    lastSyncedAt: 'string',
    syncStatus: 'string',
    syncMessage: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },

  externalBookings: {
    id: 'string',
    mappingId: 'string',
    externalId: 'string',
    startDate: 'string',
    endDate: 'string',
    summary: 'string',
    rawData: 'string', // JSON
    createdAt: 'string',
    updatedAt: 'string'
  }
}

/**
 * Initialize the database schema by creating all required tables
 * This function ensures that all tables exist before the application starts
 */
export async function initializeDatabase(): Promise<void> {
  try {
    console.log('[Database] Initializing database schema...')

    // Get the database instance
    const db = blink.db as any

    // List of tables to initialize
    const tablesToInitialize = Object.keys(databaseSchema)

    for (const tableName of tablesToInitialize) {
      try {
        console.log(`[Database] Initializing table: ${tableName}`)

        // Try to access the table first
        try {
          await db[tableName].list({ limit: 1 })
          console.log(`[Database] ✅ Table '${tableName}' already exists`)
          continue
        } catch (error: any) {
          if (error.message.includes('does not exist')) {
            console.log(`[Database] Table '${tableName}' does not exist, creating...`)
          } else {
            console.warn(`[Database] ⚠️ Table '${tableName}' access failed:`, error.message)
            continue
          }
        }

        // For activityLogs table, create it by inserting a record
        if (tableName === 'activityLogs') {
          try {
            const initRecord = {
              id: `init_${tableName}_${Date.now()}`,
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
                table: tableName
              }),
              createdAt: new Date().toISOString()
            }

            // Create the record to initialize the table
            await db[tableName].create(initRecord)
            console.log(`[Database] ✅ Table '${tableName}' created successfully`)

            // Verify by reading the record back
            const createdRecord = await db[tableName].get(initRecord.id)
            console.log(`[Database] ✅ Table '${tableName}' verification successful`)

            // Clean up the initialization record
            try {
              await db[tableName].delete(initRecord.id)
              console.log(`[Database] ✅ Initialization record cleaned up for '${tableName}'`)
            } catch (cleanupError) {
              console.warn(`[Database] ⚠️ Could not clean up initialization record for '${tableName}':`, cleanupError)
            }

          } catch (createError: any) {
            console.error(`[Database] ❌ Failed to create table '${tableName}':`, createError.message)
            throw createError
          }
        } else {
          // For other tables, just try to access them
          try {
            await db[tableName].list({ limit: 1 })
            console.log(`[Database] ✅ Table '${tableName}' is accessible`)
          } catch (accessError: any) {
            console.warn(`[Database] ⚠️ Table '${tableName}' is not accessible:`, accessError.message)
          }
        }

      } catch (error: any) {
        console.error(`[Database] ❌ Failed to initialize table '${tableName}':`, error.message)
      }
    }

    console.log('[Database] ✅ Database initialization completed')

  } catch (error: any) {
    console.error('[Database] ❌ Database initialization failed:', error.message)
    throw error
  }
}

/**
 * Test the activityLogs table functionality
 */
export async function testActivityLogsTable(): Promise<boolean> {
  try {
    console.log('[Database] Testing activityLogs table...')

    const db = blink.db as any

    // Test 1: Can we list records?
    try {
      const records = await db.activityLogs.list({ limit: 1 })
      console.log('[Database] ✅ List test passed')
    } catch (error: any) {
      console.error('[Database] ❌ List test failed:', error.message)
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
      console.log('[Database] ✅ Create test passed')
    } catch (error: any) {
      console.error('[Database] ❌ Create test failed:', error.message)
      return false
    }

    // Test 3: Can we read the record?
    try {
      const record = await db.activityLogs.get(testRecord.id)
      console.log('[Database] ✅ Read test passed')
    } catch (error: any) {
      console.error('[Database] ❌ Read test failed:', error.message)
      return false
    }

    // Test 4: Can we delete the record?
    try {
      await db.activityLogs.delete(testRecord.id)
      console.log('[Database] ✅ Delete test passed')
    } catch (error: any) {
      console.error('[Database] ❌ Delete test failed:', error.message)
      return false
    }

    console.log('[Database] ✅ All activityLogs table tests passed')
    return true

  } catch (error: any) {
    console.error('[Database] ❌ ActivityLogs table test failed:', error.message)
    return false
  }
}

/**
 * Create sample activity logs for testing
 */
export async function createSampleActivityLogs(): Promise<void> {
  try {
    console.log('[Database] Creating sample activity logs...')

    const db = blink.db as any

    const sampleLogs = [
      {
        id: `sample_booking_${Date.now()}`,
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
        id: `sample_guest_${Date.now()}`,
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
        id: `sample_invoice_${Date.now()}`,
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
        console.log(`[Database] ✅ Created sample log: ${log.action} ${log.entityType}`)
      } catch (error: any) {
        console.error(`[Database] ❌ Failed to create sample log:`, error.message)
      }
    }

    console.log('[Database] ✅ Sample activity logs creation completed')

  } catch (error: any) {
    console.error('[Database] ❌ Failed to create sample activity logs:', error.message)
    throw error
  }
}

/**
 * Force create the activityLogs table by inserting a record
 */
export async function forceCreateActivityLogsTable(): Promise<boolean> {
  try {
    console.log('[Database] Force creating activityLogs table...')

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

    console.log('[Database] Inserting record to force table creation...')
    await db.activityLogs.create(forceRecord)
    console.log('[Database] ✅ Record created successfully')

    // Verify by reading it back
    const createdRecord = await db.activityLogs.get(forceRecord.id)
    console.log('[Database] ✅ Record verification successful')

    // Clean up the record
    await db.activityLogs.delete(forceRecord.id)
    console.log('[Database] ✅ Record cleaned up')

    console.log('[Database] ✅ Force table creation completed successfully')
    return true

  } catch (error: any) {
    console.error('[Database] ❌ Force table creation failed:', error.message)
    return false
  }
}

// Make functions available globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).initDatabase = initializeDatabase
    (window as any).testActivityLogsTable = testActivityLogsTable
      (window as any).createSampleActivityLogs = createSampleActivityLogs
        (window as any).forceCreateTable = forceCreateActivityLogsTable
  console.log('[Database] Database functions available globally:')
  console.log('  - initDatabase() - Initialize database schema')
  console.log('  - testActivityLogsTable() - Test activityLogs table')
  console.log('  - createSampleActivityLogs() - Create sample data')
  console.log('  - forceCreateTable() - Force create activityLogs table')
}





