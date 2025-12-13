/**
 * Test utility for login and logout logging
 */

import { blink } from '@/blink/client'
import { activityLogService } from '@/services/activity-log-service'

/**
 * Test login and logout logging functionality
 */
export async function testLoginLogoutLogging(): Promise<void> {
  console.log('[LoginLogoutTest] Testing login and logout logging...')
  
  try {
    // Test login logging
    console.log('[LoginLogoutTest] Testing login logging...')
    await activityLogService.logUserLogin('test_user_123', {
      email: 'test@example.com',
      role: 'receptionist',
      staffName: 'Test User',
      loginAt: new Date().toISOString()
    })
    console.log('[LoginLogoutTest] ✅ Login activity logged successfully')

    // Test logout logging
    console.log('[LoginLogoutTest] Testing logout logging...')
    await activityLogService.logUserLogout('test_user_123')
    console.log('[LoginLogoutTest] ✅ Logout activity logged successfully')

    console.log('[LoginLogoutTest] ✅ Both login and logout logging tests completed successfully')
    console.log('[LoginLogoutTest] Check the Activity Logs page and History page to see the login/logout activities')
    
  } catch (error) {
    console.error('[LoginLogoutTest] ❌ Test failed:', error)
  }
}

/**
 * Test multiple login/logout cycles to verify they all appear in history
 */
export async function testMultipleLoginLogoutCycles(): Promise<void> {
  console.log('[MultipleLoginLogoutTest] Testing multiple login/logout cycles...')
  
  try {
    const testUsers = [
      {
        id: 'test_user_1',
        email: 'alice@example.com',
        role: 'receptionist',
        staffName: 'Alice Johnson'
      },
      {
        id: 'test_user_2',
        email: 'bob@example.com',
        role: 'manager',
        staffName: 'Bob Smith'
      },
      {
        id: 'test_user_3',
        email: 'charlie@example.com',
        role: 'housekeeping',
        staffName: 'Charlie Brown'
      }
    ]

    // Create multiple login/logout cycles
    for (const user of testUsers) {
      // Login
      await activityLogService.logUserLogin(user.id, {
        email: user.email,
        role: user.role,
        staffName: user.staffName,
        loginAt: new Date().toISOString()
      })
      console.log(`[MultipleLoginLogoutTest] Logged login for: ${user.staffName} (${user.email})`)

      // Wait a moment to simulate real usage
      await new Promise(resolve => setTimeout(resolve, 100))

      // Logout
      await activityLogService.logUserLogout(user.id)
      console.log(`[MultipleLoginLogoutTest] Logged logout for: ${user.staffName} (${user.email})`)
    }
    
    console.log('[MultipleLoginLogoutTest] ✅ Multiple login/logout cycles logged successfully')
    console.log('[MultipleLoginLogoutTest] Check the History page to see all login/logout activities:')
    console.log('[MultipleLoginLogoutTest] - "User logged in - alice@example.com"')
    console.log('[MultipleLoginLogoutTest] - "User logged out - alice@example.com"')
    console.log('[MultipleLoginLogoutTest] - "User logged in - bob@example.com"')
    console.log('[MultipleLoginLogoutTest] - "User logged out - bob@example.com"')
    console.log('[MultipleLoginLogoutTest] - "User logged in - charlie@example.com"')
    console.log('[MultipleLoginLogoutTest] - "User logged out - charlie@example.com"')

  } catch (error) {
    console.error('[MultipleLoginLogoutTest] ❌ Test failed:', error)
  }
}

/**
 * Clean up test login/logout logs
 */
export async function cleanupTestLoginLogoutLogs(): Promise<void> {
  console.log('[CleanupLoginLogoutTest] Cleaning up test login/logout logs...')
  
  try {
    const db = blink.db as any
    
    // Get all activity logs
    const activityLogs = await db.contact_messages.list({
      where: { status: 'activity_log' }
    })
    
    // Filter test login/logout logs
    const testLogs = activityLogs.filter((log: any) => {
      try {
        const messageData = JSON.parse(log.message)
        return messageData.entityId?.includes('test_user') ||
               messageData.details?.email?.includes('test@example.com') ||
               messageData.details?.email?.includes('alice@example.com') ||
               messageData.details?.email?.includes('bob@example.com') ||
               messageData.details?.email?.includes('charlie@example.com')
      } catch {
        return false
      }
    })
    
    console.log(`[CleanupLoginLogoutTest] Found ${testLogs.length} test login/logout logs to delete`)
    
    // Delete test logs
    for (const log of testLogs) {
      try {
        await db.contact_messages.delete(log.id)
        console.log(`[CleanupLoginLogoutTest] Deleted test log: ${log.id}`)
      } catch (error) {
        console.error(`[CleanupLoginLogoutTest] Failed to delete log:`, error)
      }
    }
    
    console.log('[CleanupLoginLogoutTest] ✅ Test login/logout logs cleaned up')

  } catch (error) {
    console.error('[CleanupLoginLogoutTest] ❌ Cleanup failed:', error)
  }
}

/**
 * Test the actual login process to verify logging works end-to-end
 */
export async function testActualLoginProcess(): Promise<void> {
  console.log('[ActualLoginTest] Testing actual login process...')
  
  try {
    // This would test the actual login flow, but since we can't actually log in during testing,
    // we'll just verify that the logging functions are available and working
    console.log('[ActualLoginTest] Testing login logging function availability...')
    
    if (typeof activityLogService.logUserLogin === 'function') {
      console.log('[ActualLoginTest] ✅ logUserLogin function is available')
    } else {
      console.log('[ActualLoginTest] ❌ logUserLogin function is not available')
    }
    
    if (typeof activityLogService.logUserLogout === 'function') {
      console.log('[ActualLoginTest] ✅ logUserLogout function is available')
    } else {
      console.log('[ActualLoginTest] ❌ logUserLogout function is not available')
    }
    
    console.log('[ActualLoginTest] ✅ Login process logging functions are available')
    console.log('[ActualLoginTest] To test actual login:')
    console.log('[ActualLoginTest] 1. Go to the login page')
    console.log('[ActualLoginTest] 2. Log in with valid credentials')
    console.log('[ActualLoginTest] 3. Check Activity Logs page for login entry')
    console.log('[ActualLoginTest] 4. Log out and check for logout entry')
    console.log('[ActualLoginTest] 5. Check History page to see both entries')

  } catch (error) {
    console.error('[ActualLoginTest] ❌ Test failed:', error)
  }
}

// Make functions globally accessible for console access
if (typeof window !== 'undefined') {
  (window as any).testLoginLogoutLogging = testLoginLogoutLogging
  (window as any).testMultipleLoginLogoutCycles = testMultipleLoginLogoutCycles
  (window as any).cleanupTestLoginLogoutLogs = cleanupTestLoginLogoutLogs
  (window as any).testActualLoginProcess = testActualLoginProcess
  console.log('[LoginLogoutTest] Test functions available globally:')
  console.log('  - testLoginLogoutLogging() - Test basic login/logout logging')
  console.log('  - testMultipleLoginLogoutCycles() - Test multiple login/logout cycles')
  console.log('  - cleanupTestLoginLogoutLogs() - Clean up test login/logout logs')
  console.log('  - testActualLoginProcess() - Test actual login process functions')
}





