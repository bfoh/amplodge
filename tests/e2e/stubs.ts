/** Auto-generated stubs: every export of the notification/email/SMS modules, neutered. */
export const DEFAULT_FROM_EMAIL: any = async (..._a: any[]) => ({ success: true })
export const sendBookingConfirmation: any = async (..._a: any[]) => ({ success: true })
export const sendBookingConfirmationSMS: any = async (..._a: any[]) => ({ success: true })
export const sendCheckInNotification: any = async (..._a: any[]) => ({ success: true })
export const sendCheckInSMS: any = async (..._a: any[]) => ({ success: true })
export const sendCheckOutNotification: any = async (..._a: any[]) => ({ success: true })
export const sendCheckOutSMS: any = async (..._a: any[]) => ({ success: true })
export const sendGroupBookingConfirmation: any = async (...a: any[]) => {
  // Suites assert on what the guest was told, so record the calls.
  ;((globalThis as any).__SENT_GROUP_CONFIRMATIONS__ ||= []).push({ data: a[0], attachments: a[1] })
  return { success: true }
}
export const sendGroupMemberAddedNotification: any = async (..._a: any[]) => ({ success: true })
export const sendGroupMemberUpdatedNotification: any = async (..._a: any[]) => ({ success: true })
export const sendManagerCheckInNotification: any = async (..._a: any[]) => ({ success: true })
export const sendManagerCheckInSMS: any = async (..._a: any[]) => ({ success: true })
export const sendOnlineBookingAlert: any = async (..._a: any[]) => ({ success: true })
export const sendOnlineBookingAlertSMS: any = async (..._a: any[]) => ({ success: true })
export const sendSMS: any = async (..._a: any[]) => ({ success: true })
export const sendSMSWithFallback: any = async (..._a: any[]) => ({ success: true })
export const sendStaffWelcomeEmail: any = async (..._a: any[]) => ({ success: true })
export const sendStayExtensionNotification: any = async (..._a: any[]) => ({ success: true })
export const sendStayExtensionSMS: any = async (..._a: any[]) => ({ success: true })
export const sendTaskAssignmentEmail: any = async (..._a: any[]) => ({ success: true })
export const sendTaskAssignmentSMS: any = async (..._a: any[]) => ({ success: true })
/**
 * Every email the app actually tries to send passes through here — the real
 * notifications module composes them and calls this. Recording the calls is
 * how a suite asserts what a guest was told.
 */
export const sendTransactionalEmail: any = async (...a: any[]) => {
  ;((globalThis as any).__SENT_EMAILS__ ||= []).push({ to: a[0]?.to, subject: a[0]?.subject })
  return { success: true }
}
export const sendWhatsApp: any = async (..._a: any[]) => ({ success: true })
export default {}
