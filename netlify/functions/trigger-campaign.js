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

        // 1. Fetch Guests (All guests with at least 1 booking)
        // Optimization: Create a view or just select distinct guest_id from bookings
        const { data: bookings, error } = await supabase
            .from('bookings')
            .select('guest_id');

        if (error) throw error;
        const guestIds = [...new Set(bookings.map(b => b.guest_id))];

        if (guestIds.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ message: 'No guests found', count: 0 }) };
        }

        // 2. Fetch Guest Details
        const { data: guests, error: guestError } = await supabase
            .from('guests')
            .select('id, name, email, phone')
            .in('id', guestIds);

        if (guestError) throw guestError;

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

        // 3. Send Messages
        let successCount = 0;
        let failCount = 0;

        for (const guest of guests) {
            // Variable Substitution
            const guestName = guest.name || 'Guest';
            // Simple replace: {{name}} -> guest name
            const personalizedContent = content.replace(/{{name}}/g, guestName);

            let result = { success: false };

            if (channel === 'sms' && guest.phone && arkeselApiKey) {
                result = await sendSms(guest.phone, personalizedContent, arkeselApiKey);
            } else if (channel === 'email' && guest.email && guest.email.includes('@') && resendApiKey) {
                // For email, we might want personalized Subject too?
                const personalizedSubject = (subject || 'Update from AMP Lodge').replace(/{{name}}/g, guestName);
                result = await sendEmail(guest.email, personalizedSubject, personalizedContent, resendApiKey);
            }

            if (result.success) successCount++;
            else failCount++;
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Campaign Triggered',
                stats: { sent: successCount, failed: failCount, total: guests.length }
            })
        };

    } catch (err) {
        console.error('Campaign Error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
