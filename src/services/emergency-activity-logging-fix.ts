import { blink } from '../blink/client'
import { activityLogService } from './activity-log-service'

/**
 * Force create activityLogs table if it doesn't exist
 */
export async function forceCreateActivityLogsTable() {
  console.log('🔧 [ForceCreateActivityLogsTable] Starting...')
  
  try {
    const db = blink.db as any
    
    // Try to access the table first
    try {
      await db.activityLogs.list({ limit: 1 })
      console.log('✅ [ForceCreateActivityLogsTable] activityLogs table already exists')
      return true
    } catch (error: any) {
      console.log('⚠️ [ForceCreateActivityLogsTable] activityLogs table does not exist, creating...')
    }
    
    // Force create the table by creating a record
    const initRecord = {
      id: `init_${Date.now()}`,
      action: 'initialization',
      entityType: 'system',
      entityId: 'system_init',
      details: JSON.stringify({ initialization: true }),
      userId: 'system',
      metadata: JSON.stringify({ source: 'force_create' }),
      createdAt: new Date().toISOString(),
    }
    
    await db.activityLogs.create(initRecord)
    console.log('✅ [ForceCreateActivityLogsTable] Successfully created activityLogs table')
    
    // Clean up initialization record
    await db.activityLogs.delete(initRecord.id)
    console.log('✅ [ForceCreateActivityLogsTable] Cleaned up initialization record')
    
    return true
    
  } catch (error: any) {
    console.error('❌ [ForceCreateActivityLogsTable] Failed to create activityLogs table:', error)
    return false
  }
}

/**
 * Test activity logging with detailed error reporting
 */
export async function testActivityLoggingDetailed() {
  console.log('🧪 [TestActivityLoggingDetailed] Starting detailed test...')
  
  try {
    const db = blink.db as any
    
    // Step 1: Force create table
    console.log('📋 [TestActivityLoggingDetailed] Step 1: Ensuring table exists...')
    const tableCreated = await forceCreateActivityLogsTable()
    if (!tableCreated) {
      console.error('❌ [TestActivityLoggingDetailed] Failed to create table')
      return false
    }
    
    // Step 2: Test direct database write
    console.log('📝 [TestActivityLoggingDetailed] Step 2: Testing direct database write...')
    const testRecord = {
      id: `detailed_test_${Date.now()}`,
      action: 'detailed_test',
      entityType: 'test',
      entityId: 'detailed_test_123',
      details: JSON.stringify({ detailedTest: true }),
      userId: 'system',
      metadata: JSON.stringify({ source: 'detailed_test' }),
      createdAt: new Date().toISOString(),
    }
    
    await db.activityLogs.create(testRecord)
    console.log('✅ [TestActivityLoggingDetailed] Direct database write successful')
    
    // Step 3: Verify record was created
    console.log('🔍 [TestActivityLoggingDetailed] Step 3: Verifying record...')
    const logs = await db.activityLogs.list({ limit: 10 })
    const foundRecord = logs.find((log: any) => log.id === testRecord.id)
    
    if (foundRecord) {
      console.log('✅ [TestActivityLoggingDetailed] Record found:', foundRecord)
    } else {
      console.error('❌ [TestActivityLoggingDetailed] Record not found')
      return false
    }
    
    // Step 4: Test activity log service
    console.log('🔧 [TestActivityLoggingDetailed] Step 4: Testing activity log service...')
    try {
      await activityLogService.log({
        action: 'service_test',
        entityType: 'test',
        entityId: 'service_test_456',
        details: { serviceTest: true },
        userId: 'system',
        metadata: { source: 'detailed_test' }
      })
      console.log('✅ [TestActivityLoggingDetailed] Activity log service test passed')
    } catch (error: any) {
      console.error('❌ [TestActivityLoggingDetailed] Activity log service test failed:', error)
      return false
    }
    
    // Step 5: Verify service log was created
    console.log('🔍 [TestActivityLoggingDetailed] Step 5: Verifying service log...')
    const serviceLogs = await db.activityLogs.list({ limit: 10 })
    const foundServiceLog = serviceLogs.find((log: any) => log.entityId === 'service_test_456')
    
    if (foundServiceLog) {
      console.log('✅ [TestActivityLoggingDetailed] Service log found:', foundServiceLog)
    } else {
      console.error('❌ [TestActivityLoggingDetailed] Service log not found')
      return false
    }
    
    // Clean up test records
    console.log('🧹 [TestActivityLoggingDetailed] Cleaning up test records...')
    try {
      await db.activityLogs.delete(testRecord.id)
      console.log('✅ [TestActivityLoggingDetailed] Cleaned up direct test record')
    } catch (error) {
      console.warn('⚠️ [TestActivityLoggingDetailed] Could not clean up direct test record:', error)
    }
    
    try {
      if (foundServiceLog) {
        await db.activityLogs.delete(foundServiceLog.id)
        console.log('✅ [TestActivityLoggingDetailed] Cleaned up service test record')
      }
    } catch (error) {
      console.warn('⚠️ [TestActivityLoggingDetailed] Could not clean up service test record:', error)
    }
    
    console.log('🎉 [TestActivityLoggingDetailed] All tests passed!')
    return true
    
  } catch (error: any) {
    console.error('❌ [TestActivityLoggingDetailed] Test failed:', error)
    return false
  }
}

/**
 * Emergency fix for activity logging
 */
export async function emergencyFixActivityLogging() {
  console.log('🚨 [EmergencyFixActivityLogging] Starting emergency fix...')
  
  try {
    // Step 1: Force create table
    await forceCreateActivityLogsTable()
    
    // Step 2: Set current user
    try {
      const currentUser = await blink.auth.me()
      if (currentUser) {
        activityLogService.setCurrentUser(currentUser.id)
        console.log('✅ [EmergencyFixActivityLogging] Set current user:', currentUser.email)
      } else {
        activityLogService.setCurrentUser('system')
        console.log('✅ [EmergencyFixActivityLogging] Set system user')
      }
    } catch (error) {
      console.warn('⚠️ [EmergencyFixActivityLogging] Failed to set user, using system:', error)
      activityLogService.setCurrentUser('system')
    }
    
    // Step 3: Test logging
    await activityLogService.log({
      action: 'emergency_fix',
      entityType: 'system',
      entityId: 'emergency_fix_test',
      details: { emergencyFix: true },
      userId: 'system',
      metadata: { source: 'emergency_fix' }
    })
    
    console.log('✅ [EmergencyFixActivityLogging] Emergency fix completed')
    return true
    
  } catch (error: any) {
    console.error('❌ [EmergencyFixActivityLogging] Emergency fix failed:', error)
    return false
  }
}



