/**
 * Test utility for booking deletion logging
 */

import { blink } from '@/blink/client'
import { activityLogService } from '@/services/activity-log-service'

/**
 * Test booking deletion logging by creating a test booking and then deleting it
 */
export async function testBookingDeletionLogging(): Promise<void> {
  console.log('[BookingDeletionTest] Testing booking deletion logging...')
  
  try {
    // Create a test booking first
    const testBooking = {
      id: `booking_${Date.now()}_test`,
      guestId: 'test_guest_id',
      roomNumber: '101',
      checkIn: new Date().toISOString(),
      checkOut: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
      totalPrice: 150,
      status: 'confirmed',
      createdBy: 'test_user',
      createdAt: new Date().toISOString()
    }

    console.log('[BookingDeletionTest] Creating test booking...')
    await blink.db.bookings.create(testBooking)
    console.log('[BookingDeletionTest] Test booking created:', testBooking.id)

    // Simulate the deletion process (similar to what happens in BookingsPage)
    const remoteId = testBooking.id.replace(/^booking_/, 'booking-')
    
    // Get booking details before deletion for logging
    const booking = testBooking
    const guestName = 'Test Guest'
    const roomNumber = booking.roomNumber
    
    // Delete the booking
    await blink.db.bookings.delete(remoteId)
    console.log('[BookingDeletionTest] Test booking deleted:', remoteId)
    
    // Log the booking deletion activity
    await activityLogService.log({
      action: 'deleted',
      entityType: 'booking',
      entityId: remoteId,
      details: {
        guestName: guestName,
        roomNumber: roomNumber,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        amount: booking.totalPrice,
        deletedAt: new Date().toISOString()
      },
      userId: 'test_user',
      metadata: {
        source: 'booking_deletion_test',
        deletedBy: 'staff'
      }
    })
    
    console.log('[BookingDeletionTest] ✅ Booking deletion activity logged successfully')
    console.log('[BookingDeletionTest] Check the History page to see the deletion activity')
    console.log('[BookingDeletionTest] You should see: "Booking deleted - Test Guest (Room 101)"')

  } catch (error) {
    console.error('[BookingDeletionTest] ❌ Test failed:', error)
  }
}

/**
 * Test multiple booking deletions to verify they all appear in history
 */
export async function testMultipleBookingDeletions(): Promise<void> {
  console.log('[MultipleDeletionsTest] Testing multiple booking deletions...')
  
  try {
    const testBookings = [
      {
        id: `booking_${Date.now()}_1`,
        guestName: 'Alice Johnson',
        roomNumber: '201',
        amount: 200
      },
      {
        id: `booking_${Date.now()}_2`,
        guestName: 'Bob Smith',
        roomNumber: '302',
        amount: 175
      },
      {
        id: `booking_${Date.now()}_3`,
        guestName: 'Charlie Brown',
        roomNumber: '405',
        amount: 300
      }
    ]

    // Log deletion activities for each test booking
    for (const booking of testBookings) {
      const remoteId = booking.id.replace(/^booking_/, 'booking-')
      
      await activityLogService.log({
        action: 'deleted',
        entityType: 'booking',
        entityId: remoteId,
        details: {
          guestName: booking.guestName,
          roomNumber: booking.roomNumber,
          checkIn: new Date().toISOString(),
          checkOut: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          amount: booking.amount,
          deletedAt: new Date().toISOString()
        },
        userId: 'test_user',
        metadata: {
          source: 'multiple_deletions_test',
          deletedBy: 'staff'
        }
      })
      
      console.log(`[MultipleDeletionsTest] Logged deletion for: ${booking.guestName} (Room ${booking.roomNumber})`)
    }
    
    console.log('[MultipleDeletionsTest] ✅ Multiple booking deletions logged successfully')
    console.log('[MultipleDeletionsTest] Check the History page to see all deletion activities:')
    console.log('[MultipleDeletionsTest] - "Booking deleted - Alice Johnson (Room 201)"')
    console.log('[MultipleDeletionsTest] - "Booking deleted - Bob Smith (Room 302)"')
    console.log('[MultipleDeletionsTest] - "Booking deleted - Charlie Brown (Room 405)"')

  } catch (error) {
    console.error('[MultipleDeletionsTest] ❌ Test failed:', error)
  }
}

/**
 * Clean up test booking deletion logs
 */
export async function cleanupTestBookingDeletions(): Promise<void> {
  console.log('[CleanupTestDeletions] Cleaning up test booking deletion logs...')
  
  try {
    const db = blink.db as any
    
    // Get all activity logs
    const activityLogs = await db.contact_messages.list({
      where: { status: 'activity_log' }
    })
    
    // Filter test booking deletion logs
    const testDeletionLogs = activityLogs.filter((log: any) => {
      try {
        const messageData = JSON.parse(log.message)
        return messageData.metadata?.source?.includes('test') ||
               messageData.metadata?.source?.includes('deletion_test')
      } catch {
        return false
      }
    })
    
    console.log(`[CleanupTestDeletions] Found ${testDeletionLogs.length} test deletion logs to delete`)
    
    // Delete test deletion logs
    for (const log of testDeletionLogs) {
      try {
        await db.contact_messages.delete(log.id)
        console.log(`[CleanupTestDeletions] Deleted test deletion log: ${log.id}`)
      } catch (error) {
        console.error(`[CleanupTestDeletions] Failed to delete log:`, error)
      }
    }
    
    console.log('[CleanupTestDeletions] ✅ Test booking deletion logs cleaned up')

  } catch (error) {
    console.error('[CleanupTestDeletions] ❌ Cleanup failed:', error)
  }
}

// Make functions globally accessible for console access
if (typeof window !== 'undefined') {
  (window as any).testBookingDeletionLogging = testBookingDeletionLogging
  (window as any).testMultipleBookingDeletions = testMultipleBookingDeletions
  (window as any).cleanupTestBookingDeletions = cleanupTestBookingDeletions
  console.log('[BookingDeletionTest] Test functions available globally:')
  console.log('  - testBookingDeletionLogging() - Test single booking deletion logging')
  console.log('  - testMultipleBookingDeletions() - Test multiple booking deletions')
  console.log('  - cleanupTestBookingDeletions() - Clean up test deletion logs')
}





