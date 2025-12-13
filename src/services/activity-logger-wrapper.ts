/**
 * Activity Logger Wrapper
 * This service provides automatic activity logging for common operations
 */

import { activityLogService } from './activity-log-service'
import { blink } from '@/blink/client'

/**
 * Wrapper class that automatically logs activities when operations are performed
 */
export class ActivityLoggerWrapper {
  /**
   * Log booking creation
   */
  static async logBookingCreated(bookingData: any, userId?: string) {
    try {
      await activityLogService.logBookingCreated(
        bookingData.id || `booking_${Date.now()}`,
        {
          guestName: bookingData.guest?.fullName || bookingData.guestName,
          guestEmail: bookingData.guest?.email || bookingData.guestEmail,
          roomNumber: bookingData.roomNumber,
          roomType: bookingData.roomType,
          checkIn: bookingData.dates?.checkIn || bookingData.checkIn,
          checkOut: bookingData.dates?.checkOut || bookingData.checkOut,
          amount: bookingData.amount,
          status: bookingData.status,
          source: bookingData.source || 'staff',
        },
        userId
      )
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log booking creation:', error)
    }
  }

  /**
   * Log booking update
   */
  static async logBookingUpdated(bookingId: string, changes: any, userId?: string) {
    try {
      await activityLogService.logBookingUpdated(bookingId, changes, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log booking update:', error)
    }
  }

  /**
   * Log booking cancellation
   */
  static async logBookingCancelled(bookingId: string, reason: string, userId?: string) {
    try {
      await activityLogService.logBookingCancelled(bookingId, reason, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log booking cancellation:', error)
    }
  }

  /**
   * Log check-in
   */
  static async logCheckIn(bookingId: string, details: any, userId?: string) {
    try {
      await activityLogService.logCheckIn(bookingId, details, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log check-in:', error)
    }
  }

  /**
   * Log check-out
   */
  static async logCheckOut(bookingId: string, details: any, userId?: string) {
    try {
      await activityLogService.logCheckOut(bookingId, details, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log check-out:', error)
    }
  }

  /**
   * Log guest creation
   */
  static async logGuestCreated(guestData: any, userId?: string) {
    try {
      await activityLogService.logGuestCreated(
        guestData.id || `guest_${Date.now()}`,
        {
          name: guestData.name || guestData.fullName,
          email: guestData.email,
          phone: guestData.phone,
          address: guestData.address,
        },
        userId
      )
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log guest creation:', error)
    }
  }

  /**
   * Log guest update
   */
  static async logGuestUpdated(guestId: string, changes: any, userId?: string) {
    try {
      await activityLogService.logGuestUpdated(guestId, changes, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log guest update:', error)
    }
  }

  /**
   * Log guest deletion
   */
  static async logGuestDeleted(guestId: string, guestName: string, userId?: string) {
    try {
      await activityLogService.logGuestDeleted(guestId, guestName, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log guest deletion:', error)
    }
  }

  /**
   * Log staff creation
   */
  static async logStaffCreated(staffData: any, userId?: string) {
    try {
      await activityLogService.logStaffCreated(
        staffData.id || `staff_${Date.now()}`,
        {
          name: staffData.name,
          email: staffData.email,
          role: staffData.role,
          department: staffData.department,
        },
        userId
      )
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log staff creation:', error)
    }
  }

  /**
   * Log staff update
   */
  static async logStaffUpdated(staffId: string, changes: any, userId?: string) {
    try {
      await activityLogService.logStaffUpdated(staffId, changes, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log staff update:', error)
    }
  }

  /**
   * Log staff deletion
   */
  static async logStaffDeleted(staffId: string, staffName: string, userId?: string) {
    try {
      await activityLogService.logStaffDeleted(staffId, staffName, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log staff deletion:', error)
    }
  }

  /**
   * Log invoice creation
   */
  static async logInvoiceCreated(invoiceData: any, userId?: string) {
    try {
      await activityLogService.logInvoiceCreated(
        invoiceData.id || `invoice_${Date.now()}`,
        {
          invoiceNumber: invoiceData.invoiceNumber,
          guestName: invoiceData.guestName,
          guestEmail: invoiceData.guestEmail,
          totalAmount: invoiceData.totalAmount,
          status: invoiceData.status,
          itemCount: invoiceData.items?.length || 0,
        },
        userId
      )
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log invoice creation:', error)
    }
  }

  /**
   * Log invoice update
   */
  static async logInvoiceUpdated(invoiceId: string, changes: any, userId?: string) {
    try {
      await activityLogService.logInvoiceUpdated(invoiceId, changes, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log invoice update:', error)
    }
  }

  /**
   * Log invoice deletion
   */
  static async logInvoiceDeleted(invoiceId: string, invoiceNumber: string, userId?: string) {
    try {
      await activityLogService.logInvoiceDeleted(invoiceId, invoiceNumber, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log invoice deletion:', error)
    }
  }

  /**
   * Log payment received
   */
  static async logPaymentReceived(paymentData: any, userId?: string) {
    try {
      await activityLogService.logPaymentReceived(
        paymentData.id || `payment_${Date.now()}`,
        {
          bookingId: paymentData.bookingId,
          amount: paymentData.amount,
          method: paymentData.method,
          reference: paymentData.reference,
          status: paymentData.status,
        },
        userId
      )
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log payment received:', error)
    }
  }

  /**
   * Log room creation
   */
  static async logRoomCreated(roomData: any, userId?: string) {
    try {
      await activityLogService.logRoomCreated(
        roomData.id || `room_${Date.now()}`,
        {
          roomNumber: roomData.roomNumber,
          roomType: roomData.roomType,
          status: roomData.status,
          price: roomData.price,
        },
        userId
      )
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log room creation:', error)
    }
  }

  /**
   * Log room update
   */
  static async logRoomUpdated(roomId: string, changes: any, userId?: string) {
    try {
      await activityLogService.logRoomUpdated(roomId, changes, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log room update:', error)
    }
  }

  /**
   * Log room deletion
   */
  static async logRoomDeleted(roomId: string, roomNumber: string, userId?: string) {
    try {
      await activityLogService.logRoomDeleted(roomId, roomNumber, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log room deletion:', error)
    }
  }

  /**
   * Log task completion
   */
  static async logTaskCompleted(taskData: any, userId?: string) {
    try {
      await activityLogService.logTaskCompleted(
        taskData.id || `task_${Date.now()}`,
        {
          title: taskData.title,
          roomNumber: taskData.roomNumber,
          completedBy: taskData.completedBy,
          completedAt: taskData.completedAt,
        },
        userId
      )
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log task completion:', error)
    }
  }

  /**
   * Log settings change
   */
  static async logSettingsChanged(settingId: string, changes: any, userId?: string) {
    try {
      await activityLogService.logSettingsChanged(settingId, changes, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log settings change:', error)
    }
  }

  /**
   * Log report export
   */
  static async logReportExported(reportType: string, filters: any, userId?: string) {
    try {
      await activityLogService.logReportExported(reportType, filters, userId)
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to log report export:', error)
    }
  }

  /**
   * Get current user ID for logging
   */
  static async getCurrentUserId(): Promise<string | null> {
    try {
      const user = await blink.auth.me()
      return user?.id || null
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to get current user:', error)
      return null
    }
  }

  /**
   * Get current user email for display purposes
   */
  static async getCurrentUserEmail(): Promise<string | null> {
    try {
      const user = await blink.auth.me()
      return user?.email || null
    } catch (error) {
      console.error('[ActivityLoggerWrapper] Failed to get current user email:', error)
      return null
    }
  }
}

// Export convenience functions
export const logBookingCreated = ActivityLoggerWrapper.logBookingCreated
export const logBookingUpdated = ActivityLoggerWrapper.logBookingUpdated
export const logBookingCancelled = ActivityLoggerWrapper.logBookingCancelled
export const logCheckIn = ActivityLoggerWrapper.logCheckIn
export const logCheckOut = ActivityLoggerWrapper.logCheckOut
export const logGuestCreated = ActivityLoggerWrapper.logGuestCreated
export const logGuestUpdated = ActivityLoggerWrapper.logGuestUpdated
export const logGuestDeleted = ActivityLoggerWrapper.logGuestDeleted
export const logStaffCreated = ActivityLoggerWrapper.logStaffCreated
export const logStaffUpdated = ActivityLoggerWrapper.logStaffUpdated
export const logStaffDeleted = ActivityLoggerWrapper.logStaffDeleted
export const logInvoiceCreated = ActivityLoggerWrapper.logInvoiceCreated
export const logInvoiceUpdated = ActivityLoggerWrapper.logInvoiceUpdated
export const logInvoiceDeleted = ActivityLoggerWrapper.logInvoiceDeleted
export const logPaymentReceived = ActivityLoggerWrapper.logPaymentReceived
export const logRoomCreated = ActivityLoggerWrapper.logRoomCreated
export const logRoomUpdated = ActivityLoggerWrapper.logRoomUpdated
export const logRoomDeleted = ActivityLoggerWrapper.logRoomDeleted
export const logTaskCompleted = ActivityLoggerWrapper.logTaskCompleted
export const logSettingsChanged = ActivityLoggerWrapper.logSettingsChanged
export const logReportExported = ActivityLoggerWrapper.logReportExported
export const getCurrentUserId = ActivityLoggerWrapper.getCurrentUserId
export const getCurrentUserEmail = ActivityLoggerWrapper.getCurrentUserEmail
