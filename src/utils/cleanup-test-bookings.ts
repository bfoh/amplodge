import { blink } from '@/blink/client'

/**
 * Cleanup utility to remove test bookings that are affecting room availability
 */

interface TestBooking {
  id: string
  guestName: string
  guestEmail: string
  roomNumber: string
  checkIn: string
  checkOut: string
  status: string
  createdAt: string
}

/**
 * Identify test bookings based on common patterns
 */
function isTestBooking(booking: any): boolean {
  const guestName = booking.guestName?.toLowerCase() || booking.guest?.fullName?.toLowerCase() || ''
  const guestEmail = booking.guestEmail?.toLowerCase() || booking.guest?.email?.toLowerCase() || ''
  const notes = booking.notes?.toLowerCase() || ''
  
  // Common test patterns
  const testPatterns = [
    // Test names
    'test', 'demo', 'sample', 'example', 'trial', 'fake', 'dummy',
    // Test emails
    '@test.', '@example.', '@demo.', '@sample.',
    // Test in notes
    'test booking', 'demo booking', 'sample booking'
  ]
  
  // Check if any pattern matches
  return testPatterns.some(pattern => 
    guestName.includes(pattern) || 
    guestEmail.includes(pattern) || 
    notes.includes(pattern)
  )
}

/**
 * Get all bookings and identify test bookings
 */
export async function identifyTestBookings(): Promise<TestBooking[]> {
  try {
    console.log('🔍 [CleanupTestBookings] Identifying test bookings...')
    
    const db = (blink.db as any)
    const allBookings = await db.bookings.list()
    
    console.log(`📊 [CleanupTestBookings] Found ${allBookings.length} total bookings`)
    
    const testBookings = allBookings
      .filter(isTestBooking)
      .map(booking => ({
        id: booking.id,
        guestName: booking.guestName || booking.guest?.fullName || 'Unknown',
        guestEmail: booking.guestEmail || booking.guest?.email || 'Unknown',
        roomNumber: booking.roomNumber || 'Unknown',
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        status: booking.status,
        createdAt: booking.createdAt
      }))
    
    console.log(`🎯 [CleanupTestBookings] Identified ${testBookings.length} test bookings`)
    
    // Log test bookings for review
    testBookings.forEach((booking, index) => {
      console.log(`📋 [CleanupTestBookings] Test booking ${index + 1}:`, {
        id: booking.id,
        guest: `${booking.guestName} (${booking.guestEmail})`,
        room: booking.roomNumber,
        dates: `${booking.checkIn} to ${booking.checkOut}`,
        status: booking.status
      })
    })
    
    return testBookings
  } catch (error) {
    console.error('❌ [CleanupTestBookings] Failed to identify test bookings:', error)
    throw error
  }
}

/**
 * Delete test bookings
 */
export async function deleteTestBookings(testBookings: TestBooking[]): Promise<{ deleted: number; failed: number }> {
  try {
    console.log(`🗑️ [CleanupTestBookings] Deleting ${testBookings.length} test bookings...`)
    
    const db = (blink.db as any)
    let deleted = 0
    let failed = 0
    
    for (const booking of testBookings) {
      try {
        await db.bookings.delete(booking.id)
        deleted++
        console.log(`✅ [CleanupTestBookings] Deleted test booking: ${booking.guestName} (${booking.id})`)
      } catch (error) {
        failed++
        console.error(`❌ [CleanupTestBookings] Failed to delete booking ${booking.id}:`, error)
      }
    }
    
    console.log(`📊 [CleanupTestBookings] Cleanup completed: ${deleted} deleted, ${failed} failed`)
    
    return { deleted, failed }
  } catch (error) {
    console.error('❌ [CleanupTestBookings] Failed to delete test bookings:', error)
    throw error
  }
}

/**
 * Complete test booking cleanup process
 */
export async function cleanupTestBookings(): Promise<{ identified: number; deleted: number; failed: number }> {
  try {
    console.log('🚀 [CleanupTestBookings] Starting test booking cleanup...')
    
    // Step 1: Identify test bookings
    const testBookings = await identifyTestBookings()
    
    if (testBookings.length === 0) {
      console.log('✅ [CleanupTestBookings] No test bookings found!')
      return { identified: 0, deleted: 0, failed: 0 }
    }
    
    // Step 2: Delete test bookings
    const { deleted, failed } = await deleteTestBookings(testBookings)
    
    console.log(`🎉 [CleanupTestBookings] Cleanup completed successfully!`)
    console.log(`📊 [CleanupTestBookings] Summary: ${testBookings.length} identified, ${deleted} deleted, ${failed} failed`)
    
    return { identified: testBookings.length, deleted, failed }
  } catch (error) {
    console.error('❌ [CleanupTestBookings] Cleanup failed:', error)
    throw error
  }
}

/**
 * Get current booking statistics
 */
export async function getBookingStatistics(): Promise<{
  total: number
  byStatus: Record<string, number>
  testBookings: number
}> {
  try {
    const db = (blink.db as any)
    const allBookings = await db.bookings.list()
    
    const byStatus = allBookings.reduce((acc: Record<string, number>, booking: any) => {
      const status = booking.status || 'unknown'
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})
    
    const testBookings = allBookings.filter(isTestBooking).length
    
    return {
      total: allBookings.length,
      byStatus,
      testBookings
    }
  } catch (error) {
    console.error('❌ [CleanupTestBookings] Failed to get statistics:', error)
    throw error
  }
}

// Make functions globally accessible for console testing
if (typeof window !== 'undefined') {
  (window as any).cleanupTestBookings = cleanupTestBookings
  (window as any).identifyTestBookings = identifyTestBookings
  (window as any).getBookingStatistics = getBookingStatistics
}





