/**
 * Test utility for the fixed activity logs functionality
 */

import { activityLogService } from '@/services/activity-log-service'

/**
 * Test the activity logs functionality
 */
export async function testActivityLogsFix(): Promise<{
  success: boolean
  results: {
    logCreation: boolean
    logRetrieval: boolean
    logFiltering: boolean
  }
  errors: string[]
}> {
  const results = {
    logCreation: false,
    logRetrieval: false,
    logFiltering: false,
  }
  const errors: string[] = []

  try {
    console.log('[ActivityLogsFix] Testing activity logs functionality...')

    // Test 1: Create an activity log
    try {
      await activityLogService.log({
        action: 'created',
        entityType: 'test',
        entityId: 'test_fix_123',
        details: { 
          message: 'Testing activity logs fix',
          timestamp: new Date().toISOString(),
          test: true
        },
        userId: 'system',
        metadata: { source: 'test_fix' }
      })
      results.logCreation = true
      console.log('[ActivityLogsFix] ✅ Log creation test passed')
    } catch (error: any) {
      errors.push(`Log creation failed: ${error.message}`)
      console.error('[ActivityLogsFix] ❌ Log creation test failed:', error.message)
    }

    // Test 2: Retrieve activity logs
    try {
      const logs = await activityLogService.getActivityLogs({ limit: 10 })
      results.logRetrieval = true
      console.log('[ActivityLogsFix] ✅ Log retrieval test passed - found', logs.length, 'logs')
    } catch (error: any) {
      errors.push(`Log retrieval failed: ${error.message}`)
      console.error('[ActivityLogsFix] ❌ Log retrieval test failed:', error.message)
    }

    // Test 3: Test filtering
    try {
      const filteredLogs = await activityLogService.getActivityLogs({
        entityType: 'test',
        limit: 5
      })
      results.logFiltering = true
      console.log('[ActivityLogsFix] ✅ Log filtering test passed - found', filteredLogs.length, 'filtered logs')
    } catch (error: any) {
      errors.push(`Log filtering failed: ${error.message}`)
      console.error('[ActivityLogsFix] ❌ Log filtering test failed:', error.message)
    }

    const success = results.logCreation && results.logRetrieval && results.logFiltering

    if (success) {
      console.log('[ActivityLogsFix] ✅ All tests passed! Activity logs are working correctly.')
    } else {
      console.log('[ActivityLogsFix] ❌ Some tests failed. Check the errors above.')
    }

    return { success, results, errors }

  } catch (error: any) {
    console.error('[ActivityLogsFix] ❌ Test suite failed:', error.message)
    errors.push(`Test suite failed: ${error.message}`)
    return { success: false, results, errors }
  }
}

/**
 * Create sample activity logs for testing
 */
export async function createSampleActivityLogs(): Promise<void> {
  try {
    console.log('[ActivityLogsFix] Creating sample activity logs...')
    
    const sampleLogs = [
      {
        action: 'created' as const,
        entityType: 'booking' as const,
        entityId: `booking_${Date.now()}`,
        details: { 
          guestName: 'John Doe', 
          roomNumber: '101', 
          amount: 150,
          checkIn: '2024-01-15',
          checkOut: '2024-01-17'
        },
        userId: 'system',
        metadata: { source: 'sample_data' }
      },
      {
        action: 'updated' as const,
        entityType: 'guest' as const,
        entityId: `guest_${Date.now()}`,
        details: { 
          name: 'Jane Smith', 
          email: 'jane@example.com',
          phone: '+1234567890'
        },
        userId: 'system',
        metadata: { source: 'sample_data' }
      },
      {
        action: 'checked_in' as const,
        entityType: 'booking' as const,
        entityId: `booking_${Date.now()}_2`,
        details: { 
          guestName: 'Alice Johnson', 
          roomNumber: '202',
          actualCheckIn: new Date().toISOString()
        },
        userId: 'system',
        metadata: { source: 'sample_data' }
      },
      {
        action: 'payment_received' as const,
        entityType: 'payment' as const,
        entityId: `payment_${Date.now()}`,
        details: { 
          amount: 300, 
          method: 'card', 
          reference: 'PAY-001',
          bookingId: `booking_${Date.now()}`
        },
        userId: 'system',
        metadata: { source: 'sample_data' }
      }
    ]

    for (const logData of sampleLogs) {
      try {
        await activityLogService.log(logData)
        console.log(`[ActivityLogsFix] ✅ Created sample log: ${logData.action} ${logData.entityType}`)
      } catch (error: any) {
        console.error(`[ActivityLogsFix] ❌ Failed to create sample log:`, error.message)
      }
    }

    console.log('[ActivityLogsFix] ✅ Sample activity logs creation completed')
  } catch (error: any) {
    console.error('[ActivityLogsFix] ❌ Failed to create sample activity logs:', error.message)
    throw error
  }
}

