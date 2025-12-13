import { cleanupTestBookings, getBookingStatistics, identifyTestBookings } from './cleanup-test-bookings'

/**
 * Test script for booking cleanup functionality
 */

export async function testBookingCleanup() {
  try {
    console.log('🧪 [TestBookingCleanup] Starting booking cleanup test...')
    
    // Step 1: Get current statistics
    console.log('📊 [TestBookingCleanup] Getting current booking statistics...')
    const stats = await getBookingStatistics()
    console.log('📊 [TestBookingCleanup] Current statistics:', stats)
    
    // Step 2: Identify test bookings
    console.log('🔍 [TestBookingCleanup] Identifying test bookings...')
    const testBookings = await identifyTestBookings()
    console.log(`🎯 [TestBookingCleanup] Found ${testBookings.length} test bookings`)
    
    if (testBookings.length === 0) {
      console.log('✅ [TestBookingCleanup] No test bookings found! Your database is clean.')
      return { success: true, message: 'No test bookings found' }
    }
    
    // Step 3: Show test bookings details
    console.log('📋 [TestBookingCleanup] Test bookings details:')
    testBookings.forEach((booking, index) => {
      console.log(`  ${index + 1}. ${booking.guestName} (${booking.guestEmail}) - Room ${booking.roomNumber} - ${booking.status}`)
    })
    
    // Step 4: Clean up test bookings
    console.log('🗑️ [TestBookingCleanup] Cleaning up test bookings...')
    const result = await cleanupTestBookings()
    
    console.log('🎉 [TestBookingCleanup] Cleanup completed!')
    console.log(`📊 [TestBookingCleanup] Result: ${result.deleted} deleted, ${result.failed} failed`)
    
    // Step 5: Get updated statistics
    console.log('📊 [TestBookingCleanup] Getting updated statistics...')
    const updatedStats = await getBookingStatistics()
    console.log('📊 [TestBookingCleanup] Updated statistics:', updatedStats)
    
    return {
      success: true,
      message: `Successfully cleaned up ${result.deleted} test bookings`,
      result
    }
    
  } catch (error) {
    console.error('❌ [TestBookingCleanup] Test failed:', error)
    return {
      success: false,
      message: `Test failed: ${error}`,
      error
    }
  }
}

export async function quickBookingStats() {
  try {
    console.log('📊 [QuickBookingStats] Getting booking statistics...')
    const stats = await getBookingStatistics()
    console.log('📊 [QuickBookingStats] Current statistics:', stats)
    
    return stats
  } catch (error) {
    console.error('❌ [QuickBookingStats] Failed to get statistics:', error)
    throw error
  }
}

// Make functions globally accessible for console testing
if (typeof window !== 'undefined') {
  (window as any).testBookingCleanup = testBookingCleanup
  (window as any).quickBookingStats = quickBookingStats
}





