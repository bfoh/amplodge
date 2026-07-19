/**
 * Transactional email send.
 *
 * Provider selection:
 *   - Primary: Brevo (formerly Sendinblue). Free 300/day forever; no card to
 *     start. Active when BREVO_API_KEY is set.
 *   - Fallback: Resend. Active when BREVO_API_KEY is absent but
 *     RESEND_API_KEY is present. Kept so the email channel survives if Brevo
 *     is misconfigured before being removed entirely.
 *
 * Any authenticated staff member can trigger sends (booking confirmation,
 * check-in/out, stay extension, task assignment, etc).
 */

import { Resend } from 'resend';
import { Buffer } from 'node:buffer';
import { requireStaffOrInternal, jsonResponse, handleCors } from './_lib/auth.js';

const DEFAULT_FROM_EMAIL = 'AMP Lodge <noreply@updates.amplodge.org>';
const DEFAULT_FROM_NAME = 'AMP Lodge';

export const handler = async (event) => {
    const corsResp = handleCors(event); if (corsResp) return corsResp;

    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    try {
        await requireStaffOrInternal(event);
    } catch (e) {
        return jsonResponse(e.status, e.body);
    }

    const brevoKey = process.env.BREVO_API_KEY;
    const resendKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;

    if (!brevoKey && !resendKey) {
        console.error('[send-email] Neither BREVO_API_KEY nor RESEND_API_KEY configured');
        return jsonResponse(500, {
            success: false,
            error: 'Email service not configured (set BREVO_API_KEY on the server)',
        });
    }

    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch {
        return jsonResponse(400, { success: false, error: 'Invalid JSON body' });
    }

    if (!payload.to || !payload.subject || !payload.html) {
        return jsonResponse(400, {
            success: false,
            error: 'Missing required fields: to, subject, html',
        });
    }

    // Validate recipient(s) look like emails before calling upstream so bad
    // inputs return an explicit 400 with the offending value.
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
    const invalid = recipients.find(r => !r || !String(r).includes('@'));
    if (invalid !== undefined) {
        return jsonResponse(400, {
            success: false,
            error: `Invalid recipient email: ${JSON.stringify(invalid)}`,
        });
    }

    try {
        if (brevoKey) {
            return await sendViaBrevo(payload, recipients, brevoKey);
        }
        return await sendViaResend(payload, resendKey);
    } catch (error) {
        console.error('[send-email] Unhandled error:', error);
        return jsonResponse(500, {
            success: false,
            error: error.message || 'Failed to send email',
        });
    }
};

// ─── Brevo ────────────────────────────────────────────────────────────────────

async function sendViaBrevo(payload, recipients, apiKey) {
    // Parse the existing "AMP Lodge <noreply@...>" sender format so Brevo can
    // receive it as { email, name } (Brevo's API doesn't accept the combined
    // string the way Resend does).
    const senderStr = payload.from || DEFAULT_FROM_EMAIL;
    const senderMatch = senderStr.match(/^(.*?)\s*<([^>]+)>$/);
    const sender = senderMatch
        ? { name: senderMatch[1].trim() || DEFAULT_FROM_NAME, email: senderMatch[2].trim() }
        : { name: DEFAULT_FROM_NAME, email: senderStr };

    const body = {
        sender,
        to: recipients.map(email => ({ email })),
        subject: payload.subject,
        htmlContent: payload.html,
        textContent: payload.text || undefined,
        replyTo: payload.replyTo ? { email: payload.replyTo } : undefined,
    };

    if (payload.attachments && Array.isArray(payload.attachments)) {
        body.attachment = payload.attachments.map(att => {
            let content = att.content;
            if (typeof content === 'string' && content.includes(',')) {
                content = content.split(',')[1]; // strip data-URL prefix if present
            }
            return {
                name: att.filename,
                // Brevo expects base64 content as a plain string.
                content: typeof content === 'string'
                    ? content
                    : Buffer.from(content).toString('base64'),
            };
        });
    }

    console.log('[send-email] Sending via Brevo to:', recipients, 'Subject:', payload.subject);

    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': apiKey.trim(),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify(body),
    });

    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }

    if (!r.ok) {
        console.error('[send-email] Brevo rejected:', r.status, parsed || text.slice(0, 200));
        return jsonResponse(400, {
            success: false,
            provider: 'brevo',
            error: parsed?.message || parsed?.error || `Brevo error (HTTP ${r.status})`,
        });
    }

    console.log('[send-email] Brevo accepted, messageId:', parsed?.messageId);
    return jsonResponse(200, {
        success: true,
        provider: 'brevo',
        id: parsed?.messageId,
        message: 'Email sent successfully',
    });
}

// ─── Resend (fallback) ────────────────────────────────────────────────────────

async function sendViaResend(payload, apiKey) {
    const resend = new Resend(apiKey);

    const emailPayload = {
        from: payload.from || DEFAULT_FROM_EMAIL,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text || undefined,
        replyTo: payload.replyTo || undefined,
    };

    if (payload.attachments && Array.isArray(payload.attachments)) {
        emailPayload.attachments = payload.attachments.map(att => {
            let content = att.content;
            if (typeof content === 'string' && content.includes(',')) {
                content = content.split(',')[1];
            }
            return {
                filename: att.filename,
                content: Buffer.from(content, 'base64'),
                contentType: att.contentType || 'application/octet-stream',
            };
        });
    }

    console.log('[send-email] Sending via Resend to:', payload.to, 'Subject:', payload.subject);
    const { data, error } = await resend.emails.send(emailPayload);

    if (error) {
        console.error('[send-email] Resend rejected:', error);
        return jsonResponse(400, {
            success: false,
            provider: 'resend',
            error: error.message || error.name || 'Resend rejected the email',
        });
    }

    console.log('[send-email] Resend accepted, ID:', data?.id);
    return jsonResponse(200, {
        success: true,
        provider: 'resend',
        id: data?.id,
        message: 'Email sent successfully',
    });
}