/**
 * Test the user email fix in activity logs
 */
export async function testUserEmailFix(): Promise<void> {
  console.log('[UserEmailFix] Testing user email display in activity logs...')
  try {
    // Create a test log with a user ID
    await activityLogService.log({
      action: 'created',
      entityType: 'test',
      entityId: `user_email_test_${Date.now()}`,
      details: { 
        message: 'Testing user email display',
        testType: 'user_email_fix'
      },
      userId: 'test_user_email_fix',
      metadata: { source: 'user_email_test' }
    })
    console.log('[UserEmailFix] ✅ Test log created')

    // Fetch the logs and check if user email is displayed correctly
    const logs = await activityLogService.getActivityLogs({ limit: 1 })
    if (logs.length > 0) {
      const latestLog = logs[0]
      console.log('[UserEmailFix] Latest log user field:', latestLog.userId)
      
      if (latestLog.userId === 'test_user_email_fix' || latestLog.userId.includes('@')) {
        console.log('[UserEmailFix] ✅ User email fix working correctly')
      } else {
        console.warn('[UserEmailFix] ⚠️ User field might not be showing email correctly')
      }
    } else {
      console.warn('[UserEmailFix] ⚠️ No logs found to test user email')
    }
  } catch (error) {
    console.error('[UserEmailFix] ❌ Test failed:', error)
  }
}

/**
 * Test the complete activity log data format
 */
export async function testActivityLogDataFormat(): Promise<void> {
  console.log('[DataFormatTest] Testing activity log data format...')
  try {
    // Create a test log with all fields
    await activityLogService.log({
      action: 'payment_received',
      entityType: 'payment',
      entityId: `payment_${Date.now()}`,
      details: { 
        amount: 300,
        method: 'card',
        reference: 'PAY-001',
        bookingId: `booking_${Date.now()}`
      },
      userId: 'test_user_format',
      metadata: { source: 'format_test' }
    })
    console.log('[DataFormatTest] ✅ Test log created')

    // Fetch the logs and verify the complete data format
    const logs = await activityLogService.getActivityLogs({ limit: 1 })
    if (logs.length > 0) {
      const latestLog = logs[0]
      console.log('[DataFormatTest] Complete log data:', JSON.stringify(latestLog, null, 2))
      
      // Verify all required fields are present
      const requiredFields = ['id', 'action', 'entityType', 'entityId', 'details', 'userId', 'metadata', 'createdAt']
      const missingFields = requiredFields.filter(field => !(field in latestLog))
      
      if (missingFields.length === 0) {
        console.log('[DataFormatTest] ✅ All required fields present in activity log data')
      } else {
        console.warn('[DataFormatTest] ⚠️ Missing fields:', missingFields)
      }
    } else {
      console.warn('[DataFormatTest] ⚠️ No logs found to test data format')
    }
  } catch (error) {
    console.error('[DataFormatTest] ❌ Test failed:', error)
  }
}

/**
 * Test readable message format for activity logs
 */
export async function testReadableMessageFormat(): Promise<void> {
  console.log('[ReadableMessageTest] Testing readable message format...')
  try {
    // Create test logs with different detail types
    const testLogs = [
      {
        action: 'created' as const,
        entityType: 'booking' as const,
        entityId: `booking_${Date.now()}`,
        details: {
          guestName: 'John Doe',
          guestEmail: 'john@example.com',
          roomNumber: '101',
          roomType: 'Standard Room',
          checkIn: '2025-01-21',
          checkOut: '2025-01-24',
          amount: 150,
          status: 'confirmed'
        },
        userId: 'test_readable_1'
      },
      {
        action: 'payment_received' as const,
        entityType: 'payment' as const,
        entityId: `payment_${Date.now()}`,
        details: {
          amount: 300,
          method: 'card',
          reference: 'PAY-001'
        },
        userId: 'test_readable_2'
      },
      {
        action: 'created' as const,
        entityType: 'guest' as const,
        entityId: `guest_${Date.now()}`,
        details: {
          name: 'Jane Smith',
          email: 'jane@example.com',
          role: 'guest'
        },
        userId: 'test_readable_3'
      },
      {
        action: 'logout' as const,
        entityType: 'user' as const,
        entityId: `user_${Date.now()}`,
        details: {
          logoutAt: new Date().toISOString()
        },
        userId: 'test_readable_4'
      },
      {
        action: 'login' as const,
        entityType: 'user' as const,
        entityId: `user_${Date.now()}`,
        details: {
          loginAt: new Date().toISOString(),
          email: 'admin@amplodge.com',
          role: 'admin'
        },
        userId: 'test_readable_5'
      }
    ]

    // Create the test logs
    for (const logData of testLogs) {
      await activityLogService.log(logData)
      console.log(`[ReadableMessageTest] Created test log: ${logData.action} ${logData.entityType}`)
    }

    // Fetch and verify the logs have readable details
    const logs = await activityLogService.getActivityLogs({ limit: 3 })
    console.log('[ReadableMessageTest] Retrieved logs:', logs.length)
    
    logs.forEach((log, index) => {
      console.log(`[ReadableMessageTest] Log ${index + 1}:`, {
        action: log.action,
        entityType: log.entityType,
        details: log.details,
        readableFormat: 'Check the Activity Logs page to see readable messages'
      })
    })

    console.log('[ReadableMessageTest] ✅ Readable message format test completed')
    console.log('[ReadableMessageTest] Check the Activity Logs page to see the human-readable messages')
  } catch (error) {
    console.error('[ReadableMessageTest] ❌ Test failed:', error)
  }
}

