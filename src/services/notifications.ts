import { formatCurrencySync } from '@/lib/utils'
import { hotelSettingsService } from '@/services/hotel-settings'
import { sendTransactionalEmail } from '@/services/email-service'
import { sendCheckInSMS, sendCheckOutSMS, sendBookingConfirmationSMS } from '@/services/sms-service'
import { generateEmailHtml, EMAIL_STYLES } from '@/services/email-template'

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
 * Send booking confirmation to guest
 */
export async function sendBookingConfirmation(
  guest: Guest,
  room: Room,
  booking: Booking
): Promise<void> {
  try {
    console.log('📧 [BookingConfirmation] Starting confirmation email...', {
      guestEmail: guest.email,
      guestName: guest.name,
      roomNumber: room.roomNumber,
      bookingId: booking.id
    })

    const checkInDate = new Date(booking.checkIn)
    const checkOutDate = new Date(booking.checkOut)

    const htmlContent = generateEmailHtml({
      title: 'Booking Confirmed!',
      preheader: `Reservation confirmed for ${guest.name} at AMP Lodge`,
      content: `
        <p>Dear <strong>${guest.name}</strong>,</p>
        <p>Thank you for choosing AMP LODGE. Your reservation has been successfully confirmed. We look forward to hosting you!</p>
        
        <div style="${EMAIL_STYLES.infoBox}">
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Booking ID:</span> ${booking.id}
          </div>
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Room:</span> ${room.roomNumber}
          </div>
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Check-In:</span> ${checkInDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Check-Out:</span> ${checkOutDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>

        <h3 style="margin-top: 30px; font-size: 18px; color: #8B4513;">Check-in Information</h3>
        <ul>
          <li>Check-in time is from 2:00 PM</li>
          <li>Please present valid ID upon arrival</li>
          <li>Full payment is due upon check-in</li>
        </ul>
        
        <p style="margin-top: 30px;">
          Best regards,<br>
          <strong>The AMP LODGE Team</strong>
        </p>
      `
    })

    // Send email notification
    const result = await sendTransactionalEmail({
      to: guest.email,
      subject: 'Booking Confirmed - AMP Lodge',
      html: htmlContent,
      text: `
Booking Confirmed - AMP LODGE

Dear ${guest.name},

Thank you for choosing AMP LODGE. Your reservation has been successfully confirmed.

Reservation Details:
- Booking Reference: ${booking.id}
- Room: ${room.roomNumber}
- Check-In: ${checkInDate.toLocaleDateString()}
- Check-Out: ${checkOutDate.toLocaleDateString()}

Check-in Information:
- Check-in time is from 2:00 PM
- Please present valid ID upon arrival
- Full payment is due upon check-in

Best regards,
The AMP LODGE Team
      `
    })

    if (result.success) {
      console.log('✅ [BookingConfirmation] Confirmation email sent successfully!')
    } else {
      console.error('❌ [BookingConfirmation] Confirmation email failed:', result.error)
    }

    // SMS notification (if phone number provided)
    if (guest.phone) {
      sendBookingConfirmationSMS({
        phone: guest.phone,
        guestName: guest.name,
        roomNumber: room.roomNumber,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        bookingId: booking.id
      }).catch(err => console.error('SMS notification failed:', err))
    }
  } catch (error) {
    console.error('❌ [BookingConfirmation] Failed to send confirmation email:', error)
  }
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

    const htmlContent = generateEmailHtml({
      title: 'Welcome to AMP Lodge',
      preheader: `Check-in confirmed for Room ${room.roomNumber}`,
      content: `
        <p>Dear <strong>${guest.name}</strong>,</p>
        <p>Welcome to AMP LODGE! Your check-in has been confirmed. We hope you have a wonderful stay with us.</p>
        
        <div style="${EMAIL_STYLES.infoBox}">
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Room:</span> ${room.roomNumber}
          </div>
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Check-In:</span> ${checkInDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Check-Out:</span> ${checkOutDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Booking ID:</span> ${booking.id}
          </div>
        </div>

        <div style="background-color: #F5F5F5; border-radius: 4px; padding: 20px; margin-top: 20px;">
          <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #8B4513;">Guest Information</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li><strong>WiFi:</strong> Password available at front desk</li>
            <li><strong>Breakfast:</strong> 7:00 AM - 10:00 AM</li>
            <li><strong>Check-out:</strong> 11:00 AM</li>
            <li><strong>Reception:</strong> Dial 0</li>
          </ul>
        </div>
        
        <p style="margin-top: 30px;">
          Best regards,<br>
          <strong>The AMP LODGE Team</strong>
        </p>
      `
    })

    // Send email notification
    const result = await sendTransactionalEmail({
      to: guest.email,
      subject: 'Welcome to AMP Lodge - Check-In Confirmed',
      html: htmlContent,
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

    if (result.success) {
      console.log('✅ [CheckInNotification] Check-in email sent successfully!')
    } else {
      console.error('❌ [CheckInNotification] Check-in email failed:', result.error)
    }

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
  },
  attachments?: any[]
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

    let invoiceHtml = ''
    let callToAction = undefined

    if (invoiceData) {
      invoiceHtml = `
        <div style="background-color: #F8F9FA; border: 1px solid #E9ECEF; border-radius: 8px; padding: 20px; margin: 30px 0; text-align: center;">
          <h3 style="margin: 0 0 15px 0; color: #8B4513;">Your Invoice is Ready</h3>
          <p style="font-size: 24px; font-weight: bold; margin: 0 0 10px 0; color: #2C2416;">
            ${formatCurrencySync(invoiceData.totalAmount, currency)}
          </p>
          <p style="margin: 0; color: #666; font-size: 14px;">Invoice #: ${invoiceData.invoiceNumber}</p>
        </div>
      `

      callToAction = {
        text: 'Download Invoice',
        url: invoiceData.downloadUrl,
        color: '#8B4513'
      }
    }

    const htmlContent = generateEmailHtml({
      title: 'Thank You for Staying!',
      preheader: `Check-out receipt for ${guest.name}`,
      content: `
        <p>Dear <strong>${guest.name}</strong>,</p>
        <p>Thank you for choosing AMP LODGE! Your check-out has been successfully processed.</p>
        
        <div style="${EMAIL_STYLES.infoBox}">
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Room:</span> ${room.roomNumber}
          </div>
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Check-Out:</span> ${checkOutDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        ${invoiceHtml}
        
        <p style="margin-top: 20px;">We hope you had a wonderful stay!</p>
        
        <div style="background-color: #fdf2f8; border: 1px solid #fce7f3; border-radius: 8px; padding: 15px; margin-top: 20px; text-align: center;">
          <p style="margin: 0 0 10px 0;"><strong>How was your experience?</strong></p>
          <a href="https://amplodge.org/review?bookingId=${booking.id}" style="display: inline-block; background-color: #BE185D; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Rate Your Stay</a>
        </div>
        
        <p style="margin-top: 20px;">We look forward to welcoming you back soon!</p>

        <p style="margin-top: 30px;">
          Best regards,<br>
          <strong>The AMP LODGE Team</strong>
        </p>
      `,
      callToAction: callToAction
    })

    // Send email notification
    const result = await sendTransactionalEmail({
      to: guest.email,
      subject: 'Thank You for Staying at AMP Lodge',
      html: htmlContent,
      text: `
Thank You for Staying at AMP LODGE!

Dear ${guest.name},

Thank you for choosing AMP LODGE! Your check-out has been processed.

Stay Summary:
- Room: ${room.roomNumber}
- Check-Out: ${checkOutDate.toLocaleDateString()}
- Booking ID: ${booking.id}

${invoiceData ? `
Invoice Details:
- Invoice #: ${invoiceData.invoiceNumber}
- Total Amount: ${formatCurrencySync(invoiceData.totalAmount, currency)}

Download your invoice here:
${invoiceData.downloadUrl}
` : ''}

We hope you had a wonderful stay!

Please rate your experience:
https://amplodge.org/review?bookingId=${booking.id}

Best regards,
The AMP LODGE Team
      `,
      attachments: attachments
    })

    if (result.success) {
      console.log('✅ [CheckOutNotification] Check-out email sent successfully!')
    } else {
      console.error('❌ [CheckOutNotification] Check-out email failed:', result.error)
    }

    // SMS/WhatsApp notification (if phone number provided)
    if (guest.phone) {
      sendCheckOutSMS({
        phone: guest.phone,
        guestName: guest.name,
        invoiceNumber: invoiceData?.invoiceNumber,
        totalAmount: invoiceData ? formatCurrencySync(invoiceData.totalAmount, currency) : undefined,
        bookingId: booking.id
      }).catch(err => console.error('SMS notification failed:', err))
    }
  } catch (error) {
    console.error('❌ [CheckOutNotification] Failed to send check-out notification:', error)
  }
}
