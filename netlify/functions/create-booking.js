// --- Helper: Standard Email Template (Ported from src/services/email-template.ts) ---
const EMAIL_STYLES = {
    body: 'margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #2C2416; background-color: #f4f4f4;',
    container: 'max-width: 600px; margin: 0 auto; background-color: #ffffff;',
    header: 'background-color: #8B4513; padding: 40px 20px; text-align: center;',
    logo: 'height: 60px; width: auto; max-width: 200px; margin-bottom: 20px;',
    headerTitle: 'color: #ffffff; font-size: 28px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 1px; font-family: Arial, sans-serif;',
    headerSubtitle: 'color: rgba(255,255,255,0.9); font-size: 16px; margin: 10px 0 0 0; font-weight: 400;',
    content: 'padding: 40px 30px;',
    contentTitle: 'color: #2C2416; font-size: 24px; margin-bottom: 25px; text-align: center; border-bottom: 2px solid #F5F1E8; padding-bottom: 15px;',
    footer: 'background-color: #F5F1E8; padding: 30px 20px; text-align: center; font-size: 12px; color: #666666; border-top: 1px solid #E5E1D8;',
    infoBox: 'background-color: #F5F1E8; border-left: 4px solid #8B4513; padding: 20px; margin: 20px 0; border-radius: 4px;',
    infoRow: 'margin-bottom: 8px;',
    infoLabel: 'font-weight: 600; color: #2C2416; display: inline-block; width: 120px;'
};

