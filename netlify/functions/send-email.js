/**
 * Transactional email send, for staff and for our own functions.
 *
 * The caller supplies the recipient and the body, so this endpoint is
 * authenticated: any authenticated staff member, or another of our functions
 * carrying INTERNAL_FUNCTION_SECRET. Opened up it would be a mail relay
 * sending attacker-written HTML from our domain.
 *
 * A guest booking on the public site has neither credential. Their
 * confirmation goes through send-booking-confirmation, which composes the
 * message itself from the booking rather than accepting one.
 *
 * The provider handling lives in _lib/mailer.js, shared with that endpoint.
 */

import { requireStaffOrInternal, jsonResponse, handleCors } from './_lib/auth.js';
import { sendMail, mailerConfigured } from './_lib/mailer.js';

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

    if (!mailerConfigured()) {
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

    const result = await sendMail(payload);
    // A rejected send is the caller's problem to see: 400 for a bad request
    // upstream, 200 only when a provider actually accepted it.
    return jsonResponse(result.success ? 200 : 400, result);
};
