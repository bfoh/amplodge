/**
 * Fix utility for logout logs showing "Unknown User"
 */

import { blink } from '@/blink/client'
import { activityLogService } from '@/services/activity-log-service'

/**
 * Fix existing logout logs that show "Unknown User" by updating them with proper user information
 */
export async function fixLogoutUnknownUserLogs(): Promise<number> {
  console.log('[FixLogoutUnknownUser] Starting fix for logout logs showing "Unknown User"...')
  const db = blink.db as any
  let fixedCount = 0

  try {
    const allLogs = await db.contact_messages.list({
      where: { status: 'activity_log' }
    })
    
    console.log(`[FixLogoutUnknownUser] Found ${allLogs.length} activity logs to check`)

    // Find logout logs with "Unknown User"
    const logoutLogsToFix = allLogs.filter((log: any) => {
      try {
        const messageData = JSON.parse(log.message)
        return messageData.action === 'logout' && 
               messageData.entityType === 'user' && 
               (!messageData.details.email || messageData.details.email === 'Unknown User')
      } catch {
        return false
      }
    })

    console.log(`[FixLogoutUnknownUser] Found ${logoutLogsToFix.length} logout logs to fix`)

    // Fix each logout log
    for (const log of logoutLogsToFix) {
      try {
        const messageData = JSON.parse(log.message)
        
        // Try to get user email from the log's email field or entity ID
        let userEmail = log.email || 'Unknown User'
        
        // If we still don't have a proper email, try to get it from the entity ID
        if (userEmail === 'Unknown User' && messageData.entityId) {
          // The entity ID might contain user information
          userEmail = messageData.entityId
        }

        // Update the message data with the proper email
        const updatedMessageData = {
          ...messageData,
          details: {
            ...messageData.details,
            email: userEmail
          }
        }

        // Update the log entry
        await db.contact_messages.update(log.id, {
          message: JSON.stringify(updatedMessageData)
        })

        fixedCount++
        console.log(`[FixLogoutUnknownUser] Fixed logout log: ${log.id} - Email: ${userEmail}`)

      } catch (error) {
        console.error(`[FixLogoutUnknownUser] Failed to fix log ${log.id}:`, error)
      }
    }

    console.log(`[FixLogoutUnknownUser] ✅ Successfully fixed ${fixedCount} logout logs`)
    return fixedCount

  } catch (error) {
    console.error('[FixLogoutUnknownUser] Error during fix:', error)
    return 0
  }
}

/**
 * Test the logout logging with proper user email
 */
export async function testLogoutLoggingWithEmail(): Promise<void> {
  console.log('[TestLogoutEmail] Testing logout logging with proper email...')
  
  try {
    // Test logout logging with user details
    await activityLogService.logUserLogout('test_user_123', { 
      email: 'test@example.com' 
    })
    
    console.log('[TestLogoutEmail] ✅ Logout logging with email test completed')
    console.log('[TestLogoutEmail] Check the Activity Logs page and History page to see the logout entry with proper email')
    
  } catch (error) {
    console.error('[TestLogoutEmail] ❌ Test failed:', error)
  }
}

/**
 * Test multiple logout scenarios
 */
export async function testMultipleLogoutScenarios(): Promise<void> {
  console.log('[TestMultipleLogout] Testing multiple logout scenarios...')
  
  try {
    const testUsers = [
      { id: 'user_1', email: 'john@example.com' },
      { id: 'user_2', email: 'alice@example.com' },
      { id: 'user_3', email: 'bob@example.com' }
    ]

    // Test logout logging for each user
    for (const user of testUsers) {
      await activityLogService.logUserLogout(user.id, { email: user.email })
      console.log(`[TestMultipleLogout] Logged logout for: ${user.email}`)
    }
    
    console.log('[TestMultipleLogout] ✅ Multiple logout scenarios test completed')
    console.log('[TestMultipleLogout] Check the History page to see logout entries with proper emails:')
    console.log('[TestMultipleLogout] - "User logged out - john@example.com"')
    console.log('[TestMultipleLogout] - "User logged out - alice@example.com"')
    console.log('[TestMultipleLogout] - "User logged out - bob@example.com"')

  } catch (error) {
    console.error('[TestMultipleLogout] ❌ Test failed:', error)
  }
}

/**
 * Clean up test logout logs
 */
export async function cleanupTestLogoutLogs(): Promise<void> {
  console.log('[CleanupTestLogout] Cleaning up test logout logs...')
  
  try {
    const db = blink.db as any
    
    // Get all activity logs
    const activityLogs = await db.contact_messages.list({
      where: { status: 'activity_log' }
    })
    
    // Filter test logout logs
    const testLogs = activityLogs.filter((log: any) => {
      try {
        const messageData = JSON.parse(log.message)
        return messageData.action === 'logout' && 
               (messageData.entityId?.includes('test_user') || 
                messageData.details?.email?.includes('test@example.com') ||
                messageData.details?.email?.includes('john@example.com') ||
                messageData.details?.email?.includes('alice@example.com') ||
                messageData.details?.email?.includes('bob@example.com'))
      } catch {
        return false
      }
    })
    
    console.log(`[CleanupTestLogout] Found ${testLogs.length} test logout logs to delete`)
    
    // Delete test logs
    for (const log of testLogs) {
      try {
        await db.contact_messages.delete(log.id)
        console.log(`[CleanupTestLogout] Deleted test logout log: ${log.id}`)
      } catch (error) {
        console.error(`[CleanupTestLogout] Failed to delete log:`, error)
      }
    }
    
    console.log('[CleanupTestLogout] ✅ Test logout logs cleaned up')

  } catch (error) {
    console.error('[CleanupTestLogout] ❌ Cleanup failed:', error)
  }
}

// Make functions globally accessible for console access
if (typeof window !== 'undefined') {
  (window as any).fixLogoutUnknownUserLogs = fixLogoutUnknownUserLogs
  (window as any).testLogoutLoggingWithEmail = testLogoutLoggingWithEmail
  (window as any).testMultipleLogoutScenarios = testMultipleLogoutScenarios
  (window as any).cleanupTestLogoutLogs = cleanupTestLogoutLogs
  console.log('[FixLogoutUnknownUser] Fix functions available globally:')
  console.log('  - fixLogoutUnknownUserLogs() - Fix existing logout logs showing "Unknown User"')
  console.log('  - testLogoutLoggingWithEmail() - Test logout logging with proper email')
  console.log('  - testMultipleLogoutScenarios() - Test multiple logout scenarios')
  console.log('  - cleanupTestLogoutLogs() - Clean up test logout logs')
}
