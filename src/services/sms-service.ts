// SMS Service - Uses Netlify serverless function for Twilio calls
// This avoids browser compatibility issues with the Twilio SDK

interface SMSResult {
    success: boolean
    messageId?: string
    error?: string
}

/**
 * Format phone number to E.164 format
 * Handles Ghana numbers and international formats
 */
function formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters except +
    let cleaned = phone.replace(/[^\d+]/g, '')

    // If starts with 0, assume Ghana number
    if (cleaned.startsWith('0')) {
        cleaned = '+233' + cleaned.substring(1)
    }

    // If doesn't start with +, add it
    if (!cleaned.startsWith('+')) {
        // Assume Ghana if 9-10 digits
        if (cleaned.length === 9 || cleaned.length === 10) {
            cleaned = '+233' + (cleaned.startsWith('0') ? cleaned.substring(1) : cleaned)
        } else {
            cleaned = '+' + cleaned
        }
    }

    return cleaned
}

/**
 * Check if we're in a production environment with Netlify functions available
 */
function isNetlifyFunctionsAvailable(): boolean {
    // In development, we might use a local Netlify dev server
    // In production on Netlify, functions are always available
    return typeof window !== 'undefined'
}

/**
 * Send SMS and WhatsApp via Netlify serverless function
 */
async function sendViaNetlifyFunction(
    to: string,
    message: string,
    channel: 'sms' | 'whatsapp' | 'both' = 'both',
    context = 'Notification'
): Promise<SMSResult> {
    try {
        const formattedPhone = formatPhoneNumber(to)

        console.log(`📱 [SMSService] Sending ${context} via serverless function...`, {
            to: formattedPhone,
            channel,
            messageLength: message.length
        })

        const response = await fetch('/.netlify/functions/send-sms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: formattedPhone,
                message,
                channel
            })
        })

        const data = await response.json()

        if (data.success) {
            console.log(`✅ [SMSService] ${context} sent successfully`, data.results)
            return { success: true, messageId: data.results?.sms?.sid || data.results?.whatsapp?.sid }
        } else {
            console.error(`❌ [SMSService] ${context} failed:`, data.error || data.results)
            return { success: false, error: data.error || 'Failed to send message' }
        }
    } catch (error: any) {
        console.error(`❌ [SMSService] ${context} error:`, error)
        return { success: false, error: error?.message || 'Failed to send message' }
    }
}

/**
 * Send SMS via Twilio (through Netlify function)
 */
export async function sendSMS(
    to: string,
    message: string,
    context = 'SMS'
): Promise<SMSResult> {
    if (!isNetlifyFunctionsAvailable()) {
        console.warn(`[SMSService] Not in browser environment, skipping ${context}`)
        return { success: false, error: 'SMS not available in this environment' }
    }

    return sendViaNetlifyFunction(to, message, 'sms', context)
}

/**
 * Send WhatsApp message via Twilio (through Netlify function)
 */
export async function sendWhatsApp(
    to: string,
    message: string,
    context = 'WhatsApp'
): Promise<SMSResult> {
    if (!isNetlifyFunctionsAvailable()) {
        console.warn(`[SMSService] Not in browser environment, skipping ${context}`)
        return { success: false, error: 'WhatsApp not available in this environment' }
    }

    return sendViaNetlifyFunction(to, message, 'whatsapp', context)
}

/**
 * Send notification via both WhatsApp AND SMS simultaneously
 */
export async function sendSMSWithFallback(
    to: string,
    message: string,
    context = 'Notification'
): Promise<SMSResult> {
    if (!isNetlifyFunctionsAvailable()) {
        console.warn(`[SMSService] Not in browser environment, skipping ${context}`)
        return { success: false, error: 'Messaging not available in this environment' }
    }

    // Send both via a single API call
    return sendViaNetlifyFunction(to, message, 'both', context)
}

/**
 * Send booking confirmation via SMS/WhatsApp
 */
export async function sendBookingConfirmationSMS(params: {
    phone: string
    guestName: string
    roomNumber: string
    checkIn: string
    checkOut: string
    bookingId: string
}): Promise<SMSResult> {
    const { phone, guestName, roomNumber, checkIn, checkOut, bookingId } = params

    const message = `🏨 AMP Lodge Booking Confirmed!

Hi ${guestName},

Your reservation is confirmed:
📍 Room: ${roomNumber}
📅 Check-in: ${new Date(checkIn).toLocaleDateString()}
📅 Check-out: ${new Date(checkOut).toLocaleDateString()}
🔖 Booking ID: ${bookingId.slice(0, 8)}

We look forward to welcoming you!

- AMP Lodge Team`

    return sendSMSWithFallback(phone, message, 'Booking Confirmation')
}

/**
 * Send check-in confirmation via SMS/WhatsApp
 */
export async function sendCheckInSMS(params: {
    phone: string
    guestName: string
    roomNumber: string
    checkOutDate: string
}): Promise<SMSResult> {
    const { phone, guestName, roomNumber, checkOutDate } = params

    const message = `✅ Welcome to AMP Lodge, ${guestName}!

You're checked in to Room ${roomNumber}.

📅 Check-out: ${new Date(checkOutDate).toLocaleDateString()} by 11:00 AM
📶 WiFi password available at front desk
🍳 Breakfast: 7:00 AM - 10:00 AM
📞 Front desk: Dial 0

Enjoy your stay!
- AMP Lodge Team`

    return sendSMSWithFallback(phone, message, 'Check-in Confirmation')
}

/**
 * Send check-out confirmation via SMS/WhatsApp
 */
export async function sendCheckOutSMS(params: {
    phone: string
    guestName: string
    invoiceNumber?: string
    totalAmount?: string
}): Promise<SMSResult> {
    const { phone, guestName, invoiceNumber, totalAmount } = params

    let message = `🙏 Thank you for staying at AMP Lodge, ${guestName}!

We hope you had a wonderful stay.`

    if (invoiceNumber && totalAmount) {
        message += `

📄 Invoice: ${invoiceNumber}
💰 Total: ${totalAmount}`
    }

    message += `

We look forward to welcoming you back!
- AMP Lodge Team`

    return sendSMSWithFallback(phone, message, 'Check-out Confirmation')
}

/**
 * Send staff task assignment via SMS
 */
export async function sendTaskAssignmentSMS(params: {
    phone: string
    staffName: string
    roomNumber: string
    taskType: string
    completionUrl: string
}): Promise<SMSResult> {
    const { phone, staffName, roomNumber, taskType, completionUrl } = params

    const message = `📋 New Task Assigned

Hi ${staffName},

Task: ${taskType}
Room: ${roomNumber}

Complete task here:
${completionUrl}

- AMP Lodge`

    return sendSMS(phone, message, 'Task Assignment')
}