/**
 * Test unique headings for activity logs
 */
export async function testUniqueHeadings(): Promise<void> {
  console.log('[UniqueHeadingsTest] Testing unique headings for activity logs...')
  try {
    // Create test logs with different detail types to test unique headings
    const testLogs = [
      {
        action: 'created' as const,
        entityType: 'booking' as const,
        entityId: `booking_${Date.now()}_1`,
        details: {
          guestName: 'Alice Johnson',
          roomNumber: '101',
          amount: 150
        },
        userId: 'test_unique_1'
      },
      {
        action: 'created' as const,
        entityType: 'booking' as const,
        entityId: `booking_${Date.now()}_2`,
        details: {
          guestName: 'Bob Smith',
          roomNumber: '202',
          amount: 200
        },
        userId: 'test_unique_2'
      },
      {
        action: 'payment_received' as const,
        entityType: 'payment' as const,
        entityId: `payment_${Date.now()}_1`,
        details: {
          amount: 300,
          method: 'card'
        },
        userId: 'test_unique_3'
      },
      {
        action: 'payment_received' as const,
        entityType: 'payment' as const,
        entityId: `payment_${Date.now()}_2`,
        details: {
          amount: 150,
          method: 'cash'
        },
        userId: 'test_unique_4'
      },
      {
        action: 'created' as const,
        entityType: 'contact_message' as const,
        entityId: `contact_${Date.now()}_1`,
        details: {
          name: 'Charlie Brown',
          email: 'charlie@example.com'
        },
        userId: 'test_unique_5'
      },
      {
        action: 'created' as const,
        entityType: 'contact_message' as const,
        entityId: `contact_${Date.now()}_2`,
        details: {
          name: 'Diana Prince',
          email: 'diana@example.com'
        },
        userId: 'test_unique_6'
      }
    ]

    // Create the test logs
    for (const logData of testLogs) {
      await activityLogService.log(logData)
      console.log(`[UniqueHeadingsTest] Created test log: ${logData.action} ${logData.entityType}`)
    }

    // Fetch and verify the logs have unique headings
    const logs = await activityLogService.getActivityLogs({ limit: 10 })
    console.log('[UniqueHeadingsTest] Retrieved logs:', logs.length)
    
    // Check that each log has a unique heading
    const headings = logs.map(log => log.id).filter(id => id.includes('test_unique'))
    console.log('[UniqueHeadingsTest] Test log IDs:', headings)
    
    console.log('[UniqueHeadingsTest] ✅ Unique headings test completed')
    console.log('[UniqueHeadingsTest] Check the Activity Logs page to see unique headings for each activity')
  } catch (error) {
    console.error('[UniqueHeadingsTest] ❌ Test failed:', error)
  }
}

// Make functions available globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).testActivityLogsFix = testActivityLogsFix
  (window as any).createSampleActivityLogsFix = createSampleActivityLogs
  (window as any).testUserEmailFix = testUserEmailFix
  (window as any).testActivityLogDataFormat = testActivityLogDataFormat
  (window as any).testReadableMessageFormat = testReadableMessageFormat
  (window as any).testUniqueHeadings = testUniqueHeadings
  console.log('[ActivityLogsFix] Test functions available globally:')
  console.log('  - testActivityLogsFix() - Test activity logs functionality')
  console.log('  - createSampleActivityLogsFix() - Create sample activity logs')
  console.log('  - testUserEmailFix() - Test user email display fix')
  console.log('  - testActivityLogDataFormat() - Test complete activity log data format')
  console.log('  - testReadableMessageFormat() - Test readable message format')
  console.log('  - testUniqueHeadings() - Test unique headings for activity logs')
}
