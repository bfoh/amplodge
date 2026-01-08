// Arkesel SMS Integration
// Documentation: https://arkesel.com/developers

export const handler = async (event) => {
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
        // console.log(`[SMS Function] API Key start: ${apiKey ? apiKey.substring(0, 4) + '...' : 'none'}`);

        // --- Phone Number Normalization ---
        // 1. Remove all non-digits
        let recipient = to.replace(/[^\d]/g, '');

        // 2. Handle International Format (+233)
        // If user typed +233... the regex above made it 233... which is correct for Arkesel.
        // But we need to be careful with double prefixes.

        // 3. Handle Leading Zero (Ghana local format 055...)
        if (recipient.startsWith('0')) {
            // 055... -> 23355...
            recipient = '233' + recipient.substring(1);
        }

        // 4. Handle "Missing Prefix" 9-digit numbers (55...) -> 23355...
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
        // Arkesel V2 might return JSON, but V1 is typically plain text or simple JSON.
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
            // Return 400 Bad Request instead of 500 if it's an invalid number, so client knows it's data error
            let statusCode = 502;
            if (responseText.toLowerCase().includes('invalid phone') || responseText.toLowerCase().includes('invalid number')) {
                statusCode = 400;
            } else if (responseText.toLowerCase().includes('balance') || responseText.toLowerCase().includes('credit')) {
                statusCode = 402; // Payment Required
            }

            return {
                statusCode,
                body: JSON.stringify({
                    success: false,
                    error: responseText || 'Failed to send SMS via Arkesel V1',
                    debug: {
                        recipient: recipient, // Helpful to see what was actually sent
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
