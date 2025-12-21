import fetch from 'node-fetch';

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { text } = JSON.parse(event.body);

        if (!text || text.trim().length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Text is required' })
            };
        }

        // Check multiple possible environment variable names
        const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY ||
            process.env.GOOGLE_TTS_API_KEY ||
            process.env.GCP_TTS_API_KEY ||
            process.env.TTS_API_KEY ||
            process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            console.error('[TTS] Missing API key. Checked: GOOGLE_CLOUD_TTS_API_KEY, GOOGLE_TTS_API_KEY, GCP_TTS_API_KEY, TTS_API_KEY, GOOGLE_API_KEY');
            console.error('[TTS] Available env vars:', Object.keys(process.env).filter(k => k.includes('GOOGLE') || k.includes('TTS') || k.includes('API')));
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'TTS service not configured',
                    hint: 'Please add GOOGLE_CLOUD_TTS_API_KEY to Netlify environment variables'
                })
            };
        }

        console.log('[TTS] API key found, length:', apiKey.length);

        // Clean text for speech (remove markdown, etc.)
        const cleanText = text
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/\*+/g, '')
            .replace(/#+\s?/g, '')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/GHS\s?(\d+)/gi, '$1 Ghana Cedis')
            .replace(/(\d+)\s?GHS/gi, '$1 Ghana Cedis')
            .replace(/\bGHS\b/gi, 'Ghana Cedis')
            .replace(/GH₵\s?(\d+)/gi, '$1 Ghana Cedis')
            .replace(/(\d+)\s?GH₵/gi, '$1 Ghana Cedis')
            .replace(/\bGH₵\b/gi, 'Ghana Cedis')
            // Convert date formats to spoken form
            .replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, year, month, day) => {
                const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                const monthName = months[parseInt(month) - 1] || month;
                return `${monthName} ${parseInt(day)}, ${year}`;
            });

        console.log('[TTS] Synthesizing speech for:', cleanText.substring(0, 100) + '...');

        // Call Google Cloud Text-to-Speech API
        const ttsResponse = await fetch(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    input: { text: cleanText },
                    voice: {
                        languageCode: 'en-GB',
                        name: 'en-GB-Neural2-C', // Premium female voice
                        ssmlGender: 'FEMALE'
                    },
                    audioConfig: {
                        audioEncoding: 'MP3',
                        speakingRate: 1.1,   // Slightly faster, natural pace
                        pitch: 0.0,
                        volumeGainDb: 2.0    // Boost volume slightly
                    }
                })
            }
        );

        if (!ttsResponse.ok) {
            const errorData = await ttsResponse.json();
            console.error('[TTS] Google API Error:', errorData);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to synthesize speech', details: errorData })
            };
        }

        const ttsData = await ttsResponse.json();

        // Return base64 encoded audio
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                audioContent: ttsData.audioContent,
                contentType: 'audio/mp3'
            })
        };

    } catch (error) {
        console.error('[TTS] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error', message: error.message })
        };
    }
};
