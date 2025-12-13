import { blink } from '@/blink/client'
import { initializeDatabaseSchema, createSampleActivityLog } from '@/blink/schema'

/**
 * Database initialization utility
 * This can be called from the browser console or from the app to initialize the database
 */
export async function initializeDatabase(): Promise<void> {
  try {
    console.log('[DatabaseInit] Starting database initialization...')
    
    // Initialize schema
    await initializeDatabaseSchema()
    
    // Create sample activity log to test the system
    await createSampleActivityLog()
    
    console.log('[DatabaseInit] Database initialization completed successfully')
  } catch (error) {
    console.error('[DatabaseInit] Database initialization failed:', error)
    throw error
  }
}

/**
 * Test database connectivity and table access
 */
export async function testDatabaseConnectivity(): Promise<{
  success: boolean
  tables: Record<string, boolean>
  errors: Record<string, string>
}> {
  const results = {
    success: true,
    tables: {} as Record<string, boolean>,
    errors: {} as Record<string, string>
  }
  
  const tables = [
    'activityLogs',
    'staff',
    'bookings', 
    'rooms',
    'roomTypes',
    'guests',
    'invoices',
    'contactMessages'
  ]
  
  for (const tableName of tables) {
    try {
      const db = blink.db as any
      await db[tableName].list({ limit: 1 })
      results.tables[tableName] = true
      console.log(`[DatabaseInit] ✅ Table '${tableName}' is accessible`)
    } catch (error: any) {
      results.tables[tableName] = false
      results.errors[tableName] = error.message
      results.success = false
      console.error(`[DatabaseInit] ❌ Table '${tableName}' failed:`, error.message)
    }
  }
  
  return results
}

/**
 * Create comprehensive test data for all tables
 */
export async function createTestData(): Promise<void> {
  try {
    console.log('[DatabaseInit] Creating test data...')
    
    // Create test activity logs
    const testLogs = [
      {
        id: `test_log_1_${Date.now()}`,
        action: 'created',
        entityType: 'booking',
        entityId: 'test_booking_1',
        details: JSON.stringify({
          guestName: 'Test Guest 1',
          roomNumber: '101',
          amount: 150,
          checkIn: '2024-01-15',
          checkOut: '2024-01-17'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'test_data' }),
        createdAt: new Date().toISOString(),
      },
      {
        id: `test_log_2_${Date.now()}`,
        action: 'updated',
        entityType: 'guest',
        entityId: 'test_guest_1',
        details: JSON.stringify({
          name: 'Test Guest 1',
          email: 'test1@example.com',
          phone: '+1234567890'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'test_data' }),
        createdAt: new Date().toISOString(),
      },
      {
        id: `test_log_3_${Date.now()}`,
        action: 'deleted',
        entityType: 'invoice',
        entityId: 'test_invoice_1',
        details: JSON.stringify({
          invoiceNumber: 'INV-TEST-001',
          amount: 200,
          status: 'cancelled'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'test_data' }),
        createdAt: new Date().toISOString(),
      }
    ]
    
    const db = blink.db as any
    
    for (const log of testLogs) {
      try {
        await db.activityLogs.create(log)
        console.log(`[DatabaseInit] ✅ Created test log: ${log.action} ${log.entityType}`)
      } catch (error: any) {
        console.error(`[DatabaseInit] ❌ Failed to create test log:`, error.message)
      }
    }
    
    console.log('[DatabaseInit] Test data creation completed')
  } catch (error) {
    console.error('[DatabaseInit] Test data creation failed:', error)
    throw error
  }
}

// Make functions available globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).initDatabase = initializeDatabase
  (window as any).testDatabase = testDatabaseConnectivity
  (window as any).createTestData = createTestData
}





