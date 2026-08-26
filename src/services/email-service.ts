/**
 * Email Service - Frontend API Client
 * 
 * This service sends emails through the Netlify Function at /api/send-email
 * which handles the actual Resend API calls server-side for security.
 */

import { generateEmailHtml, EMAIL_STYLES } from '@/services/email-template'
import { callFunction } from '@/lib/api'

export interface EmailPayload {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  attachments?: Array<{
    filename: string
    content: string // Base64 encoded content
    contentType?: string
  }>
}

export interface EmailResult {
  success: boolean
  id?: string
  error?: string
}

/**
 * Send an email through the Netlify Function
 */
async function sendEmail(payload: EmailPayload, context = 'Email'): Promise<EmailResult> {
  try {
    console.log(`[EmailService] Sending ${context}...`, {
      to: payload.to,
      subject: payload.subject
    })

    const response = await callFunction('send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    // Check if response is JSON before parsing
    const contentType = response.headers.get('content-type')
    let result: any

    if (contentType && contentType.includes('application/json')) {
      try {
        result = await response.json()
      } catch (parseError) {
        console.warn(`[EmailService] Failed to parse JSON response:`, parseError)
        return { success: false, error: 'Email service returned invalid response. Ensure Netlify dev is running for email functionality.' }
      }
    } else {
      // Non-JSON response (likely proxy error or server unavailable)
      const text = await response.text().catch(() => '')
      console.warn(`[EmailService] Non-JSON response (status ${response.status}):`, text.substring(0, 200))
      return { success: false, error: 'Email service unavailable. Run "netlify dev" for email functionality.' }
    }

    if (!response.ok || !result.success) {
      console.error(`[EmailService] ${context} failed:`, result.error)
      return { success: false, error: result.error || 'Failed to send email' }
    }

    console.log(`[EmailService] ${context} sent successfully`, { id: result.id })
    return { success: true, id: result.id }

  } catch (error: any) {
    // Handle network errors (e.g., proxy failure when netlify dev isn't running)
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.warn(`[EmailService] Network error - email service may not be available:`, error.message)
      return { success: false, error: 'Email service not reachable. Run "netlify dev" for email functionality.' }
    }
    console.error(`[EmailService] ${context} error:`, error)
    return { success: false, error: error?.message || 'Failed to send email' }
  }
}

/**
 * Send a transactional email
 */
export async function sendTransactionalEmail(
  payload: EmailPayload,
  context = 'Transactional email'
): Promise<EmailResult> {
  return sendEmail(payload, context)
}

/**
 * Send welcome email to new staff member with credentials
 */
export interface StaffWelcomeEmailParams {
  name: string
  email: string
  tempPassword: string
  role: string
  loginUrl: string
}

export async function sendStaffWelcomeEmail(params: StaffWelcomeEmailParams): Promise<EmailResult> {
  const { name, email, tempPassword, role, loginUrl } = params

  const htmlContent = generateEmailHtml({
    title: 'Welcome to AMP Lodge',
    preheader: 'Staff Portal Access Credentials',
    content: `
      <p>Hi <strong>${name}</strong>,</p>
      <p>You have been added to the AMP Lodge Hotel Management System as a <strong>${role}</strong>. Below are your login credentials to access the staff portal.</p>
      
      <div style="${EMAIL_STYLES.infoBox}">
        <div style="${EMAIL_STYLES.infoRow}">
          <span style="${EMAIL_STYLES.infoLabel}">Username:</span> ${email}
        </div>
        <div style="${EMAIL_STYLES.infoRow}">
          <span style="${EMAIL_STYLES.infoLabel}">Password:</span> <span style="background: white; padding: 5px 10px; border-radius: 4px; font-family: monospace; font-weight: bold; font-size: 16px;">${tempPassword}</span>
        </div>
        <div style="${EMAIL_STYLES.infoRow}; margin-top: 10px;">
          <span style="${EMAIL_STYLES.infoLabel}">Role:</span> <span style="text-transform: capitalize;">${role}</span>
        </div>
      </div>

      <div style="${EMAIL_STYLES.warningBox}">
        <strong style="${EMAIL_STYLES.warningTitle}">🔒 Security Notice:</strong>
        <span style="${EMAIL_STYLES.warningText}">This is a temporary password. You MUST change it immediately after your first login.</span>
      </div>
      
      <h3 style="margin-top: 30px; font-size: 18px; color: #8B4513;">Next Steps:</h3>
      <ol>
        <li>Click the button below to access the portal</li>
        <li>Login with your temporary credentials</li>
        <li>Follow the prompt to create a secure password</li>
      </ol>
    `,
    callToAction: {
      text: 'Access Staff Portal',
      url: loginUrl,
      color: '#8B4513'
    }
  })

  const payload: EmailPayload = {
    to: email,
    from: 'AMP Lodge <noreply@updates.amplodge.org>',
    subject: 'Welcome to AMP Lodge Staff Portal',
    html: htmlContent,
    text: `
Welcome to AMP Lodge Staff Portal

Hi ${name},

You have been added to the AMP Lodge Hotel Management System as a ${role}.

Your Login Credentials:
Email/Username: ${email}
Default Password: ${tempPassword}

🔒 SECURITY NOTICE: This is a default password. You MUST create a new secure password immediately after logging in.

Getting Started:
1. Visit: ${loginUrl}
2. Enter your email and temporary password
3. Create a new secure password when prompted

If you have any questions, please contact your system administrator.

© ${new Date().getFullYear()} AMP Lodge Hotel Management System
    `.trim()
  }

  return sendEmail(payload, 'Staff welcome email')
}

// Export default sender email for backwards compatibility
export const DEFAULT_FROM_EMAIL = 'AMP Lodge <noreply@updates.amplodge.org>'


/**
 * Ask the server to send the confirmation for a booking just made on the
 * public site.
 *
 * A signed-out guest cannot use sendTransactionalEmail: send-email takes a
 * recipient and a body from its caller, so it is staff-only, and every online
 * booking confirmation was being refused with a 401 nobody read. This endpoint
 * composes the message itself from the booking rows — we pass ids, not
 * content, and not an address.
 *
 * Returns false when the server would not send; callers should log that rather
 * than assume delivery.
 */
export async function requestBookingConfirmation(opts: {
  bookingIds: string[]
  /** The group invoice, rendered in the browser because jsPDF needs a DOM. */
  invoicePdfBase64?: string
}): Promise<boolean> {
  const ids = opts.bookingIds.filter(Boolean)
  if (ids.length === 0) return false

  // The platform refuses an oversized request body before the function runs,
  // which would lose the confirmation along with the invoice. Anything near
  // that limit is left off here rather than gambling the email on it.
  const MAX_PDF_BASE64 = 3 * 1024 * 1024
  let pdf = opts.invoicePdfBase64
  if (pdf && pdf.length > MAX_PDF_BASE64) {
    console.warn('[EmailService] Invoice PDF too large to attach (' + Math.round(pdf.length / 1024) + ' KB); sending without it')
    pdf = undefined
  }
  try {
    const res = await fetch('/.netlify/functions/send-booking-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingIds: ids,
        ...(pdf ? { invoicePdfBase64: pdf } : {}),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.success === false) {
      console.error('[EmailService] Booking confirmation not sent:', res.status, body?.error)
      return false
    }
    console.log('[EmailService] Booking confirmation sent for', ids.length, 'room(s)')
    return true
  } catch (err) {
    console.error('[EmailService] Booking confirmation request failed:', err)
    return false
  }
}
