const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');

// Constants
const SMS_MESSAGE = "Long time no see! We miss having you at AMP Lodge. Treat yourself to a well-deserved break in our serene environment. Book your stay today: https://amplodge.com";
const EMAIL_SUBJECT = "Your Home Away from Home Awaits - AMP Lodge";
const EMAIL_HTML = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #d4a017;">We Miss You!</h1>
        <p>Hello,</p>
        <p>It's been a while since your last visit to <strong>AMP Lodge</strong>.</p> 
        <p>We are constantly improving to serve you better. Whether you need a peaceful getaway or a comfortable place to stay, we are ready to welcome you back.</p>
        <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #d4a017; margin: 20px 0;">
            <p style="margin: 0; font-size: 18px;"><strong>Come Relax With Us</strong></p>
            <p style="margin: 5px 0 0; color: #666;">Experience our serenity and top-notch hospitality once again.</p>
        </div>
        <p>You deserve a break. Let us take care of you.</p>
        <p><a href="https://amplodge.com" style="background-color: #d4a017; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Book Your Stay Now</a></p>
        <p style="margin-top: 30px; font-size: 12px; color: #999;">If you no longer wish to receive updates, please reply to this email.</p>
    </div>
`;

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
    } catch (e) {
        console.error(`[SMS ERROR] Failed to send to ${to}:`, e.message);
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
        if (res.ok) {
            console.log(`[EMAIL] To: ${to}, ID: ${data.id}`);
        } else {
            console.error(`[EMAIL ERROR] Failed to send to ${to}:`, data);
        }
    } catch (e) {
        console.error(`[EMAIL ERROR] Failed to send to ${to}:`, e.message);
    }
}

// Main Handler
const handler = async (event) => {
    console.log('[Scheduled Promo] Starting execution...');

    // Environment Variables
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const arkeselApiKey = process.env.ARKESEL_API_KEY;
    const resendApiKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase credentials');
        return { statusCode: 500 };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch Guests
    // Note: In production, consider paginating if you have thousands of guests.
    // For now, we fetch distinct guests from bookings.
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('guest_id');

    if (error) {
        console.error('Error fetching bookings:', error);
        return { statusCode: 500 };
    }

    const guestIds = [...new Set(bookings.map(b => b.guest_id))];
    console.log(`Found ${guestIds.length} unique guests.`);

    if (guestIds.length === 0) return { statusCode: 200 };

    // 2. Fetch Guest Details
    const { data: guests, error: guestError } = await supabase
        .from('guests')
        .select('id, name, email, phone')
        .in('id', guestIds);

    if (guestError) {
        console.error('Error fetching guests:', guestError);
        return { statusCode: 500 };
    }

    // 3. Send Messages
    let smsCount = 0;
    let emailCount = 0;

    for (const guest of guests) {
        // SMS
        if (guest.phone && arkeselApiKey) {
            await sendSms(guest.phone, SMS_MESSAGE, arkeselApiKey);
            smsCount++;
        }

        // Email (with validation)
        if (guest.email && guest.email.includes('@') && guest.email.includes('.') && resendApiKey) {
            await sendEmail(guest.email, EMAIL_SUBJECT, EMAIL_HTML, resendApiKey);
            emailCount++;
        }
    }

    console.log(`[Scheduled Promo] Finished. SMS: ${smsCount}, Email: ${emailCount}`);

    return {
        statusCode: 200,
    };
};

// Schedule: Run at 9:00 AM on the 1st day of every month
// Cron Syntax: "Minute Hour DayMonth Month DayWeek"
exports.handler = schedule('0 9 1 * *', handler);
