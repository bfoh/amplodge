/**
 * The confirmation email for a booking made on the public site.
 *
 * A guest booking online is signed out, so they cannot call send-email — that
 * endpoint takes a recipient and a body from its caller and is therefore
 * staff-only. The result was that no online booking confirmation had ever been
 * delivered: the browser asked, got a 401, and the client logged a success it
 * had not checked.
 *
 * This endpoint is callable by anyone, and is safe to be because it accepts
 * neither of the things that would make it useful to an attacker:
 *
 *   · The RECIPIENT is read from the booking in the database, never from the
 *     request. You cannot address this at somebody else.
 *   · The CONTENT is composed here from those same rows. You cannot put your
 *     own words, links or branding into a message sent from our domain.
 *
 * What the caller may pass is a booking id, and a PDF to attach. Bookings must
 * have been created in the last RECENT_WINDOW_MINUTES, so a booking id cannot
 * be replayed later to mail the same guest again, and requests are rate
 * limited per IP on top of that.
 *
 * The PDF is the group invoice, which is rendered in the browser (jsPDF needs
 * a DOM) and so has to travel with the request. It is capped, and it can only
 * ever reach the address already on the booking.
 */

import { createClient } from '@supabase/supabase-js';
import { jsonResponse, handleCors } from './_lib/auth.js';
import { checkRateLimit, tooManyRequests, clientIp } from './_lib/rate-limit.js';
import { sendMail } from './_lib/mailer.js';

/** A booking older than this cannot have a confirmation sent for it. */
const RECENT_WINDOW_MINUTES = 30;
/** Most rooms one request may confirm. A group of more than this is not a booking. */
const MAX_BOOKINGS = 30;
/**
 * Base64 length cap for the attached invoice (~2.2 MB of PDF).
 *
 * Measured, not guessed: 2.5 MB of base64 sends fine, and a body large enough
 * to matter is refused by the platform before the function even runs
 * ("Stream body too big"), which loses the confirmation entirely. The email is
 * what the guest needs; the invoice is a convenience, and staff can send it
 * from the portal.
 */
const MAX_ATTACHMENT_BASE64 = 3 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function adminClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const comment = (text, name) => {
  const m = (text || '').match(new RegExp('<!-- ' + name + ':(.*?) -->'));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
};

const money = (n) => 'GH₵' + Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (s) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s || '') : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};
const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * What the rooms have actually collected, counted once.
 *
 * Mirrors totalCollected in src/lib/payment-events.ts: payment events are this
 * room's own share and win where present; otherwise the stored amountPaid is
 * used, and a figure repeated across rooms of one batch (the pre-2026-08-21
 * shape, which has no `perRoom` marker) counts once rather than once per room.
 */
export function collected(rows) {
  let total = 0;
  const legacyStamps = new Map(); // amount -> counted already
  for (const b of rows) {
    const sr = b.special_requests || '';
    const events = comment(sr, 'PAYMENT_EVENTS');
    if (Array.isArray(events) && events.length) {
      total += events.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      continue;
    }
    const pd = comment(sr, 'PAYMENT_DATA');
    const amount = Number(pd?.amountPaid) || 0;
    if (amount <= 0) continue;
    if (pd?.perRoom === true) { total += amount; continue; }
    if (legacyStamps.has(amount)) continue;
    legacyStamps.set(amount, true);
    total += amount;
  }
  return Math.round(total * 100) / 100;
}

