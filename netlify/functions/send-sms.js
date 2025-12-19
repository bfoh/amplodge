// Arkesel SMS Integration
// Documentation: https://arkesel.com/developers

exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { to, message } = JSON.parse(event.body);

        if (!to || !message) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: to, message' })
            };
        }

        const apiKey = process.env.ARKESEL_API_KEY ? process.env.ARKESEL_API_KEY.trim() : null;
        const senderId = process.env.ARKESEL_SENDER_ID || 'AMPLodge';

        if (!apiKey) {
            console.error('[SMS Function] Arkesel API Key not configured');
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'SMS service not configured' })
            };
        }

        console.log(`[SMS Function] Configured API Key length: ${apiKey ? apiKey.length : 'undefined'}`);
        console.log(`[SMS Function] API Key start: ${apiKey ? apiKey.substring(0, 4) + '...' : 'none'}`);

        // Format number for Arkesel (they accept various formats, but E.164 sans + is safest or local)
        // Arkesel typically expects "233xxxxxxxxx" for Ghana.
        let recipient = to.replace(/[^\d]/g, ''); // Remove all non-digits
        // If it starts with 0 (e.g. 055...), replace 0 with 233
        if (recipient.startsWith('0')) {
            recipient = '233' + recipient.substring(1);
        }
        // If it doesn't start with 233 and is 9 digits (e.g. 555...), add 233
        if (!recipient.startsWith('233') && recipient.length === 9) {
            recipient = '233' + recipient;
        }

        console.log(`[SMS Function] Sending SMS via Arkesel V1 to ${recipient}`);

        // Arkesel V1 API URL
        // From user: https://sms.arkesel.com/sms/api?action=send-sms&api_key=&to=PhoneNumber&from=SenderID&sms=YourMessage
        const baseUrl = 'https://sms.arkesel.com/sms/api';

        const params = new URLSearchParams({
            action: 'send-sms',
            api_key: apiKey,
            to: recipient,
            from: senderId,
            sms: message
        });

        const fullUrl = `${baseUrl}?${params.toString()}`;

        // Mask API key in logs
        const loggedUrl = fullUrl.replace(apiKey, '***');
        console.log('[SMS Function] V1 URL:', loggedUrl);

        const response = await fetch(fullUrl);

        // V1 API usually returns text or JSON. Let's try to get text first.
        const responseText = await response.text();
        console.log('[SMS Function] Arkesel V1 Response:', responseText);

        // Simple check for success (Arkesel V1 often returns "Ok" or "Success" or specific codes)
        // Adjust logic based on actual response. Usually a code like "100" or similar implies success, or just HTTP 200.
        // Assuming if response contains "error" or "invalid" it failed.
        const isSuccess = response.ok && !responseText.toLowerCase().includes('error') && !responseText.toLowerCase().includes('invalid');

        if (isSuccess) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    results: {
                        sms: { success: true, response: responseText }
                    }
                })
            };
        } else {
            console.error('[SMS Function] Arkesel Error:', responseText);
            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    error: responseText || 'Failed to send SMS via Arkesel V1',
                    debug: {
                        keyLength: apiKey ? apiKey.length : 0,
                        keyStart: apiKey ? apiKey.substring(0, 4) : 'none',
                        recipient: recipient,
                        rawResponse: responseText
                    }
                })
            };
        }

    } catch (error) {
        console.error('[SMS Function] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
