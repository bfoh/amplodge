import { sendTransactionalEmail } from '@/services/email-service'

interface InvoiceData {
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  guest: {
    name: string
    email: string
    phone?: string
    address?: string
  }
  booking: {
    id: string
    roomNumber: string
    roomType: string
    checkIn: string
    checkOut: string
    nights: number
    numGuests: number
  }
  charges: {
    roomRate: number
    nights: number
    subtotal: number
    taxRate: number
    taxAmount: number
    total: number
  }
  hotel: {
    name: string
    address: string
    phone: string
    email: string
    website: string
  }
}

interface BookingWithDetails {
  id: string
  guestId: string
  roomId: string
  checkIn: string
  checkOut: string
  status: string
  totalPrice: number
  numGuests: number
  specialRequests?: string
  actualCheckIn?: string
  actualCheckOut?: string
  createdAt: string
  guest?: {
    name: string
    email: string
    phone?: string
    address?: string
  }
  room?: {
    roomNumber: string
    roomType?: string
  }
}

export async function debugInvoiceSystem(): Promise<{ success: boolean; details: any; error?: string }> {
  try {
    console.log('🔍 [InvoiceDebug] Starting comprehensive invoice system debug...')
    
    const debugResults = {
      timestamp: new Date().toISOString(),
      tests: [] as any[],
      overallSuccess: true,
      errors: [] as string[]
    }

    // Test 1: Check Blink client availability
    console.log('🔍 [InvoiceDebug] Test 1: Checking Blink client availability...')
    try {
      const clientCheck = {
        test: 'blink_client_availability',
        success: true,
        details: {
          blinkManaged: !!blinkManaged,
          notifications: !!blinkManaged?.notifications,
          email: !!blinkManaged?.notifications?.email
        }
      }
      debugResults.tests.push(clientCheck)
      console.log('✅ [InvoiceDebug] Blink client available:', clientCheck.details)
    } catch (error: any) {
      const clientCheck = {
        test: 'blink_client_availability',
        success: false,
        error: error.message
      }
      debugResults.tests.push(clientCheck)
      debugResults.errors.push(`Blink client error: ${error.message}`)
      debugResults.overallSuccess = false
      console.error('❌ [InvoiceDebug] Blink client error:', error)
    }

    // Test 2: Create test invoice data
    console.log('🔍 [InvoiceDebug] Test 2: Creating test invoice data...')
    try {
      const testBooking = {
        id: 'debug-test-booking-123',
        guestId: 'debug-guest-123',
        roomId: 'debug-room-123',
        checkIn: '2024-01-01T00:00:00Z',
        checkOut: '2024-01-03T00:00:00Z',
        status: 'checked-out',
        totalPrice: 200,
        numGuests: 2,
        actualCheckOut: '2024-01-03T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        guest: {
          name: 'Debug Test Guest',
          email: 'debug@test.com',
          phone: '+1234567890',
          address: '123 Debug St'
        },
        room: {
          roomNumber: 'DEBUG-101',
          roomType: 'Debug Room'
        }
      }

      const testRoom = {
        roomNumber: 'DEBUG-101',
        roomType: 'Debug Room'
      }

      const invoiceData = createInvoiceData(testBooking, testRoom)
      const dataCheck = {
        test: 'invoice_data_creation',
        success: true,
        details: {
          invoiceNumber: invoiceData.invoiceNumber,
          guestEmail: invoiceData.guest.email,
          total: invoiceData.charges.total,
          hasAllRequiredFields: !!(invoiceData.invoiceNumber && invoiceData.guest.email && invoiceData.charges.total)
        }
      }
      debugResults.tests.push(dataCheck)
      console.log('✅ [InvoiceDebug] Invoice data created:', dataCheck.details)
    } catch (error: any) {
      const dataCheck = {
        test: 'invoice_data_creation',
        success: false,
        error: error.message
      }
      debugResults.tests.push(dataCheck)
      debugResults.errors.push(`Invoice data creation error: ${error.message}`)
      debugResults.overallSuccess = false
      console.error('❌ [InvoiceDebug] Invoice data creation error:', error)
    }

    // Test 3: Generate HTML
    console.log('🔍 [InvoiceDebug] Test 3: Generating invoice HTML...')
    try {
      const testBooking = {
        id: 'debug-test-booking-123',
        guestId: 'debug-guest-123',
        roomId: 'debug-room-123',
        checkIn: '2024-01-01T00:00:00Z',
        checkOut: '2024-01-03T00:00:00Z',
        status: 'checked-out',
        totalPrice: 200,
        numGuests: 2,
        actualCheckOut: '2024-01-03T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        guest: {
          name: 'Debug Test Guest',
          email: 'debug@test.com',
          phone: '+1234567890',
          address: '123 Debug St'
        },
        room: {
          roomNumber: 'DEBUG-101',
          roomType: 'Debug Room'
        }
      }

      const testRoom = {
        roomNumber: 'DEBUG-101',
        roomType: 'Debug Room'
      }

      const invoiceData = createInvoiceData(testBooking, testRoom)
      const htmlContent = await generateInvoiceHTML(invoiceData)
      
      const htmlCheck = {
        test: 'html_generation',
        success: true,
        details: {
          htmlLength: htmlContent.length,
          containsInvoiceNumber: htmlContent.includes(invoiceData.invoiceNumber),
          containsGuestName: htmlContent.includes(invoiceData.guest.name),
          containsTotal: htmlContent.includes(invoiceData.charges.total.toString())
        }
      }
      debugResults.tests.push(htmlCheck)
      console.log('✅ [InvoiceDebug] HTML generated:', htmlCheck.details)
    } catch (error: any) {
      const htmlCheck = {
        test: 'html_generation',
        success: false,
        error: error.message
      }
      debugResults.tests.push(htmlCheck)
      debugResults.errors.push(`HTML generation error: ${error.message}`)
      debugResults.overallSuccess = false
      console.error('❌ [InvoiceDebug] HTML generation error:', error)
    }

    // Test 4: Test email sending (with a test email)
    console.log('🔍 [InvoiceDebug] Test 4: Testing email sending...')
    try {
      const testBooking = {
        id: 'debug-test-booking-123',
        guestId: 'debug-guest-123',
        roomId: 'debug-room-123',
        checkIn: '2024-01-01T00:00:00Z',
        checkOut: '2024-01-03T00:00:00Z',
        status: 'checked-out',
        totalPrice: 200,
        numGuests: 2,
        actualCheckOut: '2024-01-03T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        guest: {
          name: 'Debug Test Guest',
          email: 'debug@test.com',
          phone: '+1234567890',
          address: '123 Debug St'
        },
        room: {
          roomNumber: 'DEBUG-101',
          roomType: 'Debug Room'
        }
      }

      const testRoom = {
        roomNumber: 'DEBUG-101',
        roomType: 'Debug Room'
      }

      const invoiceData = createInvoiceData(testBooking, testRoom)
      const htmlContent = await generateInvoiceHTML(invoiceData)
      
      // Test email sending
      const emailResult = await sendTransactionalEmail({
        to: 'debug@test.com',
        subject: `🔍 Debug Test Invoice - ${invoiceData.invoiceNumber}`,
        html: htmlContent,
        text: `Debug test invoice for ${invoiceData.guest.name}. Total: $${invoiceData.charges.total}`
      })

      const emailCheck = {
        test: 'email_sending',
        success: emailResult.success,
        details: {
          emailSent: emailResult.success,
          error: emailResult.error
        }
      }
      debugResults.tests.push(emailCheck)
      if (emailResult.success) {
        console.log('✅ [InvoiceDebug] Email sent')
      } else {
        throw new Error(emailResult.error || 'Unknown email failure')
      }
    } catch (error: any) {
      const emailCheck = {
        test: 'email_sending',
        success: false,
        error: error.message,
        details: {
          errorType: error.name,
          errorMessage: error.message,
          errorStack: error.stack
        }
      }
      debugResults.tests.push(emailCheck)
      debugResults.errors.push(`Email sending error: ${error.message}`)
      debugResults.overallSuccess = false
      console.error('❌ [InvoiceDebug] Email sending error:', error)
    }

    console.log('🔍 [InvoiceDebug] Debug complete. Overall success:', debugResults.overallSuccess)
    console.log('🔍 [InvoiceDebug] Debug results:', debugResults)

    return {
      success: debugResults.overallSuccess,
      details: debugResults,
      error: debugResults.errors.length > 0 ? debugResults.errors.join('; ') : undefined
    }

  } catch (error: any) {
    console.error('❌ [InvoiceDebug] Debug system failed:', error)
    return {
      success: false,
      details: { error: error.message, stack: error.stack },
      error: error.message
    }
  }
}