function generateEmailHtml({ title, preheader, content }) {
    const year = new Date().getFullYear();
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="${EMAIL_STYLES.body}">
  <div style="${EMAIL_STYLES.container}">
    <!-- Header -->
    <div style="${EMAIL_STYLES.header}">
      <img src="https://amplodge.org/amp.png" alt="AMP Lodge" style="${EMAIL_STYLES.logo}" />
      <h1 style="${EMAIL_STYLES.headerTitle}">AMP Lodge</h1>
      <p style="${EMAIL_STYLES.headerSubtitle}">Premium Hospitality Experience</p>
    </div>

    <!-- Main Content -->
    <div style="${EMAIL_STYLES.content}">
      <h2 style="${EMAIL_STYLES.contentTitle}">${title}</h2>
      <div style="font-size: 16px; line-height: 1.6; color: #2C2416;">
        ${content}
      </div>
    </div>

    <!-- Footer -->
    <div style="${EMAIL_STYLES.footer}">
      <p style="margin: 0 0 10px 0;">&copy; ${year} AMP Lodge Hotel Management System. All rights reserved.</p>
      <p style="margin: 0;">Automated notification. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>`;
}
// --- Helper End ---

// --- Helper End ---

// Initialize Supabase client
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { Buffer } from 'node:buffer';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- Helper: Generate PDF Buffer ---
async function generatePreInvoicePdfBuffer(bookingContext) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData.toString('base64'));
            });
            doc.on('error', reject);

            // Hotel Info
            doc.fontSize(20).font('Helvetica-Bold').fillColor('#8B4513').text('AMP Lodge', { align: 'left' });
            doc.fontSize(10).font('Helvetica').fillColor('#666666').text('Abuakwa DKC junction, Kumasi-Sunyani Rd', { align: 'left' });
            doc.text('Kumasi, Ghana', { align: 'left' });
            doc.text('Phone: +233 55 500 9697', { align: 'left' });
            doc.text('Email: info@amplodge.org', { align: 'left' });
            doc.moveDown();

            // Invoice Title
            doc.fontSize(24).font('Helvetica-Bold').fillColor('#f59e0b').text('PRE-INVOICE', { align: 'right', valign: 'top' });
            doc.fontSize(10).font('Helvetica').fillColor('#666666').text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
            doc.text('Status: UNPAID', { align: 'right' });
            doc.moveDown(2);

            // Divider
            doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#8B4513').lineWidth(1).stroke();
            doc.moveDown();

            // Bill To
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#8B4513').text('Bill To:', { align: 'left' });
            doc.fontSize(10).font('Helvetica').fillColor('#333333');
            doc.text(bookingContext.guestName);
            if (bookingContext.guestPhone) doc.text(bookingContext.guestPhone);
            if (bookingContext.guestEmail) doc.text(bookingContext.guestEmail);
            doc.moveDown();

            // Booking Details
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#8B4513').text('Booking Details:', { align: 'left' });
            doc.fontSize(10).font('Helvetica').fillColor('#333333');
            doc.text(`Room: ${bookingContext.roomNumber}`);
            doc.text(`Check-in: ${bookingContext.checkIn}`);
            doc.text(`Check-out: ${bookingContext.checkOut}`);
            doc.text(`Nights: ${bookingContext.nights}`);
            doc.moveDown(2);

            // Table Header
            const tableTop = doc.y;
            doc.rect(50, tableTop, 500, 20).fillColor('#8B4513').fill();
            doc.fillColor('white').font('Helvetica-Bold').text('Description', 60, tableTop + 5);
            doc.text('Amount', 450, tableTop + 5, { align: 'right', width: 90 });
            doc.moveDown();

            // Table Row
            const rowTop = tableTop + 25;
            doc.fillColor('black').font('Helvetica').text(`Room Charges (${bookingContext.nights} nights)`, 60, rowTop);
            doc.text(`GHS ${bookingContext.totalPrice}`, 450, rowTop, { align: 'right', width: 90 });

            // Totals
            const totalTop = rowTop + 40;
            doc.moveTo(350, totalTop).lineTo(550, totalTop).strokeColor('#e5e7eb').stroke();
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#8B4513').text('Total Due:', 350, totalTop + 10);
            doc.text(`GHS ${bookingContext.totalPrice}`, 450, totalTop + 10, { align: 'right', width: 90 });

            // Payment Notice
            doc.moveDown(4);
            doc.rect(50, doc.y, 500, 60).fillColor('#fef3c7').strokeColor('#f59e0b').fillAndStroke();
            doc.fillColor('#92400e').font('Helvetica-Bold').text('Payment Information', 60, doc.y - 45);
            doc.font('Helvetica').text('Full payment is due upon check-in. We accept Cash, Mobile Money, and Bank Transfers.', 60, doc.y + 5, { width: 480 });

            doc.end();

        } catch (error) {
            reject(error);
        }
    });
}
// --- Helper End ---

export const handler = async (event, context) => {

    // CORS Headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const body = JSON.parse(event.body);
        const { checkIn, checkOut, roomTypeId, guestName, guestEmail, guestPhone } = body;

        // Validation
        if (!checkIn || !checkOut || !roomTypeId || !guestName || !guestEmail) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }

        // Date Validation - Reject past dates
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);

        if (checkInDate < today) {
            console.warn('[CreateBooking] Rejected: Check-in date is in the past', { checkIn, today: today.toISOString() });
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: `Check-in date (${checkIn}) cannot be in the past. Today is ${today.toISOString().split('T')[0]}.`
                })
            };
        }

        if (checkOutDate <= checkInDate) {
            console.warn('[CreateBooking] Rejected: Check-out must be after check-in', { checkIn, checkOut });
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: `Check-out date (${checkOut}) must be after check-in date (${checkIn}).`
                })
            };
        }

        // 1. Find or Create Guest
        let guestId;
        const { data: existingGuest, error: guestError } = await supabase
            .from('guests')
            .select('id')
            .eq('email', guestEmail)
            .single();

        if (existingGuest) {
            guestId = existingGuest.id;
            // Optional: Update phone/name if needed
            if (guestName || guestPhone) {
                await supabase.from('guests').update({
                    name: guestName,
                    phone: guestPhone
                }).eq('id', guestId);
            }
        } else {
            const { data: newGuest, error: createError } = await supabase
                .from('guests')
                .insert({
                    name: guestName,
                    email: guestEmail,
                    phone: guestPhone
                })
                .select('id')
                .single();

            if (createError) throw createError;
            guestId = newGuest.id;
        }

        // 2. Find an available Room of the requested Type
        // Re-using availability logic basically
        // IMPLEMENTING FUZZY MATCH for Agent Hallucination Fix
        let validRoomTypeId = roomTypeId;

        // Check if type exists exactly first
        const { data: exactType } = await supabase
            .from('room_types')
            .select('id')
            .eq('id', roomTypeId)
            .single();

        if (!exactType) {
            console.warn(`[CreateBooking] Room Type ID ${roomTypeId} not found (Possible hallucination). Attempting fuzzy match...`);
            // Fetch all room types and fuzzy match
            const { data: allTypes } = await supabase.from('room_types').select('id, name');

            if (allTypes) {
                // Match first 8 chars (UUID prefix)
                const prefix = roomTypeId.substring(0, 8);
                const relativeMatch = allTypes.find(t => t.id.startsWith(prefix));

                if (relativeMatch) {
                    console.log(`[CreateBooking] Fuzzy match found: Provided ${roomTypeId} -> Matched ${relativeMatch.id} (${relativeMatch.name})`);
                    validRoomTypeId = relativeMatch.id;
                } else {
                    console.warn('[CreateBooking] No fuzzy match found.');
                }
            }
        }

        const { data: roomsOfType, error: roomsError } = await supabase
            .from('rooms')
            .select('id, room_number, price, room_types(base_price)')
            .eq('room_type_id', validRoomTypeId) // Use validated ID
            .in('status', ['clean', 'available']);

        if (roomsError) {
            console.error('[CreateBooking] Rooms Fetch Error:', roomsError);
            throw roomsError;
        }

        if (!roomsOfType || roomsOfType.length === 0) {
            console.log('[CreateBooking] No rooms found for type:', validRoomTypeId);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: `No rooms of this type found (ID: ${validRoomTypeId})` })
            };
        }

        // Check conflicts for these specific rooms
        const candidateRoomIds = roomsOfType.map(r => r.id);
        const { data: busyBookings, error: busyError } = await supabase
            .from('bookings')
            .select('room_id')
            .in('room_id', candidateRoomIds)
            .neq('status', 'cancelled')
            .lt('check_in', checkOut)
            .gt('check_out', checkIn);

        if (busyError) {
            console.error('[CreateBooking] Busy Bookings Error:', busyError);
            throw busyError;
        }

        const busyRoomIds = new Set(busyBookings.map(b => b.room_id));
        const availableRoom = roomsOfType.find(r => !busyRoomIds.has(r.id));

        if (!availableRoom) {
            console.log('[CreateBooking] All rooms busy for dates:', { checkIn, checkOut });
            return {
                statusCode: 409, // Conflict / No availability
                headers,
                body: JSON.stringify({ error: 'No rooms available for these dates' })
            };
        }

        console.log('[CreateBooking] Selected Room:', availableRoom.room_number);

        // Calculate price (simplified: base_price * nights)
        // ALIGNMENT FIX: Always use room_types.base_price to match the availability endpoint
        const start = new Date(checkIn);
        const end = new Date(checkOut);
        const nights = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

        const pricePerNight = availableRoom.room_types ? availableRoom.room_types.base_price : 0;

        if (!pricePerNight) {
            console.warn('[CreateBooking] No base_price found for room type');
        }

        const totalPrice = pricePerNight * nights;

        // 2.5 Resolve "System User" (Admin) to own the booking
        // Optimization: Query 'staff' table instead of slow auth.admin.listUsers()
        let systemUserId = null;
        try {
            const adminEmail = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
            if (adminEmail) {
                // Try finding in 'staff' table first (Much faster)
                const { data: staffMember, error: staffError } = await supabase
                    .from('staff')
                    .select('user_id')
                    .eq('email', adminEmail) // Ensure 'email' column exists in 'staff'
                    .single();

                if (staffMember) {
                    systemUserId = staffMember.user_id;
                    console.log('[CreateBooking] Found Admin ID in staff table:', systemUserId);
                } else {
                    // Fallback: Check 'users' table if you have access or stick to null
                    console.warn('[CreateBooking] Admin email not found in staff table');
                }
            }
        } catch (authError) {
            console.warn('[CreateBooking] Failed to resolve system user:', authError);
            // Non-blocking
        }

        // 3. Create Booking
        console.log('[CreateBooking] Creating booking record...');
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .insert({
                guest_id: guestId,
                user_id: systemUserId, // Assign ownership
                room_id: availableRoom.id,
                check_in: checkIn,
                check_out: checkOut,
                status: 'confirmed',
                total_price: totalPrice,
                num_guests: 1,
                special_requests: '[Voice Agent Booking]',
                source: 'voice_agent',
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (bookingError) throw bookingError;

        console.log('[CreateBooking] Success:', booking.id);

        // --- Notification Trigger Start (Parallelized) ---
        // We use Promise.all to run these concurrently (faster) and await them
        // so the function doesn't freeze before sending.
        try {
            const baseUrl = process.env.URL || 'https://amplodge.org';
            const notificationPromises = [];

            // 1. Send SMS
            if (guestPhone) {
                const smsMessage = `Dear ${guestName}, your booking at AMP Lodge (Room ${availableRoom.room_number}) from ${checkIn} to ${checkOut} is confirmed. Check email for details.`;
                console.log('[CreateBooking] Queueing SMS...');
                notificationPromises.push(
                    fetch(`${baseUrl}/.netlify/functions/send-sms`, {
                        method: 'POST',
                        body: JSON.stringify({ to: guestPhone, message: smsMessage })
                    }).then(res => {
                        if (!res.ok) console.error('[CreateBooking] SMS Failed:', res.status);
                        else console.log('[CreateBooking] SMS Sent');
                    }).catch(err => console.error('[CreateBooking] SMS Error:', err))
                );
            }

            // 2. Send Email
            if (guestEmail) {
                const htmlContent = generateEmailHtml({
                    title: 'Booking Confirmed!',
                    preheader: `Reservation for Room ${availableRoom.room_number}`,
                    content: `
                    <p>Dear <strong>${guestName}</strong>,</p>
                    <p>Thank you for booking with AMP Lodge via our Voice Concierge. Your reservation is confirmed!</p>
                    
                    <div style="${EMAIL_STYLES.infoBox}">
                        <div style="${EMAIL_STYLES.infoRow}">
                            <span style="${EMAIL_STYLES.infoLabel}">Room:</span> ${availableRoom.room_number} (${availableRoom.room_types?.name || 'Standard'})
                        </div>
                        <div style="${EMAIL_STYLES.infoRow}">
                            <span style="${EMAIL_STYLES.infoLabel}">Check-In:</span> ${checkIn}
                        </div>
                        <div style="${EMAIL_STYLES.infoRow}">
                            <span style="${EMAIL_STYLES.infoLabel}">Check-Out:</span> ${checkOut}
                        </div>
                        <div style="${EMAIL_STYLES.infoRow}">
                            <span style="${EMAIL_STYLES.infoLabel}">Total Price:</span> GHS ${totalPrice}
                        </div>
                    </div>

                    <!-- PRE-INVOICE SECTION -->
                    <div style="background-color: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 25px 0;">
                        <h3 style="color: #92400e; font-size: 18px; margin: 0 0 15px 0; display: flex; align-items: center;">
                            📋 Pre-Invoice / Payment Summary
                        </h3>
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr style="border-bottom: 1px solid #fcd34d;">
                                <td style="padding: 8px 0; color: #78350f;">Room Charge (${nights} night${nights > 1 ? 's' : ''})</td>
                                <td style="padding: 8px 0; text-align: right; color: #78350f; font-weight: 600;">GHS ${totalPrice}</td>
                            </tr>
                            <tr style="background-color: #f59e0b; color: white;">
                                <td style="padding: 10px; font-weight: bold;">Total Due at Check-in</td>
                                <td style="padding: 10px; text-align: right; font-weight: bold; font-size: 16px;">GHS ${totalPrice}</td>
                            </tr>
                        </table>
                        <p style="color: #92400e; font-size: 12px; margin: 15px 0 0 0; text-align: center;">
                            💳 We accept Cash, Mobile Money, and Bank Transfers
                        </p>
                    </div>

                    <h3 style="margin-top: 30px; font-size: 18px; color: #8B4513;">Check-in Information</h3>
                    <ul>
                        <li>Check-in time is from 2:00 PM</li>
                        <li>Please present valid ID upon arrival</li>
                        <li>Full payment is due upon check-in</li>
                    </ul>
                    
                    <p style="margin-top: 30px;">
                        We look forward to hosting you!
                    </p>
                    
                    <p>
                        Best regards,<br>
                        <strong>The AMP LODGE Team</strong>
                    </p>
                `
                });

                // Generate PDF attachment
                const bookingContext = {
                    guestName,
                    guestPhone,
                    guestEmail,
                    roomNumber: availableRoom.room_number,
                    checkIn,
                    checkOut,
                    nights,
                    totalPrice
                };

                let pdfAttachment = null;
                try {
                    console.log('[CreateBooking] Generating PDF attachment...');
                    const pdfBase64 = await generatePreInvoicePdfBuffer(bookingContext);
                    pdfAttachment = {
                        filename: `Pre-Invoice-${booking.id.substring(0, 8)}.pdf`,
                        content: pdfBase64,
                        contentType: 'application/pdf'
                    };
                    console.log('[CreateBooking] PDF attachment generated.');
                } catch (pdfError) {
                    console.error('[CreateBooking] Failed to generate PDF attachment:', pdfError);
                    // Continue without attachment
                }

                console.log('[CreateBooking] Queueing Email...');
                const emailPayload = {
                    to: guestEmail,
                    subject: `Booking Confirmation - Room ${availableRoom.room_number}`,
                    html: htmlContent
                };

                if (pdfAttachment) {
                    emailPayload.attachments = [pdfAttachment];
                }

                notificationPromises.push(
                    fetch(`${baseUrl}/.netlify/functions/send-email`, {
                        method: 'POST',
                        body: JSON.stringify(emailPayload)
                    }).then(res => {
                        if (!res.ok) console.error('[CreateBooking] Email Failed:', res.status);
                        else console.log('[CreateBooking] Email Sent');
                    }).catch(err => console.error('[CreateBooking] Email Error:', err))
                );
            }

            // Await all notifications with a small timeout fallback?
            // For now, just await them. They should be fast enough.
            if (notificationPromises.length > 0) {
                await Promise.all(notificationPromises);
                console.log('[CreateBooking] All notifications triggers completed');
            }

        } catch (notifyError) {
            console.error('[CreateBooking] Notification Logic Error:', notifyError);
            // Don't fail the request if notifications fail
        }
        // --- Notification Trigger End ---

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `Booking created successfully. Total: GHS ${totalPrice}`,
                data: {
                    bookingId: booking.id,
                    roomNumber: availableRoom.room_number,
                    totalPrice,
                    currency: 'GHS', // Explicitly state currency
                    status: 'confirmed'
                }
            })
        };

    } catch (error) {
        console.error('Create Booking Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal Server Error', details: error.message })
        };
    }
};
