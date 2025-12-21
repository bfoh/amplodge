import { Resend } from 'resend';
import { Buffer } from 'node:buffer';

export const handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Get API key from environment (check both variable names for compatibility)
    const resendApiKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;

    if (!resendApiKey) {
        console.error('[send-email] Neither RESEND_API_KEY nor VITE_RESEND_API_KEY configured');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Email service not configured - missing API key' })
        };
    }

    console.log('[send-email] API key found, processing request...');

    try {
        const payload = JSON.parse(event.body);

        // Validate required fields
        if (!payload.to || !payload.subject || !payload.html) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: to, subject, html' })
            };
        }

        const resend = new Resend(resendApiKey);

        // Prepare email payload
        const emailPayload = {
            from: payload.from || 'AMP Lodge <noreply@updates.amplodge.org>',
            to: payload.to,
            subject: payload.subject,
            html: payload.html,
            text: payload.text || undefined,
            replyTo: payload.replyTo || undefined,
        };

        // Handle attachments if present
        if (payload.attachments && Array.isArray(payload.attachments)) {
            emailPayload.attachments = payload.attachments.map(att => {
                // Handle base64 encoded content
                let content = att.content;
                if (typeof content === 'string' && content.includes(',')) {
                    // Handle data URL format (e.g., "data:application/pdf;base64,...")
                    content = content.split(',')[1];
                }
                return {
                    filename: att.filename,
                    content: Buffer.from(content, 'base64'),
                    contentType: att.contentType || 'application/octet-stream'
                };
            });
        }

        console.log('[send-email] Sending email to:', payload.to, 'Subject:', payload.subject);

        const { data, error } = await resend.emails.send(emailPayload);

        if (error) {
            console.error('[send-email] Resend error:', error);
            return {
                statusCode: 400,
                body: JSON.stringify({ success: false, error: error.message })
            };
        }

        console.log('[send-email] Email sent successfully, ID:', data?.id);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                id: data?.id,
                message: 'Email sent successfully'
            })
        };

    } catch (error) {
        console.error('[send-email] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: error.message || 'Failed to send email'
            })
        };
    }
};
