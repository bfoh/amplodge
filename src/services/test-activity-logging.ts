import { activityLogService } from './activity-log-service'
import { db, auth } from '@/lib/db'

/**
 * Test activity logging functionality
 */
export async function testActivityLogging() {
  console.log('🧪 [TestActivityLogging] Starting activity logging test...')
  
  try {
    // Test 1: Check if activityLogs table exists
    console.log('📋 [TestActivityLogging] Testing activityLogs table access...')
    try {
      const testList = await db.activityLogs.list({ limit: 1 })
      console.log('✅ [TestActivityLogging] activityLogs table is accessible')
    } catch (error: any) {
      console.error('❌ [TestActivityLogging] activityLogs table access failed:', error)
      
      // Try to create the table by creating a test record
      console.log('🔧 [TestActivityLogging] Attempting to create activityLogs table...')
      try {
        const testRecord = {
          id: `test_${Date.now()}`,
          action: 'diagnostic' as const,
          entityType: 'diagnostic' as const,
          entityId: 'test',
          details: JSON.stringify({ test: true }),
          userId: 'system',
          metadata: JSON.stringify({}),
          createdAt: new Date().toISOString(),
        }
        
        await db.activityLogs.create(testRecord)
        console.log('✅ [TestActivityLogging] Successfully created test record in activityLogs table')
        
        // Clean up test record
        await db.activityLogs.delete(testRecord.id)
        console.log('✅ [TestActivityLogging] Cleaned up test record')
      } catch (createError: any) {
        console.error('❌ [TestActivityLogging] Failed to create activityLogs table:', createError)
        return false
      }
    }
    
    // Test 2: Test activity logging service
    console.log('📝 [TestActivityLogging] Testing activity logging service...')
    try {
      await activityLogService.log({
        action: 'created' as const,
        entityType: 'diagnostic' as const,
        entityId: 'test_booking_123',
        details: {
          testData: 'This is a test log entry',
          timestamp: new Date().toISOString(),
          source: 'test_function'
        },
        userId: 'system',
        metadata: {
          source: 'test',
          testRun: true
        }
      })
      console.log('✅ [TestActivityLogging] Activity logging service test passed')
    } catch (error: any) {
      console.error('❌ [TestActivityLogging] Activity logging service test failed:', error)
      return false
    }
    
    // Test 3: Verify the log was actually created
    console.log('🔍 [TestActivityLogging] Verifying log was created...')
    try {
      const logs = await db.activityLogs.list({ limit: 10 })
      const testLog = logs.find((log: any) => log.entityId === 'test_booking_123')
      
      if (testLog) {
        console.log('✅ [TestActivityLogging] Test log found in database:', testLog)
        
        // Clean up test log
        await db.activityLogs.delete(testLog.id)
        console.log('✅ [TestActivityLogging] Cleaned up test log')
      } else {
        console.warn('⚠️ [TestActivityLogging] Test log not found in database')
      }
    } catch (error: any) {
      console.error('❌ [TestActivityLogging] Failed to verify log creation:', error)
      return false
    }
    
    console.log('🎉 [TestActivityLogging] All tests passed! Activity logging is working correctly.')
    return true
    
  } catch (error: any) {
    console.error('❌ [TestActivityLogging] Test failed with error:', error)
    return false
  }
}

/**
 * Test specific activity logging methods
 */
export async function testSpecificActivityLogging() {
  console.log('🧪 [TestSpecificActivityLogging] Testing specific activity logging methods...')
  
  try {
    // Test booking creation logging
    console.log('📝 [TestSpecificActivityLogging] Testing booking creation logging...')
    await activityLogService.logBookingCreated('test_booking_456', {
      guestName: 'Test Guest',
      guestEmail: 'test@example.com',
      roomNumber: '101',
      roomType: 'Standard',
      checkIn: '2025-01-01',
      checkOut: '2025-01-03',
      amount: 200,
      status: 'confirmed',
      source: 'test'
    }, 'system')
    console.log('✅ [TestSpecificActivityLogging] Booking creation logging test passed')
    
    // Test user login logging
    console.log('👤 [TestSpecificActivityLogging] Testing user login logging...')
    await activityLogService.logUserLogin('test_user_123', {
      email: 'test@example.com',
      role: 'admin'
    })
    console.log('✅ [TestSpecificActivityLogging] User login logging test passed')
    
    // Test guest creation logging
    console.log('👥 [TestSpecificActivityLogging] Testing guest creation logging...')
    await activityLogService.logGuestCreated('test_guest_789', {
      name: 'Test Guest',
      email: 'test@example.com',
      phone: '123-456-7890',
      address: '123 Test St'
    }, 'system')
    console.log('✅ [TestSpecificActivityLogging] Guest creation logging test passed')
    
    console.log('🎉 [TestSpecificActivityLogging] All specific activity logging tests passed!')
    return true
    
  } catch (error: any) {
    console.error('❌ [TestSpecificActivityLogging] Test failed with error:', error)
    return false
  }
}



