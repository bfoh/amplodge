import { Resend } from 'resend';
import { Buffer } from 'node:buffer';
import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js';

export const handler = async (event) => {
    const corsResp = handleCors(event); if (corsResp) return corsResp

    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    // Any authenticated staff member can trigger transactional emails:
    // booking confirmation, check-in/out receipt, stay-extension, task
    // assignment, etc. These are part of normal hotel operations, not
    // admin-only actions. Admin-only gating here previously caused
    // silent 403s for non-admin staff doing routine work.
    try {
        await requireStaff(event);
    } catch (e) {
        return jsonResponse(e.status, e.body);
    }

    // Get API key from environment (check both variable names for compatibility)
    const resendApiKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;

    if (!resendApiKey) {
        console.error('[send-email] Neither RESEND_API_KEY nor VITE_RESEND_API_KEY configured');
        return jsonResponse(500, {
            success: false,
            error: 'Email service not configured (missing RESEND_API_KEY on the server)'
        });
    }

    console.log('[send-email] API key found, processing request...');

    try {
        const payload = JSON.parse(event.body);

        // Validate required fields
        if (!payload.to || !payload.subject || !payload.html) {
            return jsonResponse(400, {
                success: false,
                error: 'Missing required fields: to, subject, html'
            });
        }

        // Validate recipient looks like an email — Resend rejects empty/garbage
        // recipients with a 400 that bubbles up as "Email notification failed"
        // without telling the operator what went wrong.
        const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
        const invalid = recipients.find(r => !r || !String(r).includes('@'));
        if (invalid !== undefined) {
            return jsonResponse(400, {
                success: false,
                error: `Invalid recipient email: ${JSON.stringify(invalid)}`
            });
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
            return jsonResponse(400, {
                success: false,
                error: error.message || error.name || 'Resend rejected the email'
            });
        }

        console.log('[send-email] Email sent successfully, ID:', data?.id);

        return jsonResponse(200, {
            success: true,
            id: data?.id,
            message: 'Email sent successfully'
        });

    } catch (error) {
        console.error('[send-email] Error:', error);
        return jsonResponse(500, {
            success: false,
            error: error.message || 'Failed to send email'
        });
    }
};
