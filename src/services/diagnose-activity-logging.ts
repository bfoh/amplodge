import { db, auth } from '@/lib/db'
import { activityLogService } from './activity-log-service'

/**
 * Comprehensive diagnostic tool for activity logging
 */
export async function diagnoseActivityLogging() {
  console.log('🔍 [DiagnoseActivityLogging] Starting comprehensive diagnosis...')
  
  const results = {
    databaseConnection: false,
    activityLogsTableExists: false,
    activityLogsTableWritable: false,
    activityLogServiceWorking: false,
    currentUserSet: false,
    errors: [] as string[]
  }
  
  try {
    // Test 1: Database connection
    console.log('📡 [DiagnoseActivityLogging] Testing database connection...')
    try {
      await db.bookings.list({ limit: 1 })
      results.databaseConnection = true
      console.log('✅ [DiagnoseActivityLogging] Database connection working')
    } catch (error: any) {
      results.errors.push(`Database connection failed: ${error.message}`)
      console.error('❌ [DiagnoseActivityLogging] Database connection failed:', error)
    }
    
    // Test 2: Check if activityLogs table exists
    console.log('📋 [DiagnoseActivityLogging] Checking activityLogs table...')
    try {
      await db.activityLogs.list({ limit: 1 })
      results.activityLogsTableExists = true
      console.log('✅ [DiagnoseActivityLogging] activityLogs table exists')
    } catch (error: any) {
      results.errors.push(`activityLogs table access failed: ${error.message}`)
      console.error('❌ [DiagnoseActivityLogging] activityLogs table access failed:', error)
      
      // Try to create the table
      console.log('🔧 [DiagnoseActivityLogging] Attempting to create activityLogs table...')
      try {
        const testRecord = {
          id: `diagnostic_${Date.now()}`,
          action: 'diagnostic',
          entityType: 'diagnostic',
          entityId: 'diagnostic',
          details: JSON.stringify({ diagnostic: true }),
          userId: 'system',
          metadata: JSON.stringify({}),
          createdAt: new Date().toISOString(),
        }
        
        await db.activityLogs.create(testRecord)
        console.log('✅ [DiagnoseActivityLogging] Successfully created activityLogs table')
        results.activityLogsTableExists = true
        results.activityLogsTableWritable = true
        
        // Clean up test record
        await db.activityLogs.delete(testRecord.id)
        console.log('✅ [DiagnoseActivityLogging] Cleaned up test record')
      } catch (createError: any) {
        results.errors.push(`Failed to create activityLogs table: ${createError.message}`)
        console.error('❌ [DiagnoseActivityLogging] Failed to create activityLogs table:', createError)
      }
    }
    
    // Test 3: Check if activityLogs table is writable
    if (results.activityLogsTableExists) {
      console.log('✍️ [DiagnoseActivityLogging] Testing activityLogs table write access...')
      try {
        const testRecord = {
          id: `write_test_${Date.now()}`,
          action: 'write_test',
          entityType: 'write_test',
          entityId: 'write_test',
          details: JSON.stringify({ writeTest: true }),
          userId: 'system',
          metadata: JSON.stringify({}),
          createdAt: new Date().toISOString(),
        }
        
        await db.activityLogs.create(testRecord)
        console.log('✅ [DiagnoseActivityLogging] activityLogs table is writable')
        results.activityLogsTableWritable = true
        
        // Clean up test record
        await db.activityLogs.delete(testRecord.id)
        console.log('✅ [DiagnoseActivityLogging] Cleaned up write test record')
      } catch (error: any) {
        results.errors.push(`activityLogs table write failed: ${error.message}`)
        console.error('❌ [DiagnoseActivityLogging] activityLogs table write failed:', error)
      }
    }
    
    // Test 4: Check activity log service
    console.log('🔧 [DiagnoseActivityLogging] Testing activity log service...')
    try {
      await activityLogService.log({
        action: 'diagnostic',
        entityType: 'diagnostic',
        entityId: 'diagnostic_service_test',
        details: {
          diagnosticTest: true,
          timestamp: new Date().toISOString()
        },
        userId: 'system',
        metadata: {
          source: 'diagnostic',
          testRun: true
        }
      })
      console.log('✅ [DiagnoseActivityLogging] Activity log service is working')
      results.activityLogServiceWorking = true
    } catch (error: any) {
      results.errors.push(`Activity log service failed: ${error.message}`)
      console.error('❌ [DiagnoseActivityLogging] Activity log service failed:', error)
    }
    
    // Test 5: Check current user
    console.log('👤 [DiagnoseActivityLogging] Checking current user...')
    try {
      const currentUser = await auth.me()
      if (currentUser) {
        activityLogService.setCurrentUser(currentUser.id)
        results.currentUserSet = true
        console.log('✅ [DiagnoseActivityLogging] Current user set:', currentUser.email)
      } else {
        console.log('⚠️ [DiagnoseActivityLogging] No current user found')
      }
    } catch (error: any) {
      results.errors.push(`Current user check failed: ${error.message}`)
      console.error('❌ [DiagnoseActivityLogging] Current user check failed:', error)
    }
    
    // Test 6: Verify recent activity logs
    console.log('📊 [DiagnoseActivityLogging] Checking recent activity logs...')
    try {
      const logs = await activityLogService.getActivityLogs({ limit: 5 })
      console.log(`✅ [DiagnoseActivityLogging] Found ${logs.length} recent activity logs`)
      if (logs.length > 0) {
        console.log('📝 [DiagnoseActivityLogging] Recent logs:', logs.map(log => ({
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          createdAt: log.createdAt
        })))
      }
    } catch (error: any) {
      results.errors.push(`Failed to retrieve activity logs: ${error.message}`)
      console.error('❌ [DiagnoseActivityLogging] Failed to retrieve activity logs:', error)
    }
    
    // Summary
    console.log('📋 [DiagnoseActivityLogging] Diagnosis Summary:')
    console.log(`  Database Connection: ${results.databaseConnection ? '✅' : '❌'}`)
    console.log(`  activityLogs Table Exists: ${results.activityLogsTableExists ? '✅' : '❌'}`)
    console.log(`  activityLogs Table Writable: ${results.activityLogsTableWritable ? '✅' : '❌'}`)
    console.log(`  Activity Log Service: ${results.activityLogServiceWorking ? '✅' : '❌'}`)
    console.log(`  Current User Set: ${results.currentUserSet ? '✅' : '❌'}`)
    
    if (results.errors.length > 0) {
      console.log('❌ [DiagnoseActivityLogging] Errors found:')
      results.errors.forEach(error => console.log(`  - ${error}`))
    }
    
    return results
    
  } catch (error: any) {
    console.error('❌ [DiagnoseActivityLogging] Diagnosis failed:', error)
    results.errors.push(`Diagnosis failed: ${error.message}`)
    return results
  }
}

