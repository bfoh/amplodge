/**
 * Manual Table Creation Utility
 * This provides direct methods to create the activityLogs table manually
 */

import { blink } from '@/blink/client'

/**
 * Manually create the activityLogs table by forcing a record creation
 */
export async function manuallyCreateActivityLogsTable(): Promise<boolean> {
  try {
    console.log('[ManualTableCreation] Starting manual table creation...')
    
    const db = blink.db as any
    
    // Create a simple record to force table creation
    const forceCreateRecord = {
      id: `force_create_${Date.now()}`,
      action: 'table_creation',
      entityType: 'system',
      entityId: 'manual_creation',
      details: JSON.stringify({
        message: 'Manual table creation',
        timestamp: new Date().toISOString(),
        method: 'force_create'
      }),
      userId: 'system',
      metadata: JSON.stringify({
        source: 'manual_creation',
        created: true
      }),
      createdAt: new Date().toISOString()
    }
    
    console.log('[ManualTableCreation] Attempting to create record...')
    await db.activityLogs.create(forceCreateRecord)
    console.log('[ManualTableCreation] ✅ Record created successfully')
    
    // Verify by reading it back
    const createdRecord = await db.activityLogs.get(forceCreateRecord.id)
    console.log('[ManualTableCreation] ✅ Record verification successful:', createdRecord.id)
    
    // Clean up the record
    await db.activityLogs.delete(forceCreateRecord.id)
    console.log('[ManualTableCreation] ✅ Record cleaned up')
    
    console.log('[ManualTableCreation] ✅ Manual table creation completed successfully')
    return true
    
  } catch (error: any) {
    console.error('[ManualTableCreation] ❌ Manual table creation failed:', error.message)
    return false
  }
}

/**
 * Test if the activityLogs table is accessible
 */
export async function testTableAccess(): Promise<boolean> {
  try {
    console.log('[ManualTableCreation] Testing table access...')
    
    const db = blink.db as any
    
    // Try to list records
    const records = await db.activityLogs.list({ limit: 1 })
    console.log('[ManualTableCreation] ✅ Table access successful, found', records.length, 'records')
    return true
    
  } catch (error: any) {
    console.error('[ManualTableCreation] ❌ Table access failed:', error.message)
    return false
  }
}

/**
 * Create a test activity log
 */
export async function createTestActivityLog(): Promise<boolean> {
  try {
    console.log('[ManualTableCreation] Creating test activity log...')
    
    const db = blink.db as any
    
    const testLog = {
      id: `test_${Date.now()}`,
      action: 'test',
      entityType: 'manual_test',
      entityId: 'test_creation',
      details: JSON.stringify({
        message: 'Test activity log created manually',
        timestamp: new Date().toISOString(),
        test: true
      }),
      userId: 'system',
      metadata: JSON.stringify({
        source: 'manual_test',
        created: true
      }),
      createdAt: new Date().toISOString()
    }
    
    await db.activityLogs.create(testLog)
    console.log('[ManualTableCreation] ✅ Test activity log created successfully')
    
    // Read it back to verify
    const createdLog = await db.activityLogs.get(testLog.id)
    console.log('[ManualTableCreation] ✅ Test log verification successful')
    
    return true
    
  } catch (error: any) {
    console.error('[ManualTableCreation] ❌ Test activity log creation failed:', error.message)
    return false
  }
}

/**
 * Run a complete manual test suite
 */
export async function runManualTestSuite(): Promise<{
  success: boolean
  results: {
    tableCreation: boolean
    tableAccess: boolean
    testLogCreation: boolean
  }
}> {
  const results = {
    tableCreation: false,
    tableAccess: false,
    testLogCreation: false
  }
  
  try {
    console.log('[ManualTableCreation] Running manual test suite...')
    
    // Test 1: Create table
    results.tableCreation = await manuallyCreateActivityLogsTable()
    
    // Test 2: Test access
    results.tableAccess = await testTableAccess()
    
    // Test 3: Create test log
    results.testLogCreation = await createTestActivityLog()
    
    const success = results.tableCreation && results.tableAccess && results.testLogCreation
    
    if (success) {
      console.log('[ManualTableCreation] ✅ All manual tests passed!')
    } else {
      console.log('[ManualTableCreation] ❌ Some manual tests failed')
    }
    
    return { success, results }
    
  } catch (error: any) {
    console.error('[ManualTableCreation] ❌ Manual test suite failed:', error.message)
    return { success: false, results }
  }
}

// Make functions available globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).manuallyCreateTable = manuallyCreateActivityLogsTable
  (window as any).testTableAccess = testTableAccess
  (window as any).createTestLog = createTestActivityLog
  (window as any).runManualTests = runManualTestSuite
  console.log('[ManualTableCreation] Manual functions available globally:')
  console.log('  - manuallyCreateTable() - Manually create the activityLogs table')
  console.log('  - testTableAccess() - Test if table is accessible')
  console.log('  - createTestLog() - Create a test activity log')
  console.log('  - runManualTests() - Run complete manual test suite')
}





