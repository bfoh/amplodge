import { formatCurrencySync } from '@/lib/utils'
import { hotelSettingsService } from '@/services/hotel-settings'
import { sendTransactionalEmail } from '@/services/email-service'
import { sendCheckInSMS, sendCheckOutSMS } from '@/services/sms-service'

interface Guest {
  id: string
  name: string
  email: string
  phone: string | null
}

interface Room {
  id: string
  roomNumber: string
}

interface Booking {
  id: string
  checkIn: string
  checkOut: string
  actualCheckIn?: string
  actualCheckOut?: string
}

/**
 * Send check-in notification to guest
 */
export async function sendCheckInNotification(
  guest: Guest,
  room: Room,
  booking: Booking
): Promise<void> {
  try {
    console.log('📧 [CheckInNotification] Starting check-in email...', {
      guestEmail: guest.email,
      guestName: guest.name,
      roomNumber: room.roomNumber,
      bookingId: booking.id
    })

    const checkInDate = new Date(booking.actualCheckIn || booking.checkIn)
    const checkOutDate = new Date(booking.checkOut)

    // Get currency for formatting (even though check-in doesn't show prices, we keep it consistent)
    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

    // Send email notification
    await sendTransactionalEmail({
      to: guest.email,
      subject: 'Welcome to AMP Lodge - Check-In Confirmed',
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: #8B4513; padding: 40px 20px; text-align: center;">
            <div style="margin-bottom: 12px;">
              <img src="/amp.png" alt="AMP LODGE" style="height: 50px; width: auto; max-width: 150px;" />
            </div>
            <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-family: 'Arial', sans-serif; font-weight: 700;">AMP LODGE</h1>
            <p style="color: #F5F1E8; margin: 10px 0 0 0; font-size: 16px;">Welcome to Your Stay</p>
          </div>
          
          <div style="padding: 40px 20px;">
            <h2 style="color: #2C2416; font-size: 24px; margin: 0 0 20px 0;">Check-In Confirmed</h2>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
              Dear ${guest.name},
            </p>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
              Welcome to AMP LODGE! Your check-in has been confirmed. We hope you have a wonderful stay with us.
            </p>
            
            <div style="background: #F5F1E8; border-left: 4px solid #8B6F47; padding: 20px; margin: 0 0 30px 0;">
              <p style="margin: 0 0 10px 0; color: #2C2416; font-weight: 600;">Booking Details:</p>
              <p style="margin: 5px 0; color: #4a4a4a;"><strong>Room:</strong> ${room.roomNumber}</p>
              <p style="margin: 5px 0; color: #4a4a4a;"><strong>Check-In:</strong> ${checkInDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p style="margin: 5px 0; color: #4a4a4a;"><strong>Check-Out:</strong> ${checkOutDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p style="margin: 5px 0; color: #4a4a4a;"><strong>Booking ID:</strong> ${booking.id}</p>
            </div>
            
            <div style="background: #ffffff; border: 1px solid #e5e5e5; padding: 20px; margin: 0 0 30px 0; border-radius: 8px;">
              <h3 style="color: #2C2416; font-size: 18px; margin: 0 0 15px 0;">Important Information:</h3>
              <ul style="color: #4a4a4a; margin: 0; padding-left: 20px; line-height: 1.8;">
                <li>WiFi password available at the front desk</li>
                <li>Breakfast served daily 7:00 AM - 10:00 AM</li>
                <li>Check-out time is 11:00 AM</li>
                <li>For assistance, dial 0 from your room phone</li>
              </ul>
            </div>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
              If you need anything during your stay, please don't hesitate to contact our front desk.
            </p>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin: 0;">
              Best regards,<br>
              <strong style="color: #8B6F47;">The AMP LODGE Team</strong>
            </p>
          </div>
          
          <div style="background: #F5F1E8; padding: 20px; text-align: center; border-top: 1px solid #e5e5e5;">
            <p style="color: #6b6b6b; font-size: 14px; margin: 0;">
              AMP LODGE | Premium Hospitality Experience
            </p>
          </div>
        </div>
      `,
      text: `
Welcome to AMP LODGE!

Dear ${guest.name},

Your check-in has been confirmed. We hope you have a wonderful stay with us.

Booking Details:
- Room: ${room.roomNumber}
- Check-In: ${checkInDate.toLocaleDateString()}
- Check-Out: ${checkOutDate.toLocaleDateString()}
- Booking ID: ${booking.id}

Important Information:
- WiFi password available at the front desk
- Breakfast served daily 7:00 AM - 10:00 AM
- Check-out time is 11:00 AM
- For assistance, dial 0 from your room phone

Best regards,
The AMP LODGE Team
      `
    })

    console.log('✅ [CheckInNotification] Check-in email sent successfully!', {
      guestEmail: guest.email,
      guestName: guest.name
    })

    // SMS/WhatsApp notification (if phone number provided)
    if (guest.phone) {
      sendCheckInSMS({
        phone: guest.phone,
        guestName: guest.name,
        roomNumber: room.roomNumber,
        checkOutDate: checkOutDate.toISOString()
      }).catch(err => console.error('SMS notification failed:', err))
    }
  } catch (error) {
    console.error('❌ [CheckInNotification] Failed to send check-in notification:', error)
    // Don't throw - notification failures shouldn't block check-in
  }
}

/**
 * Send check-out notification to guest with invoice information
 */
export async function sendCheckOutNotification(
  guest: Guest,
  room: Room,
  booking: Booking,
  invoiceData?: {
    invoiceNumber: string
    totalAmount: number
    downloadUrl: string
  }
): Promise<void> {
  try {
    console.log('📧 [CheckOutNotification] Starting check-out email...', {
      guestEmail: guest.email,
      guestName: guest.name,
      roomNumber: room.roomNumber,
      bookingId: booking.id,
      hasInvoiceData: !!invoiceData
    })

    const checkOutDate = new Date(booking.actualCheckOut || booking.checkOut)
    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

    console.log('📧 [CheckOutNotification] About to send email via blink...')

    // Test with simplified email content first
    const testEmailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #8B6F47;">Thank You for Staying at AMP LODGE!</h1>
        <p>Dear ${guest.name},</p>
        <p>Thank you for choosing AMP LODGE! Your check-out has been processed.</p>
        <p><strong>Room:</strong> ${room.roomNumber}</p>
        <p><strong>Check-out:</strong> ${checkOutDate.toLocaleDateString()}</p>
        <p><strong>Booking ID:</strong> ${booking.id}</p>
        ${invoiceData ? `
          <h2>Your Invoice</h2>
          <p><strong>Invoice #:</strong> ${invoiceData.invoiceNumber}</p>
          <p><strong>Total Amount:</strong> ${formatCurrencySync(invoiceData.totalAmount, currency)}</p>
          <p><a href="${invoiceData.downloadUrl}">Download Invoice</a></p>
        ` : ''}
        <p>We hope you had a wonderful stay!</p>
        <p>Best regards,<br>The AMP LODGE Team</p>
      </div>
    `

    // Send email notification
    await sendTransactionalEmail({
      to: guest.email,
      subject: 'Thank You for Staying at AMP Lodge',
      html: testEmailContent,
      text: `
Thank You for Staying at AMP LODGE!

Dear ${guest.name},

Thank you for choosing AMP LODGE! Your check-out has been processed.

Stay Summary:
- Room: ${room.roomNumber}
- Check-Out: ${checkOutDate.toLocaleDateString()}
- Booking ID: ${booking.id}
${invoiceData ? `
- Invoice #: ${invoiceData.invoiceNumber}
- Total Amount: ${formatCurrencySync(invoiceData.totalAmount, currency)}

Your invoice is ready for download!
Download link: ${invoiceData.downloadUrl}
` : ''}

We hope you had a wonderful stay!

Best regards,
The AMP LODGE Team
      `
    })

    console.log('✅ [CheckOutNotification] Check-out email sent successfully!', {
      guestEmail: guest.email,
      guestName: guest.name,
      hasInvoiceData: !!invoiceData
    })

    // SMS/WhatsApp notification (if phone number provided)
    if (guest.phone) {
      sendCheckOutSMS({
        phone: guest.phone,
        guestName: guest.name,
        invoiceNumber: invoiceData?.invoiceNumber,
        totalAmount: invoiceData ? formatCurrencySync(invoiceData.totalAmount, currency) : undefined
      }).catch(err => console.error('SMS notification failed:', err))
    }
  } catch (error) {
    console.error('❌ [CheckOutNotification] Failed to send check-out notification:', error)
    // Don't throw - notification failures shouldn't block check-out
  }
}