export function buildEmail(rows, rooms) {
  const first = rows[0];
  const group = comment(first.special_requests || '', 'GROUP_DATA') || {};
  const billing = group.billingContact || {};
  const snapshot = comment(first.special_requests || '', 'GUEST_SNAPSHOT') || {};

  const name = billing.fullName || billing.name || snapshot.name || first.guest_name || 'Guest';
  const reference = group.groupReference || '';
  const total = rows.reduce((s, b) => s + (Number(b.total_price) || 0), 0);
  const paid = Math.min(collected(rows), total);
  const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
  const isGroup = rows.length > 1;

  const roomLines = rows.map(b => {
    const snap = comment(b.special_requests || '', 'GUEST_SNAPSHOT') || {};
    const roomNumber = rooms.get(b.room_id) || comment(b.special_requests || '', 'ROOM_SNAPSHOT')?.roomNumber || '';
    const guest = snap.name ? ` — ${escapeHtml(snap.name)}` : '';
    return `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee">Room ${escapeHtml(roomNumber)}${guest}<br>
        <span style="color:#666;font-size:12px">${escapeHtml(day(b.check_in))} &rarr; ${escapeHtml(day(b.check_out))}</span></td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(b.total_price)}</td>
    </tr>`;
  }).join('');

  const settlement = paid <= 0
    ? `<p style="color:#78350f">Full payment of <strong>${money(total)}</strong> is due upon check-in.</p>`
    : balance > 0
      ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin:12px 0">
           <p style="margin:0;color:#92400e;font-weight:bold">Part payment received</p>
           <p style="margin:4px 0 0;color:#78350f">Paid: <strong>${money(paid)}</strong></p>
           <p style="margin:4px 0 0;color:#dc2626">Balance: <strong>${money(balance)}</strong> — due at check-in</p>
           <p style="margin:4px 0 0;color:#555;font-style:italic">This payment is not refundable</p>
         </div>`
      : `<p style="color:#16a34a;font-weight:bold">Full payment of ${money(paid)} received. Thank you!</p>
         <p style="color:#555;font-style:italic">This payment is not refundable</p>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f5f2">
  <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:600px;margin:0 auto;background:#fff;padding:28px;color:#333">
    <h1 style="color:#8B4513;font-size:22px;margin:0 0 4px">Booking Confirmed</h1>
    <p style="color:#666;margin:0 0 20px">AMP LODGE &middot; Kumasi, Ghana</p>

    <p>Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p>Your reservation for ${rows.length} room${rows.length === 1 ? '' : 's'} is confirmed${reference ? ` under reference <strong>${escapeHtml(reference)}</strong>` : ''}.</p>

    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      ${roomLines}
      <tr><td style="padding:8px 0;font-weight:bold">Total</td>
          <td style="padding:8px 0;text-align:right;font-weight:bold">${money(total)}</td></tr>
    </table>

    ${settlement}

    <p style="margin-top:20px"><strong>Before you arrive:</strong></p>
    <ul style="color:#444">
      <li>Check-in is from 2:00 PM</li>
      <li>Please present valid ID for each guest on arrival</li>
    </ul>

    <p style="margin-top:24px">We look forward to welcoming you.<br><strong>The AMP LODGE Team</strong></p>
    <p style="color:#999;font-size:11px;margin-top:24px">AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi &middot; +233 55 500 9697</p>
  </div></body></html>`;

  const text = `Your booking at AMP LODGE is confirmed.\n\n`
    + (reference ? `Reference: ${reference}\n` : '')
    + `Rooms: ${rows.length}\nTotal: ${money(total)}\nPaid: ${money(paid)}\nBalance due: ${money(balance)}\n\n`
    + `Check-in is from 2:00 PM.`;

  const subject = isGroup
    ? `Group Booking Confirmation${reference ? ` - ${reference}` : ''} | AMP Lodge`
    : 'Booking Confirmed - AMP Lodge';

  return { subject, html, text, reference };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const limit = await checkRateLimit(event, { endpoint: 'send-booking-confirmation', limit: 12, windowSeconds: 3600 });
  if (!limit.allowed) return tooManyRequests(CORS);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON body' });
  }

  const ids = Array.isArray(body.bookingIds) ? body.bookingIds.filter(id => typeof id === 'string') : [];
  if (ids.length === 0) return jsonResponse(400, { success: false, error: 'bookingIds is required' });
  if (ids.length > MAX_BOOKINGS) return jsonResponse(400, { success: false, error: 'Too many bookings in one request' });

  let sb;
  try { sb = adminClient(); } catch (e) {
    console.error('[send-booking-confirmation]', e.message);
    return jsonResponse(500, { success: false, error: 'Server not configured' });
  }

  const { data: rows, error } = await sb
    .from('bookings')
    .select('id,guest_id,room_id,check_in,check_out,total_price,status,created_at,special_requests')
    .in('id', ids);

  if (error) {
    console.error('[send-booking-confirmation] Lookup failed:', error.message);
    return jsonResponse(500, { success: false, error: 'Could not read the booking' });
  }
  if (!rows || rows.length === 0) return jsonResponse(404, { success: false, error: 'No such booking' });

  // Only just-made bookings. Without this, any id ever seen could be replayed
  // to mail that guest again, as often as the rate limit allows.
  const cutoff = Date.now() - RECENT_WINDOW_MINUTES * 60 * 1000;
  const stale = rows.filter(b => !b.created_at || new Date(b.created_at).getTime() < cutoff);
  if (stale.length) {
    console.warn('[send-booking-confirmation] Refused: booking older than the window', clientIp(event));
    return jsonResponse(403, { success: false, error: 'This booking is no longer eligible for a confirmation email' });
  }

  // The recipient comes from the booking, never from the request.
  const first = rows[0];
  const group = comment(first.special_requests || '', 'GROUP_DATA') || {};
  const billing = group.billingContact || {};
  let to = billing.email || comment(first.special_requests || '', 'GUEST_SNAPSHOT')?.email || '';
  if (!to && first.guest_id) {
    const { data: guest } = await sb.from('guests').select('email').eq('id', first.guest_id).maybeSingle();
    to = guest?.email || '';
  }
  if (!to || !to.includes('@') || to.includes('@guest.local')) {
    return jsonResponse(200, { success: false, skipped: true, error: 'No usable email address on this booking' });
  }

  // Room numbers for the lines, resolved here rather than trusted from input.
  const roomIds = [...new Set(rows.map(b => b.room_id).filter(Boolean))];
  const rooms = new Map();
  if (roomIds.length) {
    const { data: props } = await sb.from('properties').select('id,room_number').in('id', roomIds);
    for (const p of props || []) rooms.set(p.id, p.room_number);
  }

  const { subject, html, text, reference } = buildEmail(rows, rooms);

  const attachments = [];
  const pdf = typeof body.invoicePdfBase64 === 'string' ? body.invoicePdfBase64 : '';
  if (pdf) {
    if (pdf.length > MAX_ATTACHMENT_BASE64) {
      console.warn('[send-booking-confirmation] Attachment too large; sending without it');
    } else {
      attachments.push({
        filename: `Invoice-${reference || first.id.slice(0, 8)}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      });
    }
  }

  let result = await sendMail({ to, subject, html, text, ...(attachments.length ? { attachments } : {}) });

  // An attachment must never cost the guest their confirmation. If the send
  // fails with one, try again without it and say so in the response.
  let droppedAttachment = false;
  if (!result.success && attachments.length) {
    console.warn('[send-booking-confirmation] Retrying without the invoice:', result.error);
    droppedAttachment = true;
    result = await sendMail({ to, subject, html, text });
  }

  if (!result.success) {
    console.error('[send-booking-confirmation] Not delivered:', result.error);
    return jsonResponse(502, { success: false, error: result.error });
  }
  console.log('[send-booking-confirmation] Sent', rows.length, 'room(s) to', to,
    droppedAttachment ? '(without the invoice)' : '');
  return jsonResponse(200, { success: true, id: result.id, rooms: rows.length, invoiceAttached: attachments.length > 0 && !droppedAttachment });
};
