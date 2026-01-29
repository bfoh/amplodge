const { createClient } = require('@supabase/supabase-js');

// Helper: Send SMS
async function sendSms(to, message, apiKey) {
    try {
        let recipient = to.replace(/[^\d]/g, '');
        if (recipient.startsWith('0')) recipient = '233' + recipient.substring(1);
        else if (!recipient.startsWith('233') && recipient.length === 9) recipient = '233' + recipient;

        const url = `https://sms.arkesel.com/sms/api?action=send-sms&api_key=${apiKey}&to=${recipient}&from=AMP Lodge&sms=${encodeURIComponent(message)}`;
        const res = await fetch(url);
        const text = await res.text();
        console.log(`[SMS] To: ${recipient}, Response: ${text}`);
        return { success: true };
    } catch (e) {
        console.error(`[SMS ERROR] Failed to send to ${to}:`, e.message);
        return { success: false, error: e.message };
    }
}

// Helper: Send Email
async function sendEmail(to, subject, html, apiKey) {
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                from: 'AMP Lodge <noreply@updates.amplodge.org>',
                to: [to],
                subject: subject,
                html: html
            })
        });
        const data = await res.json();
        if (res.ok) return { success: true, id: data.id };
        else return { success: false, error: JSON.stringify(data) };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const body = JSON.parse(event.body);
        const { channel, subject, content, dryRun } = body;
        // dryRun: if true, we just count potential recipients

        if (!channel || !content) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing channel or content' }) };
        }

        // Init Services
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
        const arkeselApiKey = process.env.ARKESEL_API_KEY;
        const resendApiKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Fetch Guests with Bookings (for tokens)
        const { data: guests, error: guestError } = await supabase
            .from('guests')
            .select('id, name, email, phone, bookings(guest_token, status, check_out_date)');

        if (guestError) {
            console.error("Error fetching guests:", guestError);
            throw guestError;
        }

        console.log(`[Campaign] Found ${guests ? guests.length : 0} guests.`);

        if (!guests || guests.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ message: 'No guests found in database', count: 0 }) };
        }

        if (dryRun) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Dry Run Complete',
                    recipientCount: guests.length,
                    sample: guests.slice(0, 3)
                })
            };
        }

        // 3. Send Messages (Batched to prevent Timeouts)
        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;

        // Helper to process a single guest
        const processGuest = async (guest) => {
            try {
                const guestName = guest.name ? guest.name.split(' ')[0] : 'Guest';

                // Resolve Guest Link
                let guestLink = 'https://amplodge.org';
                if (guest.bookings && guest.bookings.length > 0) {
                    // Prioritize active bookings
                    const activeBooking = guest.bookings.find(b =>
                        ['confirmed', 'checked_in'].includes(b.status) &&
                        new Date(b.check_out_date) >= new Date()
                    );
                    const targetBooking = activeBooking || guest.bookings[0];
                    if (targetBooking && targetBooking.guest_token) {
                        guestLink = `https://amplodge.org/guest/${targetBooking.guest_token}`;
                    }
                }

                const personalizedContent = content
                    .replace(/{{name}}/g, guestName)
                    .replace(/{{guest_link}}/g, guestLink);

                let result = { success: false, skipped: false };

                if (channel === 'sms' && guest.phone && arkeselApiKey) {
                    result = await sendSms(guest.phone, personalizedContent, arkeselApiKey);
                } else if (channel === 'email' && guest.email && guest.email.includes('@') && resendApiKey) {
                    const personalizedSubject = (subject || 'Update from AMP Lodge').replace(/{{name}}/g, guestName);
                    result = await sendEmail(guest.email, personalizedSubject, personalizedContent, resendApiKey);
                } else {
                    // Missing contact info for channel
                    return { success: false, skipped: true };
                }
                return { success: result.success === true, skipped: false }; // Normalize result
            } catch (e) {
                console.error(`Error processing guest ${guest.id}:`, e);
                return { success: false, skipped: false };
            }
        };

        // Process in chunks of 10 to balance speed and rate limits
        const chunkSize = 10;
        for (let i = 0; i < guests.length; i += chunkSize) {
            const chunk = guests.slice(i, i + chunkSize);
            const results = await Promise.all(chunk.map(processGuest));

            results.forEach(res => {
                if (res.skipped) skippedCount++;
                else if (res.success) successCount++;
                else failCount++;
            });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Campaign Triggered',
                stats: { sent: successCount, failed: failCount, skipped: skippedCount, total: guests.length }
            })
        };

    } catch (err) {
        console.error('Campaign Error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
