/**
 * Cleanup utility for duplicate activity log entries
 */

import { blink } from '@/blink/client'

/**
 * Clean up duplicate activity log entries that were created due to the previous bug
 */
export async function cleanupDuplicateActivityLogs(): Promise<number> {
  console.log('[CleanupDuplicates] Starting cleanup of duplicate activity log entries...')
  const db = blink.db as any
  let deletedCount = 0

  try {
    // Get all contact messages
    const allMessages = await db.contact_messages.list()
    console.log(`[CleanupDuplicates] Found ${allMessages.length} total contact messages`)

    // Find activity logs with "Contact message from Deleted Booking" pattern
    const duplicatePatterns = [
      /Contact message from Deleted Booking/,
      /Contact message from.*Deleted Booking/,
      /Unknown Guest.*Room \d+/
    ]

    const duplicatesToDelete = allMessages.filter((msg: any) => {
      // Check if it's an activity log with duplicate patterns
      if (msg.status === 'activity_log') {
        try {
          const messageData = JSON.parse(msg.message)
          // Check if it's a booking deletion with "Unknown Guest"
          if (messageData.action === 'deleted' && 
              messageData.entityType === 'booking' && 
              messageData.details?.guestName === 'Unknown Guest') {
            return true
          }
        } catch (error) {
          // If we can't parse the message, check the name field
          if (duplicatePatterns.some(pattern => pattern.test(msg.name))) {
            return true
          }
        }
      }
      return false
    })

    console.log(`[CleanupDuplicates] Found ${duplicatesToDelete.length} duplicate entries to delete`)

    // Delete duplicate entries
    for (const duplicate of duplicatesToDelete) {
      try {
        await db.contact_messages.delete(duplicate.id)
        deletedCount++
        console.log(`[CleanupDuplicates] Deleted duplicate entry: ${duplicate.name}`)
      } catch (error) {
        console.error(`[CleanupDuplicates] Failed to delete duplicate ${duplicate.id}:`, error)
      }
    }

    console.log(`[CleanupDuplicates] ✅ Successfully deleted ${deletedCount} duplicate entries`)
    return deletedCount

  } catch (error) {
    console.error('[CleanupDuplicates] Error during cleanup:', error)
    return 0
  }
}

/**
 * Clean up all test activity logs that were created during testing
 */
export async function cleanupTestActivityLogs(): Promise<number> {
  console.log('[CleanupTestLogs] Starting cleanup of test activity logs...')
  const db = blink.db as any
  let deletedCount = 0

  try {
    // Get all contact messages
    const allMessages = await db.contact_messages.list()
    
    // Find test activity logs
    const testLogs = allMessages.filter((msg: any) => {
      if (msg.status === 'activity_log') {
        try {
          const messageData = JSON.parse(msg.message)
          return messageData.metadata?.source?.includes('test') ||
                 messageData.metadata?.source?.includes('deletion_test') ||
                 messageData.entityId?.includes('test') ||
                 messageData.details?.guestName === 'Test Guest'
        } catch {
          return false
        }
      }
      return false
    })

    console.log(`[CleanupTestLogs] Found ${testLogs.length} test logs to delete`)

    // Delete test logs
    for (const testLog of testLogs) {
      try {
        await db.contact_messages.delete(testLog.id)
        deletedCount++
        console.log(`[CleanupTestLogs] Deleted test log: ${testLog.id}`)
      } catch (error) {
        console.error(`[CleanupTestLogs] Failed to delete test log ${testLog.id}:`, error)
      }
    }

    console.log(`[CleanupTestLogs] ✅ Successfully deleted ${deletedCount} test logs`)
    return deletedCount

  } catch (error) {
    console.error('[CleanupTestLogs] Error during cleanup:', error)
    return 0
  }
}

/**
 * Perform complete cleanup of duplicate and test activity logs
 */
export async function completeActivityLogsCleanup(): Promise<void> {
  console.log('[CompleteCleanup] Starting complete activity logs cleanup...')
  
  const duplicateCount = await cleanupDuplicateActivityLogs()
  const testCount = await cleanupTestActivityLogs()
  
  console.log(`[CompleteCleanup] ✅ Cleanup completed:`)
  console.log(`  - Deleted ${duplicateCount} duplicate entries`)
  console.log(`  - Deleted ${testCount} test entries`)
  console.log(`  - Total deleted: ${duplicateCount + testCount} entries`)
}

// Make functions globally accessible for console access
if (typeof window !== 'undefined') {
  (window as any).cleanupDuplicateActivityLogs = cleanupDuplicateActivityLogs
  (window as any).cleanupTestActivityLogs = cleanupTestActivityLogs
  (window as any).completeActivityLogsCleanup = completeActivityLogsCleanup
  console.log('[CleanupDuplicates] Cleanup functions available globally:')
  console.log('  - cleanupDuplicateActivityLogs() - Remove duplicate entries')
  console.log('  - cleanupTestActivityLogs() - Remove test entries')
  console.log('  - completeActivityLogsCleanup() - Complete cleanup')
}





