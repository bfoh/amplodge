/**
 * Blink Database Test Script
 * This script provides direct testing methods for the Blink database
 */

import { initializeBlinkDatabase, testActivityLogsTable, createSampleActivityLogs, forceCreateActivityLogsTable } from '@/blink/blink-config'

/**
 * Run a complete test of the Blink database system
 */
export async function testBlinkDatabaseSystem(): Promise<{
  success: boolean
  results: {
    initialization: boolean
    tableCreation: boolean
    tableTesting: boolean
    sampleDataCreation: boolean
  }
  errors: string[]
}> {
  const results = {
    initialization: false,
    tableCreation: false,
    tableTesting: false,
    sampleDataCreation: false,
  }
  const errors: string[] = []

  try {
    console.log('[BlinkTest] Starting comprehensive Blink database test...')

    // Test 1: Initialize Blink database
    try {
      await initializeBlinkDatabase()
      results.initialization = true
      console.log('[BlinkTest] ✅ Database initialization passed')
    } catch (error: any) {
      errors.push(`Database initialization failed: ${error.message}`)
      console.error('[BlinkTest] ❌ Database initialization failed:', error.message)
    }

    // Test 2: Force create table
    try {
      const tableCreated = await forceCreateActivityLogsTable()
      results.tableCreation = tableCreated
      if (tableCreated) {
        console.log('[BlinkTest] ✅ Table creation passed')
      } else {
        errors.push('Table creation failed')
        console.error('[BlinkTest] ❌ Table creation failed')
      }
    } catch (error: any) {
      errors.push(`Table creation failed: ${error.message}`)
      console.error('[BlinkTest] ❌ Table creation failed:', error.message)
    }

    // Test 3: Test table functionality
    try {
      const tableTest = await testActivityLogsTable()
      results.tableTesting = tableTest
      if (tableTest) {
        console.log('[BlinkTest] ✅ Table testing passed')
      } else {
        errors.push('Table testing failed')
        console.error('[BlinkTest] ❌ Table testing failed')
      }
    } catch (error: any) {
      errors.push(`Table testing failed: ${error.message}`)
      console.error('[BlinkTest] ❌ Table testing failed:', error.message)
    }

    // Test 4: Create sample data
    try {
      await createSampleActivityLogs()
      results.sampleDataCreation = true
      console.log('[BlinkTest] ✅ Sample data creation passed')
    } catch (error: any) {
      errors.push(`Sample data creation failed: ${error.message}`)
      console.error('[BlinkTest] ❌ Sample data creation failed:', error.message)
    }

    const success = results.initialization && results.tableCreation && results.tableTesting && results.sampleDataCreation

    if (success) {
      console.log('[BlinkTest] ✅ All tests passed! Blink database system is working correctly.')
    } else {
      console.log('[BlinkTest] ❌ Some tests failed. Check the errors above.')
    }

    return { success, results, errors }

  } catch (error: any) {
    console.error('[BlinkTest] ❌ Test suite failed:', error.message)
    errors.push(`Test suite failed: ${error.message}`)
    return { success: false, results, errors }
  }
}

/**
 * Quick test to check if Blink database is working
 */
export async function quickBlinkTest(): Promise<boolean> {
  try {
    console.log('[BlinkTest] Running quick Blink test...')
    
    await initializeBlinkDatabase()
    const tableCreated = await forceCreateActivityLogsTable()
    
    if (tableCreated) {
      console.log('[BlinkTest] ✅ Quick test passed - Blink database is working')
      return true
    } else {
      console.log('[BlinkTest] ❌ Quick test failed - table creation failed')
      return false
    }
  } catch (error: any) {
    console.error('[BlinkTest] ❌ Quick test failed:', error.message)
    return false
  }
}

/**
 * Test just the table creation
 */
export async function testTableCreation(): Promise<boolean> {
  try {
    console.log('[BlinkTest] Testing table creation...')
    
    const success = await forceCreateActivityLogsTable()
    
    if (success) {
      console.log('[BlinkTest] ✅ Table creation test passed')
      return true
    } else {
      console.log('[BlinkTest] ❌ Table creation test failed')
      return false
    }
  } catch (error: any) {
    console.error('[BlinkTest] ❌ Table creation test failed:', error.message)
    return false
  }
}

// Make functions available globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).testBlinkSystem = testBlinkDatabaseSystem
  (window as any).quickBlinkTest = quickBlinkTest
  (window as any).testBlinkTableCreation = testTableCreation
  console.log('[BlinkTest] Blink test functions available globally:')
  console.log('  - testBlinkSystem() - Run comprehensive test')
  console.log('  - quickBlinkTest() - Run quick test')
  console.log('  - testBlinkTableCreation() - Test table creation only')
}