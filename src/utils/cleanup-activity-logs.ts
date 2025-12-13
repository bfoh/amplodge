/**
 * Cleanup utility for activity logs
 * Removes all test data and ensures unique IDs
 */

import { activityLogService } from '@/services/activity-log-service'
import { blink } from '@/blink/client'

/**
 * Clean up all test data from activity logs
 */
export async function cleanupTestActivityLogs(): Promise<void> {
  console.log('[CleanupActivityLogs] Starting cleanup of test data...')
  
  try {
    const db = blink.db as any
    
    // Get all activity logs
    const allLogs = await db.contactMessages.list({
      where: { status: 'activity_log' }
    })
    
    console.log(`[CleanupActivityLogs] Found ${allLogs.length} activity logs`)
    
    // Filter out test data based on various criteria
    const testDataPatterns = [
      'test_',
      'Test',
      'TEST',
      'sample_data',
      'test_fix',
      'user_email_test',
      'format_test',
      'readable_test',
      'test_user',
      'test_booking',
      'test_guest',
      'test_payment',
      'test_invoice',
      'test_room',
      'test_staff',
      'system', // Remove system-generated test logs
      'guest' // Remove guest user logs (usually test data)
    ]
    
    const logsToDelete = allLogs.filter((log: any) => {
      try {
        const messageData = JSON.parse(log.message)
        
        // Check if it's test data based on various criteria
        return (
          testDataPatterns.some(pattern => 
            log.email?.includes(pattern) ||
            log.id?.includes(pattern) ||
            messageData.entityId?.includes(pattern) ||
            messageData.userId?.includes(pattern) ||
            JSON.stringify(messageData.details).includes(pattern)
          ) ||
          // Remove logs with test-like entity IDs
          messageData.entityId?.match(/^test_|_test$|test\d+$/) ||
          // Remove logs with system or guest users
          (messageData.userId === 'system' || messageData.userId === 'guest') ||
          // Remove logs with test details
          JSON.stringify(messageData.details).includes('test') ||
          JSON.stringify(messageData.details).includes('Test') ||
          JSON.stringify(messageData.details).includes('sample')
        )
      } catch (error) {
        console.warn('[CleanupActivityLogs] Failed to parse message data for log:', log.id)
        return false
      }
    })
    
    console.log(`[CleanupActivityLogs] Found ${logsToDelete.length} test logs to delete`)
    
    // Delete test logs
    let deletedCount = 0
    for (const log of logsToDelete) {
      try {
        await db.contactMessages.delete(log.id)
        deletedCount++
        console.log(`[CleanupActivityLogarithms] Deleted test log: ${log.id}`)
      } catch (error) {
        console.error(`[CleanupActivityLogs] Failed to delete log ${log.id}:`, error)
      }
    }
    
    console.log(`[CleanupActivityLogs] ✅ Successfully deleted ${deletedCount} test logs`)
    
    // Verify cleanup
    const remainingLogs = await db.contactMessages.list({
      where: { status: 'activity_log' }
    })
    console.log(`[CleanupActivityLogs] Remaining activity logs: ${remainingLogs.length}`)
    
  } catch (error) {
    console.error('[CleanupActivityLogs] ❌ Cleanup failed:', error)
    throw error
  }
}

/**
 * Ensure all activity log entries have unique IDs
 */
export async function ensureUniqueActivityLogIds(): Promise<void> {
  console.log('[UniqueIds] Ensuring all activity logs have unique IDs...')
  
  try {
    const db = blink.db as any
    
    // Get all activity logs
    const allLogs = await db.contactMessages.list({
      where: { status: 'activity_log' }
    })
    
    console.log(`[UniqueIds] Found ${allLogs.length} activity logs to check`)
    
    const seenIds = new Set<string>()
    const duplicateIds: string[] = []
    
    // Check for duplicate IDs
    for (const log of allLogs) {
      if (seenIds.has(log.id)) {
        duplicateIds.push(log.id)
      } else {
        seenIds.add(log.id)
      }
    }
    
    if (duplicateIds.length > 0) {
      console.log(`[UniqueIds] Found ${duplicateIds.length} duplicate IDs:`, duplicateIds)
      
      // Fix duplicate IDs
      for (const duplicateId of duplicateIds) {
        const duplicateLogs = allLogs.filter((log: any) => log.id === duplicateId)
        
        // Keep the first one, regenerate IDs for the rest
        for (let i = 1; i < duplicateLogs.length; i++) {
          const log = duplicateLogs[i]
          const newId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          
          try {
            // Update the log with new ID
            await db.contactMessages.update(log.id, { id: newId })
            console.log(`[UniqueIds] Updated duplicate ID ${log.id} to ${newId}`)
          } catch (error) {
            console.error(`[UniqueIds] Failed to update duplicate ID ${log.id}:`, error)
          }
        }
      }
    } else {
      console.log('[UniqueIds] ✅ All activity log IDs are unique')
    }
    
    // Verify all IDs are now unique
    const updatedLogs = await db.contactMessages.list({
      where: { status: 'activity_log' }
    })
    
    const finalIds = new Set<string>()
    const finalDuplicates: string[] = []
    
    for (const log of updatedLogs) {
      if (finalIds.has(log.id)) {
        finalDuplicates.push(log.id)
      } else {
        finalIds.add(log.id)
      }
    }
    
    if (finalDuplicates.length === 0) {
      console.log('[UniqueIds] ✅ All activity log IDs are now unique')
    } else {
      console.warn(`[UniqueIds] ⚠️ Still found ${finalDuplicates.length} duplicate IDs after cleanup`)
    }
    
  } catch (error) {
    console.error('[UniqueIds] ❌ Failed to ensure unique IDs:', error)
    throw error
  }
}

/**
 * Complete cleanup: remove test data and ensure unique IDs
 */
export async function completeActivityLogsCleanup(): Promise<void> {
  console.log('[CompleteCleanup] Starting complete activity logs cleanup...')
  
  try {
    // Step 1: Clean up test data
    await cleanupTestActivityLogs()
    
    // Step 2: Ensure unique IDs
    await ensureUniqueActivityLogIds()
    
    console.log('[CompleteCleanup] ✅ Complete cleanup finished successfully')
    
  } catch (error) {
    console.error('[CompleteCleanup] ❌ Complete cleanup failed:', error)
    throw error
  }
}

// Make functions globally accessible for console access
if (typeof window !== 'undefined') {
  (window as any).cleanupTestActivityLogs = cleanupTestActivityLogs
  (window as any).ensureUniqueActivityLogIds = ensureUniqueActivityLogIds
  (window as any).completeActivityLogsCleanup = completeActivityLogsCleanup
  console.log('[CleanupActivityLogs] Cleanup functions available globally:')
  console.log('  - cleanupTestActivityLogs() - Remove all test data')
  console.log('  - ensureUniqueActivityLogIds() - Ensure all IDs are unique')
  console.log('  - completeActivityLogsCleanup() - Complete cleanup (recommended)')
}





