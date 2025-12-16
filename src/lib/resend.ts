/**
 * Resend Configuration
 * 
 * DEPRECATED: This file is no longer used for direct Resend SDK calls.
 * All email sending now goes through the Netlify Function at /.netlify/functions/send-email
 * which keeps the API key server-side for security.
 * 
 * This file is kept for backwards compatibility exports only.
 */

// Re-export from email service for backwards compatibility
export { sendTransactionalEmail, DEFAULT_FROM_EMAIL } from '@/services/email-service'
export type { EmailPayload as ResendEmailPayload } from '@/services/email-service'
