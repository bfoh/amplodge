import { Resend } from 'resend'

// Initialize Resend client with API key from environment
const resendApiKey = import.meta.env.VITE_RESEND_API_KEY

if (!resendApiKey) {
    console.warn('[Resend] API key not configured. Email sending will fail.')
}

export const resend = new Resend(resendApiKey || '')

// Email payload type for sending emails
export interface ResendEmailPayload {
    to: string | string[]
    subject: string
    html: string
    text?: string
    from?: string
    replyTo?: string
    attachments?: Array<{
        filename: string
        content: string | Buffer
        contentType?: string
    }>
}

// Default sender email
export const DEFAULT_FROM_EMAIL = 'AMP Lodge <noreply@amplodge.org>'
