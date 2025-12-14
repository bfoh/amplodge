/**
 * Email Service - Frontend API Client
 * 
 * This service sends emails through the Netlify Function at /api/send-email
 * which handles the actual Resend API calls server-side for security.
 */

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

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      console.error(`[EmailService] ${context} failed:`, result.error)
      return { success: false, error: result.error || 'Failed to send email' }
    }

    console.log(`[EmailService] ${context} sent successfully`, { id: result.id })
    return { success: true, id: result.id }

  } catch (error: any) {
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

  const payload: EmailPayload = {
    to: email,
    from: 'AMP Lodge <noreply@updates.amplodge.org>',
    subject: 'Welcome to AMP Lodge Staff Portal',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: #8B4513; padding: 40px 32px; text-align: center;">
          <div style="margin-bottom: 16px;">
            <img src="https://amplodge.org/amp.png" alt="AMP LODGE" style="height: 60px; width: auto; max-width: 200px;" />
          </div>
          <h1 style="color: white; font-size: 28px; margin: 0; font-family: 'Arial', sans-serif; font-weight: 700;">Welcome to AMP Lodge</h1>
          <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 8px 0 0;">Staff Portal Access</p>
        </div>

        <!-- Body -->
        <div style="padding: 40px 32px;">
          <p style="color: #2C2416; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
            Hi <strong>${name}</strong>,
          </p>
          
          <p style="color: #2C2416; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
            You have been added to the AMP Lodge Hotel Management System as a <strong>${role}</strong>.
            Below are your login credentials to access the staff portal.
          </p>

          <!-- Credentials Box -->
          <div style="background: #F5F1E8; border-left: 4px solid #8B6F47; padding: 24px; margin: 32px 0; border-radius: 8px;">
            <div style="margin-bottom: 16px;">
              <div style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Email / Username</div>
              <div style="color: #2C2416; font-size: 16px; font-family: 'Courier New', monospace; font-weight: 600;">${email}</div>
            </div>
            <div>
              <div style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Default Password</div>
              <div style="color: #2C2416; font-size: 20px; font-family: 'Courier New', monospace; font-weight: 700; background: white; padding: 16px; border-radius: 4px; letter-spacing: 2px; text-align: center;">${tempPassword}</div>
            </div>
          </div>

          <!-- Important Notice -->
          <div style="background: #FFF3CD; border: 1px solid #FFE69C; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="color: #856404; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
              <strong>🔒 Security Notice:</strong> This is a default password shared by all new employees.
            </p>
            <p style="color: #856404; font-size: 14px; line-height: 1.5; margin: 0;">
              You <strong>must</strong> create a new secure password immediately after logging in. This is required for your first login and ensures your account security.
            </p>
          </div>

          <!-- CTA Button -->
          <div style="text-align: center; margin: 32px 0;">
            <a href="${loginUrl}" 
               style="display: inline-block; background: #8B6F47; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Access Staff Portal
            </a>
          </div>

          <!-- Instructions -->
          <div style="margin: 32px 0;">
            <h3 style="color: #2C2416; font-size: 18px; margin: 0 0 16px;">Getting Started</h3>
            <ol style="color: #666; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li>Click the button above or visit: <a href="${loginUrl}" style="color: #8B6F47;">${loginUrl}</a></li>
              <li>Enter your email and temporary password</li>
              <li>You will be prompted to create a new secure password</li>
              <li>Access your dashboard and start managing operations</li>
            </ol>
          </div>

          <!-- Support -->
          <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 24px 0 0;">
            If you have any questions or need assistance, please contact your system administrator.
          </p>
        </div>

        <!-- Footer -->
        <div style="background: #F5F1E8; padding: 24px 32px; text-align: center; border-top: 1px solid #E5E1D8;">
          <p style="color: #666; font-size: 12px; margin: 0;">
            © ${new Date().getFullYear()} AMP Lodge Hotel Management System. All rights reserved.
          </p>
          <p style="color: #999; font-size: 11px; margin: 8px 0 0;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      </div>
    `,
    text: `
Welcome to AMP Lodge Staff Portal

Hi ${name},

You have been added to the AMP Lodge Hotel Management System as a ${role}.

Your Login Credentials:
Email/Username: ${email}
Default Password: ${tempPassword}

🔒 SECURITY NOTICE: This is a default password shared by all new employees.
You MUST create a new secure password immediately after logging in.
This is required for your first login and ensures your account security.

Getting Started:
1. Visit: ${loginUrl}
2. Enter your email and temporary password
3. Create a new secure password when prompted
4. Access your dashboard and start managing operations

If you have any questions, please contact your system administrator.

© ${new Date().getFullYear()} AMP Lodge Hotel Management System
    `.trim()
  }

  return sendEmail(payload, 'Staff welcome email')
}

// Export default sender email for backwards compatibility
export const DEFAULT_FROM_EMAIL = 'AMP Lodge <noreply@updates.amplodge.org>'
