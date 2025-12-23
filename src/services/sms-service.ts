// SMS Service - Uses Netlify serverless function for Arkesel calls
// This keeps API keys secure on the server side

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
            console.error(`❌ [SMSService] ${context} failed:`, data)
            return { success: false, error: data.error || 'Failed to send message' }
        }
    } catch (error: any) {
        console.error(`❌ [SMSService] ${context} error:`, error)
        return { success: false, error: error?.message || 'Failed to send message' }
    }
}

/**
 * Send SMS via Arkesel (through Netlify function)
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

    // Channel is 'sms' by default for Arkesel
    return sendViaNetlifyFunction(to, message, 'sms', context)
}

/**
 * Send WhatsApp message - DEPRECATED for Arkesel
 * Falls back to SMS for now as Arkesel SMS is the primary channel
 */
export async function sendWhatsApp(
    to: string,
    message: string,
    context = 'WhatsApp'
): Promise<SMSResult> {
    console.warn('[SMSService] WhatsApp channel not supported with Arkesel, falling back to SMS')
    return sendSMS(to, message, context)
}

/**
 * Send notification
 */
export async function sendSMSWithFallback(
    to: string,
    message: string,
    context = 'Notification'
): Promise<SMSResult> {
    // Just send SMS, as fallback logic was for Twilio channels
    return sendSMS(to, message, context)
}

/**
 * Send booking confirmation via SMS
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

    const message = `Hi ${guestName}, your booking at AMP Lodge is confirmed!
Room: ${roomNumber}
In: ${new Date(checkIn).toLocaleDateString()}
Out: ${new Date(checkOut).toLocaleDateString()}
ID: ${bookingId.slice(0, 8)}

We look forward to hosting you!
www.amplodge.org`

    return sendSMS(phone, message, 'Booking Confirmation')
}

/**
 * Send check-in confirmation via SMS
 */
export async function sendCheckInSMS(params: {
    phone: string
    guestName: string
    roomNumber: string
    checkOutDate: string
    paymentMethod?: string
    totalAmount?: number | string
}): Promise<SMSResult> {
    const { phone, guestName, roomNumber, checkOutDate, paymentMethod, totalAmount } = params

    const message = `Welcome ${guestName}!
You are checked in to Room ${roomNumber}.
Checkout: ${new Date(checkOutDate).toLocaleDateString()} @ 11AM
${totalAmount && paymentMethod ? `Paid: ${totalAmount} (${paymentMethod})` : ''}
WiFi password at front desk.
BFast: 7-10AM
Dial +233555009697 for help.

Enjoy your stay @ AMP Lodge!
www.amplodge.org`

    return sendSMS(phone, message, 'Check-in Confirmation')
}

/**
 * Send check-out confirmation via SMS
 */
export async function sendCheckOutSMS(params: {
    phone: string
    guestName: string
    invoiceNumber?: string
    totalAmount?: string
    bookingId?: string
}): Promise<SMSResult> {
    const { phone, guestName, invoiceNumber, totalAmount, bookingId } = params

    let message = `Thank you for staying at AMP Lodge, ${guestName}!`

    if (invoiceNumber && totalAmount) {
        message += `
Inv: ${invoiceNumber}
Total: ${totalAmount}`
    }

    message += `
Safe travels & see you soon!`

    if (bookingId) {
        message += `
Rate your stay: www.amplodge.org/review?bookingId=${bookingId}`
    } else {
        message += `
www.amplodge.org`
    }

    return sendSMS(phone, message, 'Check-out Confirmation')
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

    const message = `Task: ${taskType}
Room: ${roomNumber}
Staff: ${staffName}

Link: ${completionUrl}
www.amplodge.org`

    return sendSMS(phone, message, 'Task Assignment')
}

/**
 * Send manager notification when a guest checks in
 */
export async function sendManagerCheckInSMS(params: {
    phone: string
    guestName: string
    roomNumber: string
    staffName?: string
    paymentAmount?: string
    paymentMethod?: string
}): Promise<SMSResult> {
    const { phone, guestName, roomNumber, staffName, paymentAmount, paymentMethod } = params

    const now = new Date()
    const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

    let message = `🔔 CHECK-IN ALERT
Guest: ${guestName}
Room: ${roomNumber}
Time: ${date} ${time}`

    if (staffName) {
        message += `\nStaff: ${staffName}`
    }

    if (paymentAmount && paymentMethod) {
        message += `\nPaid: ${paymentAmount} (${paymentMethod})`
    }

    message += `\n\nAMP Lodge`

    return sendSMS(phone, message, 'Manager Check-in Alert')
}

/**
 * Send stay extension notification SMS to guest
 */
export async function sendStayExtensionSMS(params: {
    phone: string
    guestName: string
    newCheckout: string
    additionalNights: number
    extensionCost: string
}): Promise<SMSResult> {
    const { phone, guestName, newCheckout, additionalNights, extensionCost } = params

    const message = `✅ STAY EXTENDED
Hi ${guestName.split(' ')[0]},

Your stay has been extended!

📅 New Checkout: ${newCheckout}
➕ Added: ${additionalNights} night${additionalNights > 1 ? 's' : ''}
💰 Cost: ${extensionCost}

This has been added to your bill.

AMP Lodge`

    return sendSMS(phone, message, 'Stay Extension')
}

/**
 * Send online booking alert SMS to hotel
 */
export async function sendOnlineBookingAlertSMS(params: {
    guestName: string
    roomNumber: string
    roomType: string
    checkIn: string
    nights: number
    totalAmount: string
    source: 'online' | 'voice_agent'
}): Promise<SMSResult> {
    const { guestName, roomNumber, roomType, checkIn, nights, totalAmount, source } = params

    const hotelPhone = '+233555009697'
    const sourceLabel = source === 'voice_agent' ? 'Voice Agent' : 'Online'

    const message = `🔔 NEW BOOKING
Guest: ${guestName}
Room: ${roomNumber} (${roomType})
Check-in: ${checkIn}
${nights} night${nights > 1 ? 's' : ''} | ${totalAmount}
Source: ${sourceLabel}
AMP Lodge`

    return sendSMS(hotelPhone, message, 'Online Booking Alert')
}