export function createInvoiceData(booking: BookingWithDetails, roomDetails: any): InvoiceData {
  const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  const invoiceDate = new Date().toISOString()
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
  
  const checkInDate = new Date(booking.checkIn)
  const checkOutDate = new Date(booking.actualCheckOut || booking.checkOut)
  const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24))
  
  const roomRate = booking.totalPrice / nights
  const subtotal = booking.totalPrice
  const taxRate = 0.10 // 10% tax rate
  const taxAmount = subtotal * taxRate
  const total = subtotal + taxAmount

  return {
    invoiceNumber,
    invoiceDate,
    dueDate,
    guest: {
      name: booking.guest?.name || 'Guest',
      email: booking.guest?.email || '',
      phone: booking.guest?.phone,
      address: booking.guest?.address
    },
    booking: {
      id: booking.id,
      roomNumber: roomDetails?.roomNumber || 'N/A',
      roomType: roomDetails?.roomType || 'Standard Room',
      checkIn: booking.checkIn,
      checkOut: booking.actualCheckOut || booking.checkOut,
      nights,
      numGuests: booking.numGuests
    },
    charges: {
      roomRate,
      nights,
      subtotal,
      taxRate,
      taxAmount,
      total
    },
    hotel: {
      name: 'AMP Lodge',
      address: '123 Hotel Street, City, State 12345',
      phone: '+1 (555) 123-4567',
      email: 'info@amplodge.com',
      website: 'https://amplodge.com'
    }
  }
}

