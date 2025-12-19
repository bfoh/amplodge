const fs = require('fs');
const path = require('path');

// Load environment variables manually
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envFile = fs.readFileSync(envPath, 'utf8');
        const envConfig = envFile.split('\n').reduce((acc, line) => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const value = values.join('=').trim().replace(/^["']|["']$/g, '');
                process.env[key.trim()] = value;
            }
            return acc;
        }, {});
    }
} catch (e) {
    console.error('Error loading .env.local:', e);
}

const { handler } = require('./netlify/functions/create-booking.js');

// Mock Event
const event = {
    httpMethod: 'POST',
    body: JSON.stringify({
        checkIn: '2025-12-25',
        checkOut: '2025-12-28',
        roomTypeId: 'b338fbc4-6894-4a91-a1f8-6f049fcfaf92', // Example ID
        guestName: 'Test Guest',
        guestEmail: 'test@example.com',
        guestPhone: '1234567890'
    })
};

// Mock Context
const context = {};

async function run() {
    try {
        console.log('Running handler...');
        const result = await handler(event, context);
        console.log('Result:', result);
    } catch (error) {
        console.error('Handler Error:', error);
    }
}

run();
