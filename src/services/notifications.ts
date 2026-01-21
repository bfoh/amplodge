import { formatCurrencySync } from '@/lib/utils'
import { hotelSettingsService } from '@/services/hotel-settings'
import { sendTransactionalEmail } from '@/services/email-service'
import { sendCheckInSMS, sendCheckOutSMS, sendBookingConfirmationSMS, sendManagerCheckInSMS } from '@/services/sms-service'
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
  booking: Booking,
  attachments?: any[]
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
  booking: Booking,
  paymentDetails?: {
    method: string
    amount: number | string
  }
): Promise<void> {
  try {
    console.log('📧 [CheckInNotification] Starting check-in email...', {
      guestEmail: guest.email,
      guestName: guest.name,
      roomNumber: room.roomNumber,
      bookingId: booking.id,
      paymentDetails
    })

    const checkInDate = new Date(booking.actualCheckIn || booking.checkIn)
    const checkOutDate = new Date(booking.checkOut)
    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

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
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Booking ID:</span> ${booking.id}
          </div>
          ${paymentDetails ? `
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Payment Verified:</span> ${typeof paymentDetails.amount === 'number' ? formatCurrencySync(paymentDetails.amount, currency) : paymentDetails.amount} via ${paymentDetails.method}
          </div>` : ''}
        </div>

        <div style="background-color: #F5F5F5; border-radius: 4px; padding: 20px; margin-top: 20px;">
          <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #8B4513;">Guest Information</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li><strong>WiFi:</strong> Password available at front desk</li>
            <li><strong>Breakfast:</strong> 7:00 AM - 10:00 AM</li>
            <li><strong>Check-out:</strong> 11:00 AM</li>
            <li><strong>Reception:</strong> Dial +233555009697</li>
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
- For assistance, dial +233555009697 from your room phone

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
        checkOutDate: checkOutDate.toISOString(),
        paymentMethod: paymentDetails?.method,
        totalAmount: paymentDetails?.amount ? (typeof paymentDetails.amount === 'number' ? formatCurrencySync(paymentDetails.amount, currency) : paymentDetails.amount) : undefined
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
        color: '#2C2416'
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

/**
 * Send manager notification when a guest checks in
 */
export async function sendManagerCheckInNotification(
  guest: Guest,
  room: Room,
  booking: Booking,
  staffName?: string,
  paymentDetails?: {
    method: string
    amount: number | string
  }
): Promise<void> {
  try {
    // Get hotel settings to check if manager notifications are enabled
    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

    // Check if manager notifications are enabled
    if (!settings.managerNotificationsEnabled) {
      console.log('📧 [ManagerNotification] Manager notifications disabled, skipping')
      return
    }

    // Check if manager contact info exists
    if (!settings.managerEmail && !settings.managerPhone) {
      console.log('📧 [ManagerNotification] No manager contact info configured, skipping')
      return
    }

    console.log('📧 [ManagerNotification] Sending manager check-in notification...', {
      guestName: guest.name,
      roomNumber: room.roomNumber,
      managerEmail: settings.managerEmail,
      managerPhone: settings.managerPhone
    })

    const checkInDate = new Date(booking.actualCheckIn || booking.checkIn)
    const checkOutDate = new Date(booking.checkOut)

    // Send Email notification to manager
    if (settings.managerEmail) {
      const paymentInfo = paymentDetails
        ? `<strong>${formatCurrencySync(Number(paymentDetails.amount), currency)}</strong> via ${paymentDetails.method}`
        : 'Not recorded'

      const htmlContent = generateEmailHtml({
        title: '🔔 Guest Check-In Alert',
        preheader: `${guest.name} has checked in to Room ${room.roomNumber}`,
        content: `
          <p style="margin-bottom: 15px;">A guest has just checked in:</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>Guest Name:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">${guest.name}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>Email:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">${guest.email}</td>
              </tr>
              ${guest.phone ? `
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>Phone:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">${guest.phone}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>Room:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">${room.roomNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>Check-in:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">${checkInDate.toLocaleDateString()} at ${checkInDate.toLocaleTimeString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>Check-out:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">${checkOutDate.toLocaleDateString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>Payment:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">${paymentInfo}</td>
              </tr>
              ${staffName ? `
              <tr>
                <td style="padding: 8px 0;"><strong>Checked in by:</strong></td>
                <td style="padding: 8px 0;">${staffName}</td>
              </tr>
              ` : ''}
            </table>
          </div>
          
          <p style="color: #666; font-size: 14px;">This is an automated notification from the AMP Lodge management system.</p>
        `
      })

      const result = await sendTransactionalEmail({
        to: settings.managerEmail,
        subject: `🔔 Check-In: ${guest.name} - Room ${room.roomNumber}`,
        html: htmlContent,
        text: `Guest Check-In Alert\n\nGuest: ${guest.name}\nRoom: ${room.roomNumber}\nCheck-in: ${checkInDate.toLocaleString()}\nPayment: ${paymentInfo}\n${staffName ? `Staff: ${staffName}` : ''}`
      })

      if (result.success) {
        console.log('✅ [ManagerNotification] Email sent successfully')
      } else {
        console.error('❌ [ManagerNotification] Email failed:', result.error)
      }
    }

    // Send SMS notification to manager
    if (settings.managerPhone) {
      sendManagerCheckInSMS({
        phone: settings.managerPhone,
        guestName: guest.name,
        roomNumber: room.roomNumber,
        staffName,
        paymentAmount: paymentDetails ? formatCurrencySync(Number(paymentDetails.amount), currency) : undefined,
        paymentMethod: paymentDetails?.method
      }).catch(err => console.error('❌ [ManagerNotification] SMS failed:', err))
    }

  } catch (error) {
    console.error('❌ [ManagerNotification] Failed to send manager notification:', error)
  }
}

/**
 * Send stay extension notification to guest
 */
export async function sendStayExtensionNotification(
  guest: Guest,
  room: Room,
  booking: { id: string; checkIn: string; checkOut: string; originalCheckout: string },
  additionalNights: number,
  extensionCost: number,
  newRoomId?: string
): Promise<void> {
  try {
    console.log('📧 [StayExtension] Sending extension notification...', {
      guestEmail: guest.email,
      guestName: guest.name,
      additionalNights,
      extensionCost
    })

    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

    const originalCheckout = new Date(booking.originalCheckout)
    const newCheckout = new Date(booking.checkOut)

    const roomChangeNote = newRoomId
      ? `\n\n<p style="color: #D97706;"><strong>📋 Room Change:</strong> You have been moved to a new room. Please check with reception for your new room details.</p>`
      : ''

    const htmlContent = generateEmailHtml({
      title: 'Stay Extended!',
      preheader: `Your stay at ${settings.name} has been extended`,
      content: `
        <p>Dear <strong>${guest.name}</strong>,</p>
        <p>Your stay has been successfully extended! Here are your updated booking details:</p>
        
        <div style="${EMAIL_STYLES.infoBox}">
          <p><strong>🏨 Room:</strong> ${room.roomNumber}</p>
          <p><strong>📅 Original Checkout:</strong> ${originalCheckout.toLocaleDateString()}</p>
          <p><strong>📅 New Checkout:</strong> ${newCheckout.toLocaleDateString()}</p>
          <p><strong>➕ Additional Nights:</strong> ${additionalNights}</p>
          <p><strong>💰 Extension Cost:</strong> ${formatCurrencySync(extensionCost, currency)}</p>
        </div>
        ${roomChangeNote}
        <p>The extension cost has been added to your bill and will be included in your final invoice at checkout.</p>
        <p>If you have any questions, please contact our reception desk.</p>
        <p>Thank you for choosing to extend your stay with us!</p>
      `
    })

    if (guest.email) {
      await sendTransactionalEmail({
        to: guest.email,
        subject: `Stay Extended: ${newCheckout.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${settings.name}`,
        html: htmlContent,
        text: `Stay Extended!\n\nDear ${guest.name},\n\nYour stay has been extended.\n\nRoom: ${room.roomNumber}\nOriginal Checkout: ${originalCheckout.toLocaleDateString()}\nNew Checkout: ${newCheckout.toLocaleDateString()}\nAdditional Nights: ${additionalNights}\nExtension Cost: ${formatCurrencySync(extensionCost, currency)}\n\nThe extension cost has been added to your bill.\n\nThank you!\n${settings.name}`
      })
      console.log('✅ [StayExtension] Email sent successfully')
    }

    // Send SMS notification
    if (guest.phone) {
      const { sendStayExtensionSMS } = await import('@/services/sms-service')
      await sendStayExtensionSMS({
        phone: guest.phone,
        guestName: guest.name,
        newCheckout: newCheckout.toLocaleDateString(),
        additionalNights,
        extensionCost: formatCurrencySync(extensionCost, currency)
      })
      console.log('✅ [StayExtension] SMS sent successfully')
    }

  } catch (error) {
    console.error('❌ [StayExtension] Failed to send notification:', error)
  }
}

/**
 * Send online booking alert to hotel staff
 */
export async function sendOnlineBookingAlert(
  guest: { name: string; email: string; phone?: string | null },
  room: { roomNumber: string; roomType?: string },
  booking: {
    id: string
    checkIn: string
    checkOut: string
    totalPrice: number
    numGuests: number
  },
  source: 'online' | 'voice_agent' = 'online'
): Promise<void> {
  try {
    console.log('📧 [OnlineBookingAlert] Sending hotel alert...', {
      guestName: guest.name,
      roomNumber: room.roomNumber,
      source
    })

    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

    const checkInDate = new Date(booking.checkIn)
    const checkOutDate = new Date(booking.checkOut)
    const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24))

    const sourceLabel = source === 'voice_agent' ? '🎤 Voice Agent' : '🌐 Online Website'
    const hotelEmail = 'amplodge0555009697@gmail.com'

    const htmlContent = generateEmailHtml({
      title: 'New Booking Alert!',
      preheader: `New ${source === 'voice_agent' ? 'voice agent' : 'online'} booking from ${guest.name}`,
      content: `
        <p><strong>🔔 A new booking has been made!</strong></p>
        
        <div style="${EMAIL_STYLES.infoBox}">
          <p><strong>📌 Source:</strong> ${sourceLabel}</p>
          <p><strong>⏰ Time:</strong> ${new Date().toLocaleString()}</p>
        </div>
        
        <h3 style="color: #1a1a1a; margin-top: 24px;">Guest Information</h3>
        <div style="${EMAIL_STYLES.infoBox}">
          <p><strong>👤 Name:</strong> ${guest.name}</p>
          <p><strong>📧 Email:</strong> ${guest.email}</p>
          <p><strong>📱 Phone:</strong> ${guest.phone || 'Not provided'}</p>
          <p><strong>👥 Guests:</strong> ${booking.numGuests}</p>
        </div>
        
        <h3 style="color: #1a1a1a; margin-top: 24px;">Booking Details</h3>
        <div style="${EMAIL_STYLES.infoBox}">
          <p><strong>🏨 Room:</strong> ${room.roomNumber} (${room.roomType || 'Standard Room'})</p>
          <p><strong>📅 Check-in:</strong> ${checkInDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <p><strong>📅 Check-out:</strong> ${checkOutDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <p><strong>🌙 Nights:</strong> ${nights}</p>
          <p><strong>💰 Total:</strong> ${formatCurrencySync(booking.totalPrice, currency)}</p>
        </div>
      `
    })

    await sendTransactionalEmail({
      to: hotelEmail,
      subject: `🔔 New ${source === 'voice_agent' ? 'Voice' : 'Online'} Booking - ${guest.name} | Room ${room.roomNumber}`,
      html: htmlContent,
      text: `New Booking Alert!\n\nSource: ${sourceLabel}\nTime: ${new Date().toLocaleString()}\n\nGuest: ${guest.name}\nEmail: ${guest.email}\nPhone: ${guest.phone || 'Not provided'}\n\nRoom: ${room.roomNumber}\nCheck-in: ${checkInDate.toLocaleDateString()}\nCheck-out: ${checkOutDate.toLocaleDateString()}\nNights: ${nights}\nTotal: ${formatCurrencySync(booking.totalPrice, currency)}`
    })

    console.log('✅ [OnlineBookingAlert] Email sent to hotel')

    // Send SMS notification
    const { sendOnlineBookingAlertSMS } = await import('@/services/sms-service')
    await sendOnlineBookingAlertSMS({
      guestName: guest.name,
      roomNumber: room.roomNumber,
      roomType: room.roomType || 'Standard',
      checkIn: checkInDate.toLocaleDateString(),
      nights,
      totalAmount: formatCurrencySync(booking.totalPrice, currency),
      source
    })

    console.log('✅ [OnlineBookingAlert] SMS sent to hotel')

  } catch (error) {
    console.error('❌ [OnlineBookingAlert] Failed to send alert:', error)
  }
}

/**
 * Send notification when a new member is added to a group booking
 * Notifies both the billing contact (primary booker) and the new guest
 */
export async function sendGroupMemberAddedNotification(
  newGuest: { name: string; email: string; phone?: string | null },
  billingContact: { name: string; email: string; phone?: string | null } | null,
  room: { roomNumber: string; roomType?: string },
  booking: { checkIn: string; checkOut: string },
  groupReference: string
): Promise<void> {
  try {
    console.log('📧 [GroupMemberAdded] Sending notifications...', {
      newGuest: newGuest.name,
      billingContact: billingContact?.name,
      groupReference
    })

    const settings = await hotelSettingsService.getHotelSettings()
    const checkInDate = new Date(booking.checkIn)
    const checkOutDate = new Date(booking.checkOut)

    // Notify the new guest
    if (newGuest.email && !newGuest.email.includes('@guest.local')) {
      const guestHtml = generateEmailHtml({
        title: 'You\'ve Been Added to a Group Booking!',
        preheader: `Welcome to the group ${groupReference} at AMP Lodge`,
        content: `
          <p>Dear <strong>${newGuest.name}</strong>,</p>
          <p>You have been added to a group booking at AMP LODGE. Here are your reservation details:</p>
          
          <div style="${EMAIL_STYLES.infoBox}">
            <div style="${EMAIL_STYLES.infoRow}">
              <span style="${EMAIL_STYLES.infoLabel}">Group Reference:</span> ${groupReference}
            </div>
            <div style="${EMAIL_STYLES.infoRow}">
              <span style="${EMAIL_STYLES.infoLabel}">Room:</span> ${room.roomNumber}${room.roomType ? ` (${room.roomType})` : ''}
            </div>
            <div style="${EMAIL_STYLES.infoRow}">
              <span style="${EMAIL_STYLES.infoLabel}">Check-In:</span> ${checkInDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            <div style="${EMAIL_STYLES.infoRow}">
              <span style="${EMAIL_STYLES.infoLabel}">Check-Out:</span> ${checkOutDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>

          <p style="margin-top: 20px;">
            <strong>Important:</strong>
          </p>
          <ul>
            <li>Check-in time is from 2:00 PM</li>
            <li>Please present valid ID upon arrival</li>
          </ul>
          
          <p style="margin-top: 30px;">
            We look forward to welcoming you!<br>
            <strong>The AMP LODGE Team</strong>
          </p>
        `
      })

      await sendTransactionalEmail({
        to: newGuest.email,
        subject: `Group Booking Confirmation - ${groupReference} | AMP Lodge`,
        html: guestHtml,
        text: `Welcome to AMP LODGE!\n\nYou have been added to group booking ${groupReference}.\n\nRoom: ${room.roomNumber}\nCheck-in: ${checkInDate.toLocaleDateString()}\nCheck-out: ${checkOutDate.toLocaleDateString()}\n\nWe look forward to welcoming you!`
      })
      console.log('✅ [GroupMemberAdded] Email sent to new guest')
    }

    // Send SMS to new guest
    if (newGuest.phone) {
      const { sendSMS } = await import('@/services/sms-service')
      const smsMessage = `AMP LODGE: Hi ${newGuest.name}, you've been added to group booking ${groupReference}. Room ${room.roomNumber}, Check-in: ${checkInDate.toLocaleDateString()}. We look forward to hosting you!`
      await sendSMS(newGuest.phone, smsMessage, 'Group Member Added').catch(err => console.error('SMS to new guest failed:', err))
      console.log('✅ [GroupMemberAdded] SMS sent to new guest')
    }

    // Notify the billing contact (primary booker) about the addition
    if (billingContact && billingContact.email && billingContact.email !== newGuest.email) {
      const contactHtml = generateEmailHtml({
        title: 'Group Booking Updated',
        preheader: `A new member has been added to ${groupReference}`,
        content: `
          <p>Dear <strong>${billingContact.name}</strong>,</p>
          <p>A new member has been added to your group booking:</p>
          
          <div style="${EMAIL_STYLES.infoBox}">
            <div style="${EMAIL_STYLES.infoRow}">
              <span style="${EMAIL_STYLES.infoLabel}">Group Reference:</span> ${groupReference}
            </div>
            <div style="${EMAIL_STYLES.infoRow}">
              <span style="${EMAIL_STYLES.infoLabel}">New Guest:</span> ${newGuest.name}
            </div>
            <div style="${EMAIL_STYLES.infoRow}">
              <span style="${EMAIL_STYLES.infoLabel}">Room Assigned:</span> ${room.roomNumber}${room.roomType ? ` (${room.roomType})` : ''}
            </div>
            <div style="${EMAIL_STYLES.infoRow}">
              <span style="${EMAIL_STYLES.infoLabel}">Dates:</span> ${checkInDate.toLocaleDateString()} - ${checkOutDate.toLocaleDateString()}
            </div>
          </div>
          
          <p style="margin-top: 30px;">
            Best regards,<br>
            <strong>The AMP LODGE Team</strong>
          </p>
        `
      })

      await sendTransactionalEmail({
        to: billingContact.email,
        subject: `Group Update: New Member Added - ${groupReference} | AMP Lodge`,
        html: contactHtml,
        text: `Group Booking Updated\n\nA new member has been added to your group ${groupReference}.\n\nNew Guest: ${newGuest.name}\nRoom: ${room.roomNumber}\nDates: ${checkInDate.toLocaleDateString()} - ${checkOutDate.toLocaleDateString()}`
      })
      console.log('✅ [GroupMemberAdded] Email sent to billing contact')
    }

    // Send SMS to billing contact
    if (billingContact?.phone && billingContact.phone !== newGuest.phone) {
      const { sendSMS } = await import('@/services/sms-service')
      const smsMessage = `AMP LODGE: ${newGuest.name} has been added to your group booking ${groupReference} (Room ${room.roomNumber}).`
      await sendSMS(billingContact.phone, smsMessage, 'Group Member Added - Billing Contact').catch(err => console.error('SMS to billing contact failed:', err))
      console.log('✅ [GroupMemberAdded] SMS sent to billing contact')
    }

  } catch (error) {
    console.error('❌ [GroupMemberAdded] Failed to send notifications:', error)
  }
}

/**
 * Send notification when a group member's information is updated
 */
export async function sendGroupMemberUpdatedNotification(
  guest: { name: string; email: string; phone?: string | null },
  room: { roomNumber: string },
  changes: { field: string; oldValue: string; newValue: string }[],
  groupReference: string
): Promise<void> {
  try {
    console.log('📧 [GroupMemberUpdated] Sending update notification...', {
      guestName: guest.name,
      groupReference,
      changesCount: changes.length
    })

    if (!guest.email || guest.email.includes('@guest.local')) {
      console.log('📧 [GroupMemberUpdated] No valid email, skipping')
      return
    }

    const changesHtml = changes.map(c =>
      `<li><strong>${c.field}:</strong> ${c.oldValue} → ${c.newValue}</li>`
    ).join('')

    const htmlContent = generateEmailHtml({
      title: 'Booking Information Updated',
      preheader: `Your reservation details have been updated`,
      content: `
        <p>Dear <strong>${guest.name}</strong>,</p>
        <p>Your reservation information has been updated:</p>
        
        <div style="${EMAIL_STYLES.infoBox}">
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Group Reference:</span> ${groupReference}
          </div>
          <div style="${EMAIL_STYLES.infoRow}">
            <span style="${EMAIL_STYLES.infoLabel}">Room:</span> ${room.roomNumber}
          </div>
        </div>

        <h3 style="margin-top: 20px; color: #8B4513;">Changes Made:</h3>
        <ul>
          ${changesHtml}
        </ul>
        
        <p style="margin-top: 20px;">If you have any questions about these changes, please contact our reception.</p>
        
        <p style="margin-top: 30px;">
          Best regards,<br>
          <strong>The AMP LODGE Team</strong>
        </p>
      `
    })

    await sendTransactionalEmail({
      to: guest.email,
      subject: `Booking Updated - ${groupReference} | AMP Lodge`,
      html: htmlContent,
      text: `Booking Updated\n\nDear ${guest.name},\n\nYour reservation information has been updated.\n\nChanges:\n${changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n')}\n\nBest regards,\nThe AMP LODGE Team`
    })
    console.log('✅ [GroupMemberUpdated] Email sent successfully')

    // Send SMS notification
    if (guest.phone) {
      const { sendSMS } = await import('@/services/sms-service')
      const smsMessage = `AMP LODGE: Your booking info for group ${groupReference} has been updated. ${changes.map(c => `${c.field}: ${c.newValue}`).join(', ')}.`
      await sendSMS(guest.phone, smsMessage, 'Group Member Updated').catch(err => console.error('SMS notification failed:', err))
      console.log('✅ [GroupMemberUpdated] SMS sent successfully')
    }

  } catch (error) {
    console.error('❌ [GroupMemberUpdated] Failed to send notification:', error)
  }
}