export async function generateInvoiceHTML(invoiceData: InvoiceData): Promise<string> {
  try {
    console.log('📄 [InvoiceHTML] Generating invoice HTML...', {
      invoiceNumber: invoiceData.invoiceNumber,
      guestName: invoiceData.guest.name,
      total: invoiceData.charges.total
    })

    // Create HTML content for the invoice
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice ${invoiceData.invoiceNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background: #fff; }
          .invoice-container { max-width: 800px; margin: 0 auto; padding: 40px; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 3px solid #2563eb; padding-bottom: 20px; }
          .hotel-info h1 { color: #2563eb; font-size: 32px; font-weight: bold; margin-bottom: 10px; }
          .hotel-info p { color: #666; font-size: 14px; margin: 2px 0; }
          .invoice-meta { text-align: right; }
          .invoice-meta h2 { color: #2563eb; font-size: 24px; margin-bottom: 10px; }
          .invoice-meta p { color: #666; font-size: 14px; margin: 2px 0; }
          .invoice-details { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px; }
          .bill-to, .invoice-info { background: #f8fafc; padding: 20px; border-radius: 8px; }
          .bill-to h3, .invoice-info h3 { color: #2563eb; font-size: 18px; margin-bottom: 15px; font-weight: bold; }
          .bill-to p, .invoice-info p { color: #555; font-size: 14px; margin: 5px 0; }
          .charges-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          .charges-table th { background: #2563eb; color: white; padding: 15px; text-align: left; font-weight: bold; }
          .charges-table td { padding: 15px; border-bottom: 1px solid #e5e7eb; }
          .charges-table tr:nth-child(even) { background: #f9fafb; }
          .charges-table .text-right { text-align: right; }
          .charges-table .text-center { text-align: center; }
          .totals { display: flex; justify-content: flex-end; margin-bottom: 40px; }
          .totals-table { width: 300px; }
          .totals-table td { padding: 10px 15px; border-bottom: 1px solid #e5e7eb; }
          .totals-table .total-row { background: #2563eb; color: white; font-weight: bold; font-size: 18px; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; text-align: center; color: #666; font-size: 14px; }
          .footer p { margin: 5px 0; }
          .thank-you { background: #f0f9ff; padding: 20px; border-radius: 8px; text-align: center; margin-top: 30px; }
          .thank-you h3 { color: #2563eb; font-size: 20px; margin-bottom: 10px; }
          .thank-you p { color: #555; font-size: 16px; }
          @media print { .invoice-container { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <!-- Header -->
          <div class="header">
            <div class="hotel-info">
              <h1>AMP Lodge</h1>
              <p>${invoiceData.hotel.address}</p>
              <p>Phone: ${invoiceData.hotel.phone}</p>
              <p>Email: ${invoiceData.hotel.email}</p>
              <p>Website: ${invoiceData.hotel.website}</p>
            </div>
            <div class="invoice-meta">
              <h2>INVOICE</h2>
              <p><strong>Invoice #:</strong> ${invoiceData.invoiceNumber}</p>
              <p><strong>Date:</strong> ${new Date(invoiceData.invoiceDate).toLocaleDateString()}</p>
              <p><strong>Due Date:</strong> ${new Date(invoiceData.dueDate).toLocaleDateString()}</p>
            </div>
          </div>

          <!-- Invoice Details -->
          <div class="invoice-details">
            <div class="bill-to">
              <h3>Bill To:</h3>
              <p><strong>${invoiceData.guest.name}</strong></p>
              ${invoiceData.guest.email ? `<p>${invoiceData.guest.email}</p>` : ''}
              ${invoiceData.guest.phone ? `<p>Phone: ${invoiceData.guest.phone}</p>` : ''}
              ${invoiceData.guest.address ? `<p>${invoiceData.guest.address}</p>` : ''}
            </div>
            <div class="invoice-info">
              <h3>Booking Details:</h3>
              <p><strong>Booking ID:</strong> ${invoiceData.booking.id}</p>
              <p><strong>Room:</strong> ${invoiceData.booking.roomNumber} (${invoiceData.booking.roomType})</p>
              <p><strong>Check-in:</strong> ${new Date(invoiceData.booking.checkIn).toLocaleDateString()}</p>
              <p><strong>Check-out:</strong> ${new Date(invoiceData.booking.checkOut).toLocaleDateString()}</p>
              <p><strong>Nights:</strong> ${invoiceData.booking.nights}</p>
              <p><strong>Guests:</strong> ${invoiceData.booking.numGuests}</p>
            </div>
          </div>

          <!-- Charges Table -->
          <table class="charges-table">
            <thead>
              <tr>
                <th>Description</th>
                <th class="text-center">Nights</th>
                <th class="text-right">Rate</th>
                <th class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Room ${invoiceData.booking.roomNumber} - ${invoiceData.booking.roomType}</td>
                <td class="text-center">${invoiceData.charges.nights}</td>
                <td class="text-right">$${invoiceData.charges.roomRate.toFixed(2)}</td>
                <td class="text-right">$${invoiceData.charges.subtotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <!-- Totals -->
          <div class="totals">
            <table class="totals-table">
              <tr>
                <td>Subtotal:</td>
                <td class="text-right">$${invoiceData.charges.subtotal.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Tax (${(invoiceData.charges.taxRate * 100).toFixed(1)}%):</td>
                <td class="text-right">$${invoiceData.charges.taxAmount.toFixed(2)}</td>
              </tr>
              <tr class="total-row">
                <td>Total:</td>
                <td class="text-right">$${invoiceData.charges.total.toFixed(2)}</td>
              </tr>
            </table>
          </div>

          <!-- Thank You Message -->
          <div class="thank-you">
            <h3>Thank You for Staying with AMP Lodge!</h3>
            <p>We hope you enjoyed your stay and look forward to welcoming you back soon.</p>
          </div>

          <!-- Footer -->
          <div class="footer">
            <p><strong>AMP Lodge Hotel Management System</strong></p>
            <p>This invoice was generated automatically upon checkout</p>
            <p>For any questions regarding this invoice, please contact us at ${invoiceData.hotel.email}</p>
          </div>
        </div>
      </body>
      </html>
    `

    console.log('✅ [InvoiceHTML] HTML content generated successfully')
    return htmlContent

  } catch (error: any) {
    console.error('❌ [InvoiceHTML] Failed to generate HTML:', error)
    throw new Error(`Failed to generate invoice HTML: ${error.message}`)
  }
}
