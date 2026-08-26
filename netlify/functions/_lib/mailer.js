/**
 * Sending an email, provider and all.
 *
 * Extracted from send-email so that more than one endpoint can send without
 * either duplicating the Brevo/Resend handling or having to authenticate as
 * staff. Who is ALLOWED to send is the caller's business; this module only
 * knows how.
 *
 * Provider selection:
 *   - Primary: Brevo. Active when BREVO_API_KEY is set.
 *   - Fallback: Resend, when Brevo is absent but RESEND_API_KEY is present.
 *
 * Returns { success, provider, id?, error? } and never throws for a rejected
 * send — a caller that ignores the result would otherwise report a delivery
 * that never happened.
 */

import { Resend } from 'resend';
import { Buffer } from 'node:buffer';

export const DEFAULT_FROM_EMAIL = 'AMP Lodge <noreply@updates.amplodge.org>';
const DEFAULT_FROM_NAME = 'AMP Lodge';

/** True when at least one provider is configured. */
export function mailerConfigured() {
  return Boolean(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY);
}

function normaliseAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map(att => {
    let content = att.content;
    if (typeof content === 'string' && content.includes(',')) {
      content = content.split(',')[1]; // strip a data-URL prefix if present
    }
    return { ...att, content };
  });
}

/**
 * Send one email. `payload` is { to, subject, html, text?, from?, replyTo?,
 * attachments? } — the same shape send-email has always accepted.
 */
export async function sendMail(payload) {
  const brevoKey = process.env.BREVO_API_KEY;
  const resendKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;

  if (!brevoKey && !resendKey) {
    console.error('[mailer] Neither BREVO_API_KEY nor RESEND_API_KEY configured');
    return { success: false, error: 'Email service not configured (set BREVO_API_KEY on the server)' };
  }

  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
  const invalid = recipients.find(r => !r || !String(r).includes('@'));
  if (invalid !== undefined) {
    return { success: false, error: `Invalid recipient email: ${JSON.stringify(invalid)}` };
  }

  try {
    return brevoKey
      ? await sendViaBrevo(payload, recipients, brevoKey)
      : await sendViaResend(payload, resendKey);
  } catch (error) {
    console.error('[mailer] Unhandled error:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

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

  const attachments = normaliseAttachments(payload.attachments);
  if (attachments.length) {
    body.attachment = attachments.map(att => ({
      name: att.filename,
      // Brevo expects base64 content as a plain string.
      content: typeof att.content === 'string' ? att.content : Buffer.from(att.content).toString('base64'),
    }));
  }

  console.log('[mailer] Sending via Brevo to:', recipients, 'Subject:', payload.subject);

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
    console.error('[mailer] Brevo rejected:', r.status, parsed || text.slice(0, 200));
    return {
      success: false,
      provider: 'brevo',
      error: parsed?.message || parsed?.error || `Brevo error (HTTP ${r.status})`,
    };
  }

  console.log('[mailer] Brevo accepted, messageId:', parsed?.messageId);
  return { success: true, provider: 'brevo', id: parsed?.messageId, message: 'Email sent successfully' };
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

  const attachments = normaliseAttachments(payload.attachments);
  if (attachments.length) {
    emailPayload.attachments = attachments.map(att => ({
      filename: att.filename,
      content: Buffer.from(att.content, 'base64'),
      contentType: att.contentType || 'application/octet-stream',
    }));
  }

  console.log('[mailer] Sending via Resend to:', payload.to, 'Subject:', payload.subject);
  const { data, error } = await resend.emails.send(emailPayload);

  if (error) {
    console.error('[mailer] Resend rejected:', error);
    return {
      success: false,
      provider: 'resend',
      error: error.message || error.name || 'Resend rejected the email',
    };
  }

  console.log('[mailer] Resend accepted, ID:', data?.id);
  return { success: true, provider: 'resend', id: data?.id, message: 'Email sent successfully' };
}
