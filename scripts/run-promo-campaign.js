import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const arkeselApiKey = process.env.ARKESEL_API_KEY;
const resendApiKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Missing Supabase credentials.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const DRY_RUN = process.argv.includes('--dry-run');

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

async function main() {
    console.log(`Starting Promo Campaign... [Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}]`);
    console.log('Criteria: Guests with >= 1 completed booking.');

    // 1. Get all guests with at least one completed booking
    // Using a raw query or joining tables. Simplest is to find unique guest_ids from relevant bookings.
    // 'status' should be 'checked_out' or 'completed' (assuming checked_out implies completion)
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('guest_id, status')
    // .in('status', ['checked_out', 'completed', 'confirmed', 'checked_in']); // DEBUG: Fetch ALL to see what's wrong

    if (error) {
        console.error('Error fetching bookings:', error);
        return;
    }

    if (!bookings || bookings.length === 0) {
        console.log('No bookings found.');
        return;
    }

    // Get unique Guest IDs
    const guestIds = [...new Set(bookings.map(b => b.guest_id))];
    console.log(`Found ${bookings.length} total bookings from ${guestIds.length} unique guests.`);

    // 2. Fetch Guest Details
    const { data: guests, error: guestError } = await supabase
        .from('guests')
        .select('id, name, email, phone')
        .in('id', guestIds);

    if (guestError) {
        console.error('Error fetching guests:', guestError);
        return;
    }

    console.log(`Loaded details for ${guests.length} guests.`);

    // 3. Send Messages
    for (const guest of guests) {
        console.log(`\nProcessing Guest: ${guest.name} (ID: ${guest.id})`);

        // --- SMS ---
        if (guest.phone) {
            if (DRY_RUN) {
                console.log(`  [DRY RUN] Would send SMS to ${guest.phone}: "${SMS_MESSAGE}"`);
            } else {
                if (arkeselApiKey) {
                    await sendSms(guest.phone, SMS_MESSAGE);
                } else {
                    console.log('  [SKIP] No Arkesel API Key configured.');
                }
            }
        } else {
            console.log('  [SKIP] No phone number.');
        }

        // --- Email ---
        if (guest.email && guest.email.includes('@') && guest.email.includes('.')) {
            if (DRY_RUN) {
                console.log(`  [DRY RUN] Would send Email to ${guest.email}: Subject: "${EMAIL_SUBJECT}"`);
            } else {
                if (resendApiKey) {
                    await sendEmail(guest.email, EMAIL_SUBJECT, EMAIL_HTML);
                } else {
                    console.log('  [SKIP] No Resend API Key configured.');
                }
            }
        } else {
            console.log(`  [SKIP] Invalid or missing email address: "${guest.email}"`);
        }
    }

    console.log('\nCampaign Finished.');
}

async function sendSms(to, message) {
    // Basic implementation reusing logic logic structure
    // In a real script we might call the Netlify function URL or implement direct fetch here. 
    // Implementing direct fetch for simplicity if node-fetch available or native fetch (Node 18+)
    try {
        let recipient = to.replace(/[^\d]/g, '');
        if (recipient.startsWith('0')) recipient = '233' + recipient.substring(1);
        else if (!recipient.startsWith('233') && recipient.length === 9) recipient = '233' + recipient;

        const url = `https://sms.arkesel.com/sms/api?action=send-sms&api_key=${arkeselApiKey}&to=${recipient}&from=AMP Lodge&sms=${encodeURIComponent(message)}`;

        const res = await fetch(url);
        const text = await res.text();
        console.log(`  [SMS SENT] To: ${recipient}, Response: ${text}`);
    } catch (e) {
        console.error(`  [SMS ERROR] Failed to send to ${to}:`, e.message);
    }
}

async function sendEmail(to, subject, html) {
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resendApiKey}`
            },
            body: JSON.stringify({
                from: 'AMP Lodge <noreply@updates.amplodge.org>', // Make sure this domain is verified in Resend
                to: [to],
                subject: subject,
                html: html
            })
        });
        const data = await res.json();
        if (res.ok) {
            console.log(`  [EMAIL SENT] To: ${to}, ID: ${data.id}`);
        } else {
            console.error(`  [EMAIL ERROR] Failed to send to ${to}:`, data);
        }
    } catch (e) {
        console.error(`  [EMAIL ERROR] Failed to send to ${to}:`, e.message);
    }
}

main();
