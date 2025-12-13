/**
 * Test script for Activity Logs functionality
 * This can be run from the browser console to test the activity logs system
 */

import { initializeDatabaseSchema, verifyActivityLogsTable, createSampleActivityLogs } from '@/blink/database-schema'
import { activityLogService } from '@/services/activity-log-service'

/**
 * Run a complete test of the activity logs system
 */
export async function testActivityLogsSystem(): Promise<{
  success: boolean
  results: {
    schemaInit: boolean
    tableVerification: boolean
    sampleDataCreation: boolean
    serviceTest: boolean
  }
  errors: string[]
}> {
  const results = {
    schemaInit: false,
    tableVerification: false,
    sampleDataCreation: false,
    serviceTest: false,
  }
  const errors: string[] = []

  try {
    console.log('[TestActivityLogs] Starting comprehensive test...')

    // Test 1: Initialize database schema
    try {
      await initializeDatabaseSchema()
      results.schemaInit = true
      console.log('[TestActivityLogs] ✅ Schema initialization passed')
    } catch (error: any) {
      errors.push(`Schema initialization failed: ${error.message}`)
      console.error('[TestActivityLogs] ❌ Schema initialization failed:', error.message)
    }

    // Test 2: Verify table functionality
    try {
      const verification = await verifyActivityLogsTable()
      results.tableVerification = verification
      if (verification) {
        console.log('[TestActivityLogs] ✅ Table verification passed')
      } else {
        errors.push('Table verification failed')
        console.error('[TestActivityLogs] ❌ Table verification failed')
      }
    } catch (error: any) {
      errors.push(`Table verification failed: ${error.message}`)
      console.error('[TestActivityLogs] ❌ Table verification failed:', error.message)
    }

    // Test 3: Create sample data
    try {
      await createSampleActivityLogs()
      results.sampleDataCreation = true
      console.log('[TestActivityLogs] ✅ Sample data creation passed')
    } catch (error: any) {
      errors.push(`Sample data creation failed: ${error.message}`)
      console.error('[TestActivityLogs] ❌ Sample data creation failed:', error.message)
    }

    // Test 4: Test activity log service
    try {
      await activityLogService.log({
        action: 'test',
        entityType: 'test',
        entityId: 'service_test',
        details: { test: true, method: 'service_test' },
        userId: 'system'
      })
      results.serviceTest = true
      console.log('[TestActivityLogs] ✅ Activity log service test passed')
    } catch (error: any) {
      errors.push(`Activity log service test failed: ${error.message}`)
      console.error('[TestActivityLogs] ❌ Activity log service test failed:', error.message)
    }

    const success = results.schemaInit && results.tableVerification && results.sampleDataCreation && results.serviceTest

    if (success) {
      console.log('[TestActivityLogs] ✅ All tests passed! Activity logs system is working correctly.')
    } else {
      console.log('[TestActivityLogs] ❌ Some tests failed. Check the errors above.')
    }

    return { success, results, errors }

  } catch (error: any) {
    console.error('[TestActivityLogs] ❌ Test suite failed:', error.message)
    errors.push(`Test suite failed: ${error.message}`)
    return { success: false, results, errors }
  }
}

/**
 * Quick test to check if activity logs table exists and is accessible
 */
export async function quickTest(): Promise<boolean> {
  try {
    console.log('[QuickTest] Running quick test...')
    
    await initializeDatabaseSchema()
    const verification = await verifyActivityLogsTable()
    
    if (verification) {
      console.log('[QuickTest] ✅ Quick test passed - activity logs table is working')
      return true
    } else {
      console.log('[QuickTest] ❌ Quick test failed - table verification failed')
      return false
    }
  } catch (error: any) {
    console.error('[QuickTest] ❌ Quick test failed:', error.message)
    return false
  }
}

// Make functions available globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).testActivityLogs = testActivityLogsSystem
  (window as any).quickTestActivityLogs = quickTest
  console.log('[TestActivityLogs] Test functions available globally:')
  console.log('  - testActivityLogs() - Run comprehensive test')
  console.log('  - quickTestActivityLogs() - Run quick test')
}





