import { blink } from '@/blink/client'

/**
 * Create the activityLogs table in the Blink database
 * This function will ensure the table exists before any operations are performed
 */
export async function createActivityLogsTable(): Promise<boolean> {
  try {
    console.log('[CreateTable] Attempting to create activityLogs table...')
    
    const db = blink.db as any
    
    // First, try to access the table to see if it exists
    try {
      await db.activityLogs.list({ limit: 1 })
      console.log('[CreateTable] ✅ activityLogs table already exists')
      return true
    } catch (error: any) {
      console.log('[CreateTable] Table does not exist, attempting to create...')
    }
    
    // Create a test record to initialize the table
    const testRecord = {
      id: `init_${Date.now()}`,
      action: 'table_init',
      entityType: 'system',
      entityId: 'table_creation',
      details: JSON.stringify({
        message: 'Activity logs table initialization',
        timestamp: new Date().toISOString(),
        version: '1.0'
      }),
      userId: 'system',
      metadata: JSON.stringify({
        source: 'table_initialization',
        created: true
      }),
      createdAt: new Date().toISOString(),
    }
    
    // Try to create the record, which should initialize the table
    await db.activityLogs.create(testRecord)
    console.log('[CreateTable] ✅ activityLogs table created successfully')
    
    // Verify the table exists by trying to read the record back
    const createdRecord = await db.activityLogs.get(testRecord.id)
    console.log('[CreateTable] ✅ Table verification successful:', createdRecord.id)
    
    // Clean up the test record
    try {
      await db.activityLogs.delete(testRecord.id)
      console.log('[CreateTable] ✅ Test record cleaned up')
    } catch (cleanupError) {
      console.warn('[CreateTable] ⚠️ Could not clean up test record:', cleanupError)
    }
    
    return true
    
  } catch (error: any) {
    console.error('[CreateTable] ❌ Failed to create activityLogs table:', error.message)
    return false
  }
}

/**
 * Verify that the activityLogs table is accessible and working
 */
export async function verifyActivityLogsTable(): Promise<{
  success: boolean
  canRead: boolean
  canWrite: boolean
  canDelete: boolean
  error?: string
}> {
  const result = {
    success: false,
    canRead: false,
    canWrite: false,
    canDelete: false,
    error: undefined as string | undefined
  }
  
  try {
    console.log('[VerifyTable] Verifying activityLogs table functionality...')
    
    const db = blink.db as any
    
    // Test 1: Can read (list)
    try {
      await db.activityLogs.list({ limit: 1 })
      result.canRead = true
      console.log('[VerifyTable] ✅ Read test passed')
    } catch (error: any) {
      console.error('[VerifyTable] ❌ Read test failed:', error.message)
      result.error = `Read failed: ${error.message}`
      return result
    }
    
    // Test 2: Can write (create)
    const testRecord = {
      id: `verify_${Date.now()}`,
      action: 'verify_write',
      entityType: 'test',
      entityId: 'verify_test',
      details: JSON.stringify({ test: true }),
      userId: 'system',
      metadata: JSON.stringify({}),
      createdAt: new Date().toISOString(),
    }
    
    try {
      await db.activityLogs.create(testRecord)
      result.canWrite = true
      console.log('[VerifyTable] ✅ Write test passed')
    } catch (error: any) {
      console.error('[VerifyTable] ❌ Write test failed:', error.message)
      result.error = `Write failed: ${error.message}`
      return result
    }
    
    // Test 3: Can delete
    try {
      await db.activityLogs.delete(testRecord.id)
      result.canDelete = true
      console.log('[VerifyTable] ✅ Delete test passed')
    } catch (error: any) {
      console.error('[VerifyTable] ❌ Delete test failed:', error.message)
      result.error = `Delete failed: ${error.message}`
      return result
    }
    
    result.success = true
    console.log('[VerifyTable] ✅ All table verification tests passed')
    
  } catch (error: any) {
    console.error('[VerifyTable] ❌ Table verification failed:', error.message)
    result.error = error.message
  }
  
  return result
}

/**
 * Create sample activity logs for testing
 */
export async function createSampleActivityLogs(): Promise<void> {
  try {
    console.log('[SampleLogs] Creating sample activity logs...')
    
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
        createdAt: new Date().toISOString(),
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
        createdAt: new Date().toISOString(),
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
        createdAt: new Date().toISOString(),
      }
    ]
    
    const db = blink.db as any
    
    for (const log of sampleLogs) {
      try {
        await db.activityLogs.create(log)
        console.log(`[SampleLogs] ✅ Created sample log: ${log.action} ${log.entityType}`)
      } catch (error: any) {
        console.error(`[SampleLogs] ❌ Failed to create sample log:`, error.message)
      }
    }
    
    console.log('[SampleLogs] ✅ Sample activity logs creation completed')
    
  } catch (error: any) {
    console.error('[SampleLogs] ❌ Failed to create sample activity logs:', error.message)
    throw error
  }
}





