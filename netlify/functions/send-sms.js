const twilio = require('twilio');

exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { to, message, channel = 'both' } = JSON.parse(event.body);

        if (!to || !message) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: to, message' })
            };
        }

        // Get Twilio credentials from environment
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
        const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886';

        if (!accountSid || !authToken || !twilioPhoneNumber) {
            console.error('[SMS Function] Twilio credentials not configured');
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'SMS service not configured' })
            };
        }

        const client = twilio(accountSid, authToken);

        // Format phone number to E.164
        let formattedPhone = to.replace(/[^\d+]/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '+233' + formattedPhone.substring(1);
        }
        if (!formattedPhone.startsWith('+')) {
            if (formattedPhone.length === 9 || formattedPhone.length === 10) {
                formattedPhone = '+233' + (formattedPhone.startsWith('0') ? formattedPhone.substring(1) : formattedPhone);
            } else {
                formattedPhone = '+' + formattedPhone;
            }
        }

        const results = { sms: null, whatsapp: null };

        // Send SMS
        if (channel === 'sms' || channel === 'both') {
            try {
                const smsResult = await client.messages.create({
                    body: message,
                    from: twilioPhoneNumber,
                    to: formattedPhone
                });
                results.sms = { success: true, sid: smsResult.sid };
                console.log('[SMS Function] SMS sent:', smsResult.sid);
            } catch (smsError) {
                console.error('[SMS Function] SMS failed:', smsError.message);
                results.sms = { success: false, error: smsError.message };
            }
        }

        // Send WhatsApp
        if (channel === 'whatsapp' || channel === 'both') {
            try {
                const whatsappResult = await client.messages.create({
                    body: message,
                    from: `whatsapp:${twilioWhatsAppNumber.replace('whatsapp:', '')}`,
                    to: `whatsapp:${formattedPhone}`
                });
                results.whatsapp = { success: true, sid: whatsappResult.sid };
                console.log('[SMS Function] WhatsApp sent:', whatsappResult.sid);
            } catch (whatsappError) {
                console.error('[SMS Function] WhatsApp failed:', whatsappError.message);
                results.whatsapp = { success: false, error: whatsappError.message };
            }
        }

        // Check if at least one succeeded
        const anySuccess = results.sms?.success || results.whatsapp?.success;

        return {
            statusCode: anySuccess ? 200 : 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: anySuccess,
                results
            })
        };
    } catch (error) {
        console.error('[SMS Function] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