/**
 * Fix common activity logging issues
 */
export async function fixActivityLoggingIssues() {
  console.log('🔧 [FixActivityLoggingIssues] Starting fixes...')
  
  try {
    // Fix 1: Ensure activityLogs table exists and is properly initialized
    console.log('🔧 [FixActivityLoggingIssues] Ensuring activityLogs table exists...')
    try {
      // Try to create a test record to initialize the table
      const initRecord = {
        id: `init_${Date.now()}`,
        action: 'initialization',
        entityType: 'system',
        entityId: 'system_init',
        details: JSON.stringify({ initialization: true }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'system_init' }),
        createdAt: new Date().toISOString(),
      }
      
      await db.activityLogs.create(initRecord)
      console.log('✅ [FixActivityLoggingIssues] activityLogs table initialized')
      
      // Clean up initialization record
      await db.activityLogs.delete(initRecord.id)
      console.log('✅ [FixActivityLoggingIssues] Cleaned up initialization record')
    } catch (error: any) {
      console.error('❌ [FixActivityLoggingIssues] Failed to initialize activityLogs table:', error)
    }
    
    // Fix 2: Set current user if available
    console.log('🔧 [FixActivityLoggingIssues] Setting current user...')
    try {
      const currentUser = await auth.me()
      if (currentUser) {
        activityLogService.setCurrentUser(currentUser.id)
        console.log('✅ [FixActivityLoggingIssues] Current user set:', currentUser.email)
      } else {
        console.log('⚠️ [FixActivityLoggingIssues] No current user found, using system')
        activityLogService.setCurrentUser('system')
      }
    } catch (error: any) {
      console.error('❌ [FixActivityLoggingIssues] Failed to set current user:', error)
      activityLogService.setCurrentUser('system')
    }
    
    // Fix 3: Test activity logging
    console.log('🔧 [FixActivityLoggingIssues] Testing activity logging...')
    try {
      await activityLogService.log({
        action: 'system_fix',
        entityType: 'system',
        entityId: 'system_fix_test',
        details: {
          fixApplied: true,
          timestamp: new Date().toISOString()
        },
        userId: 'system',
        metadata: {
          source: 'system_fix',
          fixRun: true
        }
      })
      console.log('✅ [FixActivityLoggingIssues] Activity logging test passed')
    } catch (error: any) {
      console.error('❌ [FixActivityLoggingIssues] Activity logging test failed:', error)
    }
    
    console.log('🎉 [FixActivityLoggingIssues] Fixes completed')
    return true
    
  } catch (error: any) {
    console.error('❌ [FixActivityLoggingIssues] Fixes failed:', error)
    return false
  }
}



