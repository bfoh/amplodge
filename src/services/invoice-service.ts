import { hotelSettingsService } from './hotel-settings'
import { bookingChargesService } from './booking-charges-service'
import { BookingCharge } from '@/types'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { sendTransactionalEmail } from '@/services/email-service'
import { formatCurrencySync } from '@/lib/utils'

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
    additionalCharges: BookingCharge[]
    additionalChargesTotal: number
    discount: { type: 'percentage' | 'fixed', value: number, amount: number } | undefined
    discountTotal: number
    // Ghana Tax Breakdown (back-calculated from Grand Total)
    salesTotal: number      // Base amount before taxes
    gfNhil: number          // GF/NHIL (5%)
    taxSubTotal: number     // Sales Total + GF/NHIL
    vat: number             // VAT (15%)
    tourismLevy: number     // Tourism Levy (1%)
    total: number           // Grand total
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
  amountPaid?: number
  paymentStatus?: 'full' | 'part' | 'pending'
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

export async function createInvoiceData(booking: BookingWithDetails, roomDetails: any): Promise<InvoiceData> {
  console.log('📊 [InvoiceData] Creating invoice data with real hotel information...')

  try {
    // Get real hotel settings from database
    const hotelSettings = await hotelSettingsService.getHotelSettings()

    // Fetch additional charges for this booking
    const additionalCharges = await bookingChargesService.getChargesForBooking(booking.id)
    const additionalChargesTotal = additionalCharges.reduce((sum, c) => sum + (c.amount || 0), 0)

    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    const invoiceDate = new Date().toISOString()
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now

    // Validate and parse dates safely
    const checkInDate = new Date(booking.checkIn)
    const checkOutDate = new Date(booking.actualCheckOut || booking.checkOut)

    // Check if dates are valid
    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      throw new Error('Invalid date values in booking data')
    }

    // Normalize to midnight UTC for consistent night calculation
    const d1 = new Date(Date.UTC(checkInDate.getFullYear(), checkInDate.getMonth(), checkInDate.getDate()))
    const d2 = new Date(Date.UTC(checkOutDate.getFullYear(), checkOutDate.getMonth(), checkOutDate.getDate()))

    const nights = Math.max(1, Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)))

    // Validate nights calculation
    if (nights < 0) {
      throw new Error('Check-out date cannot be before check-in date')
    }

    // Parse specialRequests for discount data
    let discount: { type: 'percentage' | 'fixed', value: number, amount: number } | undefined
    let discountAmount = 0

    if (booking.specialRequests && booking.specialRequests.includes('<!-- GROUP_DATA:')) {
      try {
        const jsonMatch = booking.specialRequests.match(/<!-- GROUP_DATA:(.*?) -->/)
        if (jsonMatch && jsonMatch[1]) {
          const groupData = JSON.parse(jsonMatch[1])
          if (groupData.discount) {
            discount = groupData.discount
            discountAmount = discount.amount
          }
        }
      } catch (e) {
        console.error('Failed to parse booking metadata for discount:', e)
      }
    }

    // Fallback: Check for direct discountAmount column (used by single booking check-in)
    if (discountAmount === 0 && (booking as any).discountAmount) {
      discountAmount = Number((booking as any).discountAmount) || 0
      if (discountAmount > 0) {
        discount = {
          type: 'fixed',
          value: discountAmount,
          amount: discountAmount
        }
      }
    }

    // Room price from booking (already tax inclusive)
    const roomTotal = booking.totalPrice

    // Grand total calculation
    // Grand Total = Room Total + Additional Charges - Discount
    const grandTotal = Math.max(0, roomTotal + additionalChargesTotal - discountAmount)

    // Calculate Tax Breakdown
    const taxBreakdown = calculateGhanaTaxBreakdown(grandTotal)

    // Room rate per night (Gross)
    const roomRate = roomTotal / nights

    console.log('✅ [InvoiceData] Invoice data created with charges:', {
      hotelName: hotelSettings.name,
      invoiceNumber,
      nights,
      roomTotal,
      additionalChargesTotal,
      discountAmount,
      grandTotal
    })

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
        subtotal: roomTotal, // Use roomTotal as the base subtotal line item
        additionalCharges,
        additionalChargesTotal,
        discount,
        discountTotal: discountAmount,
        // Ghana Tax Breakdown
        salesTotal: taxBreakdown.salesTotal,
        gfNhil: taxBreakdown.gfNhil,
        taxSubTotal: taxBreakdown.subTotal,
        vat: taxBreakdown.vat,
        tourismLevy: taxBreakdown.tourismLevy,
        total: grandTotal
      },
      hotel: {
        name: hotelSettings.name,
        address: hotelSettings.address,
        phone: hotelSettings.phone,
        email: hotelSettings.email,
        website: hotelSettings.website
      }
    }
  } catch (error: any) {
    console.error('❌ [InvoiceData] Failed to create invoice data:', error)
    throw new Error(`Failed to create invoice data: ${error.message}`)
  }
}

export async function generateInvoiceHTML(invoiceData: InvoiceData): Promise<string> {
  try {
    console.log('📄 [InvoiceHTML] Generating invoice HTML...', {
      invoiceNumber: invoiceData.invoiceNumber,
      guestName: invoiceData.guest.name,
      total: invoiceData.charges.total
    })

    // Get currency for formatting
    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice ${invoiceData.invoiceNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.5; color: #333; background: #fff; font-size: 12px; }
          .invoice-container { max-width: 800px; margin: 0 auto; padding: 20px 30px; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; border-bottom: 3px solid #8B4513; padding-bottom: 10px; }
          .hotel-info h1 { color: #8B4513; font-size: 28px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.5px; }
          .hotel-info p { color: #555; font-size: 11px; margin: 2px 0; }
          .hotel-info .tin { color: #333; font-size: 11px; font-weight: 600; margin-top: 5px; }
          .invoice-meta { text-align: right; }
          .invoice-meta h2 { color: #8B4513; font-size: 20px; font-weight: 700; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
          .invoice-meta p { color: #555; font-size: 11px; margin: 3px 0; }
          .invoice-meta p strong { color: #333; }
          .invoice-details { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
          .bill-to, .invoice-info { background: linear-gradient(135deg, #F5F1E8 0%, #EDE7DA 100%); padding: 18px; border-radius: 8px; border-left: 4px solid #8B4513; }
          .bill-to h3, .invoice-info h3 { color: #8B4513; font-size: 13px; margin-bottom: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
          .bill-to p, .invoice-info p { color: #555; font-size: 11px; margin: 3px 0; }
          .charges-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px; }
          .charges-table th { background: linear-gradient(135deg, #8B4513 0%, #A0522D 100%); color: white; padding: 10px 8px; text-align: left; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-size: 10px; }
          .charges-table td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; }
          .charges-table tr:nth-child(even) { background: #f9fafb; }
          .charges-table tr:hover { background-color: #faf8f5; }
          .charges-table .text-right { text-align: right; }
          .charges-table .text-center { text-align: center; }
          .totals { display: flex; justify-content: flex-end; margin-bottom: 15px; margin-top: 10px; }
          .totals-table { width: 280px; font-size: 11px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
          .totals-table td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
          .totals-table tr:last-child td { border-bottom: none; }
          .totals-table .total-row { background: linear-gradient(135deg, #8B4513 0%, #A0522D 100%); color: white; font-weight: 700; font-size: 13px; }
          .totals-table .total-row td { padding: 12px; }
          .footer { margin-top: 15px; padding-top: 10px; border-top: 2px solid #e5e7eb; text-align: center; color: #888; font-size: 10px; }
          .footer p { margin: 3px 0; }
          .thank-you { background: linear-gradient(135deg, #F5F1E8 0%, #EDE7DA 100%); padding: 18px; border-radius: 8px; text-align: center; margin-top: 20px; }
          .thank-you h3 { color: #8B4513; font-size: 14px; margin-bottom: 5px; font-weight: 700; }
          .thank-you p { color: #555; font-size: 11px; }
          @media print { 
            .invoice-container { padding: 10px 20px; } 
            body { -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <!-- Header -->
          <div class="header">
            <div class="hotel-info">
              <h1>${invoiceData.hotel.name}</h1>
              <p>${invoiceData.hotel.address}</p>
              <p>Phone: ${invoiceData.hotel.phone}</p>
              <p>Email: ${invoiceData.hotel.email}</p>
              <p>Website: ${invoiceData.hotel.website}</p>
              <p class="tin">TIN: 71786161-3</p>
            </div>
            <div class="invoice-meta">
              <h2>${invoiceData.invoiceNumber.startsWith('PRE-') ? 'Pre-Invoice' : 'Invoice'}</h2>
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
                <th class="text-center">Qty</th>
                <th class="text-right">Rate</th>
                <th class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Room ${invoiceData.booking.roomNumber} - ${invoiceData.booking.roomType}</td>
                <td class="text-center">${invoiceData.charges.nights} nights</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.roomRate, currency)}/night</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.roomRate * invoiceData.charges.nights, currency)}</td>
              </tr>
              ${invoiceData.charges.additionalCharges.map(charge => `
              <tr>
                <td>Additional Charge (${charge.description})</td>
                <td class="text-center">${charge.quantity}</td>
                <td class="text-right">${formatCurrencySync(charge.unitPrice, currency)}</td>
                <td class="text-right">${formatCurrencySync(charge.amount, currency)}</td>
              </tr>
              `).join('')}
            </tbody>
          </table>

          <!-- Totals -->
          <div class="totals">
            <table class="totals-table">
              ${invoiceData.charges.discountTotal > 0 ? `
              <tr style="color: #dc2626;">
                <td>Discount ${invoiceData.charges.discount?.type === 'percentage' ? `(${invoiceData.charges.discount.value}%)` : ''}</td>
                <td class="text-right">- ${formatCurrencySync(invoiceData.charges.discountTotal, currency)}</td>
              </tr>
              ` : ''}
              <tr style="border-top: 2px solid #8B4513; background: #faf8f5;">
                <td colspan="2" style="padding: 8px 12px; font-size: 10px; color: #666; text-transform: uppercase;">Tax Breakdown</td>
              </tr>
              <tr>
                <td>Sales Total</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.salesTotal, currency)}</td>
              </tr>
              <tr>
                <td>GF/NHIL (5%)</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.gfNhil, currency)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #ddd;">
                <td><strong>Sub Total</strong></td>
                <td class="text-right"><strong>${formatCurrencySync(invoiceData.charges.taxSubTotal, currency)}</strong></td>
              </tr>
              <tr>
                <td>VAT (15%)</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.vat, currency)}</td>
              </tr>
              <tr>
                <td>Tourism Levy (1%)</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.tourismLevy, currency)}</td>
              </tr>
              <tr class="total-row">
                <td>Grand Total</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.total, currency)}</td>
              </tr>
            </table>
          </div>

          <!-- Footer -->
          <div class="footer" style="margin-top: 10px;">
            <div style="background: #F5F1E8; padding: 6px 15px; border-radius: 6px; text-align: center; margin-bottom: 8px;">
              <p style="font-size: 12px; color: #8B4513; font-weight: 600; margin: 0;">Thank you for choosing ${invoiceData.hotel.name}!</p>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 9px; color: #888;">
              <div>
                <p style="margin: 2px 0;"><strong>Payment Terms:</strong> Due upon receipt</p>
                <p style="margin: 2px 0;"><strong>Payment Methods:</strong> Cash, Mobile Money, Bank Transfer</p>
              </div>
              <div style="text-align: right;">
                <p style="margin: 2px 0;">${invoiceData.hotel.phone} | ${invoiceData.hotel.email}</p>
                <p style="margin: 2px 0;">TIN: 71786161-3</p>
              </div>
            </div>
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

export async function generateInvoicePDF(invoiceData: InvoiceData): Promise<Blob> {
  try {
    console.log('📄 [InvoicePDF] Generating PDF...', {
      invoiceNumber: invoiceData.invoiceNumber,
      guestName: invoiceData.guest.name
    })

    // Generate HTML content
    const htmlContent = await generateInvoiceHTML(invoiceData)

    // Create a temporary element to render the HTML
    const element = document.createElement('div')
    element.innerHTML = htmlContent
    element.style.position = 'absolute'
    element.style.left = '-9999px'
    element.style.top = '0'
    document.body.appendChild(element)

    // Convert HTML to canvas
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff'
    })

    // Remove the temporary element
    document.body.removeChild(element)

    // Create PDF
    // Use JPEG with quality 0.95 to reduce file size while maintaining good quality
    // PNG can produce very large files (3-5MB+) which hits Netlify function payload limits (6MB)
    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    })

    const imgWidth = 210 // A4 width in mm
    const pageHeight = 295 // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    let heightLeft = imgHeight

    let position = 0

    // Add image to PDF
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    // Add new pages if needed
    while (heightLeft >= 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    console.log('✅ [InvoicePDF] PDF generated successfully')
    return pdf.output('blob')

  } catch (error: any) {
    console.error('❌ [InvoicePDF] Failed to generate PDF:', error)
    throw new Error(`Failed to generate invoice PDF: ${error.message}`)
  }
}

export async function sendInvoiceEmail(invoiceData: InvoiceData, pdfBlob: Blob): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('📧 [InvoiceEmail] Sending invoice email...', {
      invoiceNumber: invoiceData.invoiceNumber,
      guestEmail: invoiceData.guest.email,
      total: invoiceData.charges.total
    })

    // Get currency for formatting
    const { hotelSettingsService } = await import('@/services/hotel-settings')
    const { formatCurrencySync } = await import('@/lib/utils')
    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

    // Convert PDF blob to base64 for email attachment
    const pdfBase64 = await blobToBase64(pdfBlob)
    const downloadUrl = `${window.location.origin}/invoice/${invoiceData.invoiceNumber}`

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Invoice - AMP Lodge</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #8B4513 0%, #7a3d11 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; margin: -20px -20px 30px -20px; }
          .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 16px; }
          .invoice-summary { background: #F5F1E8; border: 2px solid #E5E1D8; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .invoice-summary h2 { color: #8B4513; font-size: 20px; margin-bottom: 15px; }
          .summary-row { display: flex; justify-content: space-between; margin: 8px 0; padding: 5px 0; border-bottom: 1px solid #E5E1D8; }
          .summary-row:last-child { border-bottom: none; font-weight: bold; color: #8B4513; }
          .summary-label { color: #555; }
          .summary-value { color: #333; font-weight: 500; }
          .download-section { background: #F5F1E8; border: 1px solid #8B4513; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
          .download-section h3 { color: #5c3616; margin: 0 0 15px 0; font-size: 18px; }
          .download-btn { background: #8B4513; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; margin: 10px; }
          .download-btn:hover { background: #7a3d11; }
          .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; color: #6c757d; font-size: 14px; }
          .footer p { margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">
              <img src="/amp.png" alt="AMP LODGE" style="height: 30px; width: auto; max-width: 100px; margin-right: 10px;" />
              <h1 style="margin: 0;">Invoice Ready</h1>
            </div>
            <p>${invoiceData.hotel.name} Hotel Management System</p>
          </div>
          
          <p>Dear ${invoiceData.guest.name},</p>
          
          <p>Thank you for staying with ${invoiceData.hotel.name}! Your invoice for your recent stay is ready.</p>
          
          <div class="invoice-summary">
            <h2>Invoice Summary</h2>
            <div class="summary-row">
              <span class="summary-label">Invoice Number:</span>
              <span class="summary-value">${invoiceData.invoiceNumber}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Room:</span>
              <span class="summary-value">${invoiceData.booking.roomNumber} (${invoiceData.booking.roomType})</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Check-in:</span>
              <span class="summary-value">${new Date(invoiceData.booking.checkIn).toLocaleDateString()}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Check-out:</span>
              <span class="summary-value">${new Date(invoiceData.booking.checkOut).toLocaleDateString()}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Nights:</span>
              <span class="summary-value">${invoiceData.booking.nights}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Total Amount:</span>
              <span class="summary-value">${formatCurrencySync(invoiceData.charges.total, currency)}</span>
            </div>
          </div>
          
          <div class="download-section">
            <h3>📄 Download Your Invoice</h3>
            <p>Your detailed invoice is available for download:</p>
            <a href="${downloadUrl}" class="download-btn">View & Download Invoice</a>
            <p style="margin-top: 15px; font-size: 14px; color: #666;">
              You can also print this invoice for your records.
            </p>
          </div>
          
          <p>If you have any questions about this invoice or need assistance, please don't hesitate to contact us.</p>
          
          <p>We hope you enjoyed your stay and look forward to welcoming you back to ${invoiceData.hotel.name} soon!</p>
          
          <div class="footer">
            <p><strong>${invoiceData.hotel.name} Hotel Management System</strong></p>
            <p>Phone: ${invoiceData.hotel.phone} | Email: ${invoiceData.hotel.email}</p>
            <p>Website: ${invoiceData.hotel.website}</p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
INVOICE READY - ${invoiceData.hotel.name} Hotel Management System

Dear ${invoiceData.guest.name},

Thank you for staying with ${invoiceData.hotel.name}! Your invoice for your recent stay is ready.

INVOICE SUMMARY:
Invoice Number: ${invoiceData.invoiceNumber}
Room: ${invoiceData.booking.roomNumber} (${invoiceData.booking.roomType})
Check-in: ${new Date(invoiceData.booking.checkIn).toLocaleDateString()}
Check-out: ${new Date(invoiceData.booking.checkOut).toLocaleDateString()}
Nights: ${invoiceData.booking.nights}
Total Amount: ${formatCurrencySync(invoiceData.charges.total, currency)}

DOWNLOAD YOUR INVOICE:
Your detailed invoice is available for download at:
${downloadUrl}

You can also print this invoice for your records.

If you have any questions about this invoice or need assistance, please don't hesitate to contact us.

We hope you enjoyed your stay and look forward to welcoming you back to ${invoiceData.hotel.name} soon!

---
${invoiceData.hotel.name} Hotel Management System
Phone: ${invoiceData.hotel.phone} | Email: ${invoiceData.hotel.email}
Website: ${invoiceData.hotel.website}
    `

    const result = await sendTransactionalEmail({
      to: invoiceData.guest.email,
      subject: `Your Invoice - ${invoiceData.invoiceNumber} | ${invoiceData.hotel.name}`,
      html: htmlContent,
      text: textContent,
      attachments: [
        {
          filename: `invoice-${invoiceData.invoiceNumber}.pdf`,
          content: pdfBase64,
          contentType: 'application/pdf'
        }
      ]
    })

    if (result.success) {
      console.log('✅ [InvoiceEmail] Email sent successfully')
      return { success: true }
    }

    console.error('❌ [InvoiceEmail] Email send reported failure:', result.error)
    return { success: false, error: result.error }
  } catch (error: any) {
    console.error('❌ [InvoiceEmail] Failed to send email:', error)
    return { success: false, error: error.message }
  }
}

// Helper function to convert blob to base64
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Staff functions for downloading/printing invoices
export async function downloadInvoicePDF(invoiceData: InvoiceData): Promise<void> {
  try {
    console.log('📥 [StaffDownload] Generating PDF for download...', {
      invoiceNumber: invoiceData.invoiceNumber,
      guestName: invoiceData.guest.name
    })

    const pdfBlob = await generateInvoicePDF(invoiceData)

    // Create download link
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoice-${invoiceData.invoiceNumber}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    console.log('✅ [StaffDownload] PDF downloaded successfully')
  } catch (error: any) {
    console.error('❌ [StaffDownload] Failed to download PDF:', error)
    // Don't throw error if download actually worked
    if (error.message && error.message.includes('download')) {
      console.log('📥 [StaffDownload] Download may have succeeded despite error')
      return
    }
    throw new Error(`Failed to download invoice PDF: ${error.message}`)
  }
}

export async function printInvoice(invoiceData: InvoiceData): Promise<void> {
  try {
    console.log('🖨️ [StaffPrint] Generating invoice for printing...', {
      invoiceNumber: invoiceData.invoiceNumber,
      guestName: invoiceData.guest.name
    })

    const htmlContent = await generateInvoiceHTML(invoiceData)

    // Open print window
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(htmlContent)
      printWindow.document.close()
      printWindow.print()
    } else {
      throw new Error('Could not open print window. Please allow pop-ups.')
    }

    console.log('✅ [StaffPrint] Invoice printed successfully')
  } catch (error: any) {
    console.error('❌ [StaffPrint] Failed to print invoice:', error)
    throw new Error(`Failed to print invoice: ${error.message}`)
  }
}

/**
 * Print a pre-invoice using the same template as the downloaded pre-invoice PDF
 */
export async function printPreInvoice(preInvoiceData: PreInvoiceData): Promise<void> {
  try {
    console.log('🖨️ [StaffPrint] Generating pre-invoice for printing...', {
      invoiceNumber: preInvoiceData.invoiceNumber,
      guestName: preInvoiceData.guest.name,
      paymentStatus: preInvoiceData.paymentStatus
    })

    const htmlContent = await generatePreInvoiceHTML(preInvoiceData)

    // Open print window
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(htmlContent)
      printWindow.document.close()
      // Small delay so styles render before printing
      setTimeout(() => printWindow.print(), 300)
    } else {
      throw new Error('Could not open print window. Please allow pop-ups.')
    }

    console.log('✅ [StaffPrint] Pre-invoice printed successfully')
  } catch (error: any) {
    console.error('❌ [StaffPrint] Failed to print pre-invoice:', error)
    throw new Error(`Failed to print pre-invoice: ${error.message}`)
  }
}

// ===================== PRE-INVOICE FUNCTIONS =====================

export interface PreInvoiceData extends InvoiceData {
  status: 'pending' | 'paid' | 'partial'
  isPreInvoice: boolean
  amountPaid?: number
  paymentStatus?: 'full' | 'part' | 'pending'
}

/**
 * Create pre-invoice data for a confirmed booking (not yet paid)
 */
export async function createPreInvoiceData(booking: BookingWithDetails, roomDetails: any): Promise<PreInvoiceData> {
  console.log('📋 [PreInvoice] Creating pre-invoice data for booking:', booking.id)

  // Use the existing createInvoiceData function as base
  const invoiceData = await createInvoiceData(booking, roomDetails)

  // Extract payment tracking data from booking or specialRequests
  let amountPaid = booking.amountPaid || 0
  let paymentStatus: 'full' | 'part' | 'pending' = booking.paymentStatus || 'pending'
  if (!amountPaid && booking.specialRequests) {
    const pm = booking.specialRequests.match(/<!-- PAYMENT_DATA:(.*?) -->/)
    if (pm) {
      try {
        const pd = JSON.parse(pm[1])
        amountPaid = pd.amountPaid || 0
        paymentStatus = pd.paymentStatus || 'pending'
      } catch { /* ignore */ }
    }
  }

  // Determine status
  const status = paymentStatus === 'full' ? 'paid' as const
    : paymentStatus === 'part' ? 'partial' as const
      : 'pending' as const

  // Add pre-invoice specific fields
  return {
    ...invoiceData,
    invoiceNumber: `PRE-${invoiceData.invoiceNumber}`,
    status,
    isPreInvoice: true,
    amountPaid,
    paymentStatus
  }
}

/**
 * Generate HTML for a pre-invoice (with PRE-INVOICE header and UNPAID status)
 */
export async function generatePreInvoiceHTML(preInvoiceData: PreInvoiceData): Promise<string> {
  try {
    console.log('📄 [PreInvoiceHTML] Generating pre-invoice HTML...', {
      invoiceNumber: preInvoiceData.invoiceNumber,
      guestName: preInvoiceData.guest.name
    })

    const settings = await hotelSettingsService.getHotelSettings()
    const currency = settings.currency || 'GHS'

    const bannerBg = preInvoiceData.paymentStatus === 'full' ? '#16a34a,#15803d' : preInvoiceData.paymentStatus === 'part' ? '#d97706,#b45309' : '#f59e0b,#d97706'
    const accentColor = preInvoiceData.paymentStatus === 'full' ? '#16a34a' : preInvoiceData.paymentStatus === 'part' ? '#d97706' : '#f59e0b'
    const bannerText = preInvoiceData.paymentStatus === 'full' ? '✅ PRE-INVOICE — FULLY PAID' : preInvoiceData.paymentStatus === 'part' ? '💰 PART PAYMENT RECEIVED — BALANCE DUE AT CHECK-IN' : '⏳ PRE-INVOICE — PAYMENT DUE AT CHECK-IN'
    const badgeBg = preInvoiceData.paymentStatus === 'full' ? '#dcfce7; color: #166534; border: 1px solid #86efac' : '#fef3c7; color: #92400e; border: 1px solid #fcd34d'
    const badgeText = preInvoiceData.paymentStatus === 'full' ? '✅ PAID' : preInvoiceData.paymentStatus === 'part' ? '💰 PART PAID' : '⏳ UNPAID'
    const noticeBg = preInvoiceData.paymentStatus === 'full' ? '#f0fdf4; border-color: #16a34a' : preInvoiceData.paymentStatus === 'part' ? '#fffbeb; border-color: #d97706' : '#fffbeb; border-color: #f59e0b'
    const noticeHeadColor = preInvoiceData.paymentStatus === 'full' ? '#166534' : '#92400e'

    let paymentContent = ''
    if (preInvoiceData.paymentStatus === 'full') {
      paymentContent = `<p style="color:#166534;">Payment of <strong>${formatCurrencySync(preInvoiceData.charges.total, currency)}</strong> received in full. Thank you!</p>`
    } else if (preInvoiceData.paymentStatus === 'part') {
      const remaining = Math.max(0, preInvoiceData.charges.total - (preInvoiceData.amountPaid || 0))
      paymentContent = `
        <table style="width:100%;margin-top:5px;font-size:11px;">
          <tr><td style="color:#166534;">✅ Amount Paid</td><td style="text-align:right;font-weight:700;color:#166534;font-size:12px;">${formatCurrencySync(preInvoiceData.amountPaid || 0, currency)}</td></tr>
          <tr style="border-top:1px dashed #d97706;"><td style="color:#92400e;font-weight:700;">⏳ Remaining</td><td style="text-align:right;font-weight:800;color:#dc2626;font-size:14px;">${formatCurrencySync(remaining, currency)}</td></tr>
        </table>
        <p style="margin-top:5px;color:#78350f;font-size:9px;">Balance due at check-in. We accept <strong>Cash</strong>, <strong>Mobile Money</strong>, <strong>Bank Transfer</strong>.</p>`
    } else {
      paymentContent = `<p style="color:#78350f;">Full payment of <strong>${formatCurrencySync(preInvoiceData.charges.total, currency)}</strong> due upon check-in.</p><p style="color:#78350f;margin-top:2px;font-size:9px;">We accept <strong>Cash</strong>, <strong>Mobile Money</strong>, <strong>Bank Transfer</strong>.</p>`
    }

    const discountRow = preInvoiceData.charges.discountTotal > 0 ? `<tr style="color:#dc2626;"><td>Discount ${preInvoiceData.charges.discount?.type === 'percentage' ? `(${preInvoiceData.charges.discount.value}%)` : ''}</td><td style="text-align:right;">-${formatCurrencySync(preInvoiceData.charges.discountTotal, currency)}</td></tr>` : ''

    const additionalRows = preInvoiceData.charges.additionalCharges.map(ch => `<tr><td>${ch.description}</td><td style="text-align:center;">${ch.quantity}</td><td style="text-align:right;">${formatCurrencySync(ch.unitPrice, currency)}</td><td style="text-align:right;">${formatCurrencySync(ch.amount, currency)}</td></tr>`).join('')

    const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Pre-Invoice ${preInvoiceData.invoiceNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;line-height:1.3;color:#1a1a1a;background:#fff;font-size:11px}
.ic{max-width:800px;margin:0 auto;padding:0;background:#fff}
.banner{padding:8px 20px;text-align:center;font-weight:700;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#fff}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 24px 10px;border-bottom:2px solid #8B4513}
.hi h1{color:#8B4513;font-size:22px;font-weight:800;letter-spacing:-0.5px;margin-bottom:2px}
.hi p{color:#555;font-size:10px;margin:1px 0;line-height:1.3}
.hi .tin{font-weight:700;color:#333;margin-top:2px}
.im{text-align:right;min-width:220px}
.im .dt{font-size:18px;font-weight:800;letter-spacing:1px;margin-bottom:4px;text-transform:uppercase}
.im .mr{font-size:10px;color:#555;margin:2px 0}
.im .mr strong{color:#333}
.sb{display:inline-block;padding:3px 12px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:0.5px;margin-top:5px}
.ct{padding:0 24px 10px}
.dg{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0}
.dc{background:linear-gradient(135deg,#faf8f5,#f5f1e8);padding:10px 12px;border-radius:6px;border-left:3px solid #8B4513}
.dc h3{color:#8B4513;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid rgba(139,69,19,0.15)}
.dc p{color:#444;font-size:10.5px;margin:2px 0}
.dc p strong{color:#222}
.dc .gn{font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:1px}
.cht{width:100%;border-collapse:collapse;margin:12px 0 10px;font-size:11px}
.cht thead th{background:linear-gradient(135deg,#8B4513,#a0522d);color:#fff;padding:6px 10px;text-align:left;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px}
.cht thead th:last-child,.cht thead th:nth-child(3){text-align:right}
.cht thead th:nth-child(2){text-align:center}
.cht tbody td{padding:6px 10px;border-bottom:1px solid #eee}
.bs{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 10px;align-items:start}
.pn{border-radius:8px;padding:10px 12px;border:2px solid}
.pn h3{font-size:11px;margin-bottom:5px;font-weight:700}
.pn p{font-size:10px;line-height:1.4}
.tt{width:100%;font-size:11px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
.tt td{padding:4px 10px}
.tt tr{border-bottom:1px solid #f0f0f0}
.tt tr:last-child{border-bottom:none}
.tt .sh td{background:#faf8f5;font-size:9px;font-weight:600;color:#8B4513;text-transform:uppercase;letter-spacing:0.5px;padding:3px 10px}
.tt .sr td{font-weight:700;border-top:1px solid #ddd;border-bottom:1px solid #ddd}
.tt .gt td{font-weight:800;font-size:13px;padding:7px 10px}
.ft{background:linear-gradient(135deg,#faf8f5,#f5f1e8);padding:8px 24px;border-top:2px solid #8B4513}
.ft .ty{text-align:center;font-size:11px;font-weight:700;color:#8B4513;margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid rgba(139,69,19,0.15)}
.ft .fr{display:flex;justify-content:space-between;font-size:9px;color:#888}
.ft .fr p{margin:1px 0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><div class="ic">
<div class="banner" style="background:linear-gradient(135deg,${bannerBg})">${bannerText}</div>
<div class="header">
<div class="hi">
<h1>${preInvoiceData.hotel.name}</h1>
<p>${preInvoiceData.hotel.address}</p>
<p>${preInvoiceData.hotel.phone} | ${preInvoiceData.hotel.email}</p>
<p class="tin">TIN: 71786161-3</p>
</div>
<div class="im">
<div class="dt" style="color:${accentColor}">PRE-INVOICE</div>
<p class="mr"><strong>Invoice #:</strong> ${preInvoiceData.invoiceNumber}</p>
<p class="mr"><strong>Date:</strong> ${new Date(preInvoiceData.invoiceDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
<p class="mr"><strong>Due Date:</strong> At Check-in</p>
<span class="sb" style="background:${badgeBg}">${badgeText}</span>
</div>
</div>
<div class="ct">
<div class="dg">
<div class="dc">
<h3>Bill To</h3>
<p class="gn">${preInvoiceData.guest.name}</p>
${preInvoiceData.guest.email ? `<p>${preInvoiceData.guest.email}</p>` : ''}
${preInvoiceData.guest.phone ? `<p>📞 ${preInvoiceData.guest.phone}</p>` : ''}
${preInvoiceData.guest.address ? `<p>📍 ${preInvoiceData.guest.address}</p>` : ''}
</div>
<div class="dc">
<h3>Booking Details</h3>
<p><strong>Booking ID:</strong> ${preInvoiceData.booking.id}</p>
<p><strong>Room:</strong> ${preInvoiceData.booking.roomNumber} (${preInvoiceData.booking.roomType})</p>
<p><strong>Check-in:</strong> ${new Date(preInvoiceData.booking.checkIn).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
<p><strong>Check-out:</strong> ${new Date(preInvoiceData.booking.checkOut).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
<p><strong>Duration:</strong> ${preInvoiceData.booking.nights} night${preInvoiceData.booking.nights !== 1 ? 's' : ''} · ${preInvoiceData.booking.numGuests} guest${preInvoiceData.booking.numGuests !== 1 ? 's' : ''}</p>
</div>
</div>
<table class="cht">
<thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
<tbody>
<tr><td>Room ${preInvoiceData.booking.roomNumber} — ${preInvoiceData.booking.roomType}</td><td style="text-align:center">${preInvoiceData.charges.nights} night${preInvoiceData.charges.nights !== 1 ? 's' : ''}</td><td style="text-align:right">${formatCurrencySync(preInvoiceData.charges.roomRate, currency)}/night</td><td style="text-align:right"><strong>${formatCurrencySync(preInvoiceData.charges.subtotal, currency)}</strong></td></tr>
${additionalRows}
</tbody>
</table>
<div class="bs">
<div class="pn" style="background:${noticeBg}">
<h3 style="color:${noticeHeadColor}">💳 Payment Information</h3>
${paymentContent}
</div>
<table class="tt">
${discountRow}
<tr class="sh"><td colspan="2">Tax Breakdown</td></tr>
<tr><td>Sales Total</td><td style="text-align:right">${formatCurrencySync(preInvoiceData.charges.salesTotal, currency)}</td></tr>
<tr><td>GF/NHIL (5%)</td><td style="text-align:right">${formatCurrencySync(preInvoiceData.charges.gfNhil, currency)}</td></tr>
<tr class="sr"><td>Sub Total</td><td style="text-align:right">${formatCurrencySync(preInvoiceData.charges.taxSubTotal, currency)}</td></tr>
<tr><td>VAT (15%)</td><td style="text-align:right">${formatCurrencySync(preInvoiceData.charges.vat, currency)}</td></tr>
<tr><td>Tourism Levy (1%)</td><td style="text-align:right">${formatCurrencySync(preInvoiceData.charges.tourismLevy, currency)}</td></tr>
<tr class="gt" style="background:linear-gradient(135deg,${bannerBg});color:#fff"><td>Grand Total</td><td style="text-align:right">${formatCurrencySync(preInvoiceData.charges.total, currency)}</td></tr>
</table>
</div>
</div>
<div class="ft">
<div class="ty">Thank you for choosing ${preInvoiceData.hotel.name}!</div>
<div class="fr">
<div><p><strong>Payment Terms:</strong> Due upon receipt</p><p><strong>Payment Methods:</strong> Cash, Mobile Money, Bank Transfer</p></div>
<div style="text-align:right"><p>${preInvoiceData.hotel.phone} | ${preInvoiceData.hotel.email}</p><p>TIN: 71786161-3</p></div>
</div>
</div>
</div></body></html>`

    console.log('✅ [PreInvoiceHTML] Pre-invoice HTML generated successfully')
    return htmlContent
  } catch (error: any) {
    console.error('❌ [PreInvoiceHTML] Failed to generate pre-invoice HTML:', error)
    throw new Error(`Failed to generate pre-invoice HTML: ${error.message}`)
  }
}

/**
 * Generate and download pre-invoice PDF
 */
export async function downloadPreInvoicePDF(preInvoiceData: PreInvoiceData): Promise<void> {
  try {
    console.log('📥 [PreInvoicePDF] Generating pre-invoice PDF for download...', {
      invoiceNumber: preInvoiceData.invoiceNumber,
      guestName: preInvoiceData.guest.name
    })

    const htmlContent = await generatePreInvoiceHTML(preInvoiceData)

    // Create a temporary element to render the HTML
    const element = document.createElement('div')
    element.innerHTML = htmlContent
    element.style.position = 'absolute'
    element.style.left = '-9999px'
    element.style.top = '0'
    document.body.appendChild(element)

    // Convert HTML to canvas
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff'
    })

    // Remove the temporary element
    document.body.removeChild(element)

    // Create PDF
    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    })

    const imgWidth = 210
    const pageHeight = 295
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    let heightLeft = imgHeight

    let position = 0
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    // Download the PDF
    pdf.save(`pre - invoice - ${preInvoiceData.invoiceNumber}.pdf`)

    console.log('✅ [PreInvoicePDF] Pre-invoice PDF downloaded successfully')
  } catch (error: any) {
    console.error('❌ [PreInvoicePDF] Failed to download pre-invoice PDF:', error)
    throw new Error(`Failed to download pre - invoice PDF: ${error.message} `)
  }
}

// ===================== GHANA TAX CALCULATION =====================
// Tax structure: GF/NHIL (5%), VAT (15%), Tourism Levy (1%)
// Grand Total remains unchanged - we back-calculate components for display

interface GhanaTaxBreakdown {
  salesTotal: number      // Base amount before all taxes
  gfNhil: number          // Get Fund / National Health Insurance Levy (5%)
  subTotal: number        // Sales Total + GF/NHIL
  vat: number             // Value Added Tax (15% of Sub Total)
  tourismLevy: number     // Tourism Development Levy (1% of Sales Total)
  grandTotal: number      // Final total (unchanged input)
}

/**
 * Back-calculate Ghana tax components from a Grand Total.
 * The Grand Total is what the customer pays and never changes.
 * Formula: Grand Total = Sales Total × (1 + 0.05) × (1 + 0.15) + Sales Total × 0.01
 *        = Sales Total × (1.05 × 1.15 + 0.01)
 *        = Sales Total × 1.2175
 */
function calculateGhanaTaxBreakdown(grandTotal: number): GhanaTaxBreakdown {
  // Combined tax multiplier: (1 + GF/NHIL) × (1 + VAT) + Tourism
  // = 1.05 × 1.15 + 0.01 = 1.2075 + 0.01 = 1.2175
  const taxMultiplier = 1.2175

  const salesTotal = grandTotal / taxMultiplier
  const gfNhil = salesTotal * 0.05
  const subTotal = salesTotal + gfNhil
  const vat = subTotal * 0.15
  const tourismLevy = salesTotal * 0.01

  return {
    salesTotal: Math.round(salesTotal * 100) / 100,
    gfNhil: Math.round(gfNhil * 100) / 100,
    subTotal: Math.round(subTotal * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    tourismLevy: Math.round(tourismLevy * 100) / 100,
    grandTotal: grandTotal
  }
}

// ===================== GROUP INVOICE FUNCTIONS =====================

export interface GroupInvoiceData {
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  groupReference: string
  billingContact: {
    name: string
    email: string
    phone?: string
    address?: string
  }
  bookings: Array<{
    id: string
    guestName: string
    roomNumber: string
    roomType: string
    checkIn: string
    checkOut: string
    nights: number
    roomRate: number
    subtotal: number // This is total with tax for this line item
    additionalCharges: BookingCharge[]
    additionalChargesTotal: number
  }>
  summary: {
    totalRooms: number
    totalNights: number
    roomSubtotal: number // Room charges + per-room services (before group charges/discounts)
    additionalCharges?: { description: string, amount: number }[] // Charge details
    additionalChargesTotal: number
    discount: { type: 'percentage' | 'fixed', value: number, amount: number } | undefined
    discountTotal: number
    // Ghana Tax Breakdown (back-calculated from Grand Total)
    salesTotal: number      // Base amount before taxes
    gfNhil: number          // GF/NHIL (5%)
    taxSubTotal: number     // Sales Total + GF/NHIL
    vat: number             // VAT (15%)
    tourismLevy: number     // Tourism Levy (1%)
    total: number           // Grand total (unchanged)
  }
  hotel: {
    name: string
    address: string
    phone: string
    email: string
    website: string
  }
}

export async function createGroupInvoiceData(bookings: BookingWithDetails[], billingContact: any): Promise<GroupInvoiceData> {
  console.log('📊 [GroupInvoiceData] Creating group invoice data with real hotel information...')

  try {
    const hotelSettings = await hotelSettingsService.getHotelSettings()

    // Create new group invoice number if not exists, or reuse logic?
    // For now, generate a fresh one representing this aggregated view
    const invoiceNumber = `GRP - ${Date.now()} -${Math.random().toString(36).substring(2, 6).toUpperCase()} `
    const invoiceDate = new Date().toISOString()
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    // Group reference from first booking
    let groupReference = 'N/A'
    if (bookings.length > 0 && (bookings[0] as any).groupReference) {
      groupReference = (bookings[0] as any).groupReference
    }

    // Extract group-level billing metadata (Charges & Discounts)
    // This is stored on the FIRST booking (primary booking)
    // Note: We check both isPrimaryBooking (from our metadata) and fall back to first booking
    const primaryBooking = bookings.find(b => {
      // Check both camelCase (from our code) and snake_case (from DB)
      const specialReqField = (b as any).specialRequests || (b as any).special_requests
      if (!specialReqField) return false
      const match = specialReqField.match(/<!-- GROUP_DATA:(.*?) -->/)
      if (!match) return false
      try {
        const data = JSON.parse(match[1])
        return data.isPrimaryBooking === true
      } catch { return false }
    }) || bookings[0]

    let groupAdditionalCharges: { description: string, amount: number }[] = []
    let groupDiscount: { type: 'percentage' | 'fixed', value: number, amount: number } | undefined = undefined

    // Access special requests with fallback for snake_case (from Supabase)
    const specialReqContent = (primaryBooking as any).specialRequests || (primaryBooking as any).special_requests
    console.log('[GroupInvoice] Primary booking special requests length:', specialReqContent?.length || 0)

    if (primaryBooking && specialReqContent) {
      const match = specialReqContent.match(/<!-- GROUP_DATA:(.*?) -->/)
      if (match && match[1]) {
        try {
          const groupData = JSON.parse(match[1])
          console.log('[GroupInvoice] Parsed group data:', JSON.stringify(groupData))
          if (groupData.additionalCharges) groupAdditionalCharges = groupData.additionalCharges
          if (groupData.discount) groupDiscount = groupData.discount
        } catch (e) {
          console.warn('Failed to parse group data for invoice', e)
        }
      }
    }

    const groupChargesTotal = groupAdditionalCharges.reduce((sum, c) => sum + (c.amount || 0), 0)
    const discountAmount = groupDiscount?.amount || 0

    const processedBookings = await Promise.all(bookings.map(async (booking) => {
      // Get ADDITIONAL SERVICES (e.g. food, spa) per booking - distinct from "Booking Charges" added at reception?
      // NOTE: "bookingChargesService" returns charges linked to the booking (e.g. minibar)
      // The "Additional Charges" from reception (Breakfast x2) are stored in METADATA, not DB charges table yet?
      // Wait, standard logic uses `bookingChargesService`.
      // The reception logic ADDED them to `additionalCharges` in the booking helper, but did it save them?
      // In `createBooking`, we mapped `additionalCharges` to `specialRequests` metadata if it didn't exist in schema.
      // SO: We should NOT double count.
      // If we are looking at the Primary Booking, we don't want to double add charges if they were saved as "booking charges" vs "metadata".
      // Current implementation saves them ONLY in metadata (specialRequests).
      // So `bookingChargesService.getChargesForBooking` might return 0 if they weren't saved to `charges` table.

      const dbCharges = await bookingChargesService.getChargesForBooking(booking.id)
      const dbChargesTotal = dbCharges.reduce((sum, c) => sum + (c.amount || 0), 0)

      const checkIn = new Date(booking.checkIn)
      const checkOut = new Date(booking.actualCheckOut || booking.checkOut)
      const d1 = new Date(Date.UTC(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate()))
      const d2 = new Date(Date.UTC(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate()))
      const nights = Math.max(1, Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)))

      const taxRate = 0.17
      const roomTotal = booking.totalPrice // This is typically room rate * nights

      // Per-room calculations
      // We only include DB charges here. Group charges are added at the invoice level.
      const roomSubtotal = roomTotal - (roomTotal * taxRate)
      const roomRate = roomSubtotal / nights

      // Line total (Room + DB Charges)
      const lineTotal = roomTotal + dbChargesTotal

      return {
        id: booking.id,
        guestName: booking.guest?.name || 'Guest',
        roomNumber: booking.room?.roomNumber || 'N/A',
        roomType: booking.room?.roomType || 'Standard Room',
        checkIn: booking.checkIn,
        checkOut: booking.actualCheckOut || booking.checkOut,
        nights,
        roomRate,
        subtotal: lineTotal,
        additionalCharges: dbCharges,
        additionalChargesTotal: dbChargesTotal,
        _roomTotal: roomTotal
      }
    }))

    // Calculate Summary
    // Room prices from booking are the GROSS prices (what customer pays, already includes any tax)
    // The calculation should be: Room Total (incl. per-room services) + Group Charges - Discount = Grand Total

    // 1. Sum of all room LINE TOTALS (room price + per-room services like Breakfast, Jollof rice)
    // This uses 'subtotal' (which is lineTotal = roomTotal + dbChargesTotal)
    const totalRoomsCost = processedBookings.reduce((sum, b) => sum + b.subtotal, 0)

    // 2. Calculate Grand Total: Room Line Totals + Group Level Charges - Discount
    const grandTotal = Math.max(0, totalRoomsCost + groupChargesTotal - discountAmount)

    // 3. Calculate Ghana Tax Breakdown
    // The Grand Total is what customer pays - we back-calculate tax components for display
    const taxBreakdown = calculateGhanaTaxBreakdown(grandTotal)

    return {
      invoiceNumber,
      invoiceDate,
      dueDate,
      groupReference,
      billingContact: {
        name: billingContact?.fullName || billingContact?.name || 'Group Contact',
        email: billingContact?.email || '',
        phone: billingContact?.phone,
        address: billingContact?.address
      },
      bookings: processedBookings,
      summary: {
        totalRooms: bookings.length,
        totalNights: processedBookings.reduce((acc, b) => acc + b.nights, 0),
        roomSubtotal: totalRoomsCost, // Room total including per-room services
        additionalCharges: groupAdditionalCharges, // Array with descriptions
        additionalChargesTotal: groupChargesTotal,
        discount: groupDiscount,
        discountTotal: discountAmount,
        // Ghana Tax Breakdown
        salesTotal: taxBreakdown.salesTotal,
        gfNhil: taxBreakdown.gfNhil,
        taxSubTotal: taxBreakdown.subTotal,
        vat: taxBreakdown.vat,
        tourismLevy: taxBreakdown.tourismLevy,
        total: grandTotal
      },
      hotel: {
        name: hotelSettings.name,
        address: hotelSettings.address,
        phone: hotelSettings.phone,
        email: hotelSettings.email,
        website: hotelSettings.website
      }
    }

  } catch (error: any) {
    console.error('❌ [GroupInvoiceData] Failed to create group invoice data:', error)
    throw new Error(`Failed to create group invoice data: ${error.message} `)
  }
}

export async function generateGroupInvoiceHTML(data: GroupInvoiceData): Promise<string> {
  const { formatCurrencySync } = await import('@/lib/utils')
  const settings = await hotelSettingsService.getHotelSettings()
  const currency = settings.currency || 'GHS'

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Group Invoice ${data.invoiceNumber}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.3; color: #333; background: #fff; font-size: 11px; }
      .invoice-container { max-width: 800px; margin: 0 auto; padding: 20px 30px; background: #fff; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; border-bottom: 2px solid #8B4513; padding-bottom: 10px; }
      .hotel-info h1 { color: #8B4513; font-size: 24px; font-weight: 700; margin-bottom: 4px; letter-spacing: -0.5px; }
      .hotel-info p { color: #555; font-size: 10px; margin: 1px 0; }
      .hotel-info .tin { color: #333; font-size: 10px; font-weight: 600; margin-top: 3px; }
      .invoice-meta { text-align: right; }
      .invoice-meta h2 { color: #8B4513; font-size: 18px; font-weight: 700; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px; }
      .invoice-meta p { font-size: 10px; margin: 2px 0; color: #555; }
      .invoice-meta p strong { color: #333; }
      .invoice-details { display: flex; justify-content: space-between; margin-bottom: 15px; background: linear-gradient(135deg, #F5F1E8 0%, #EDE7DA 100%); padding: 12px; border-radius: 6px; border-left: 4px solid #8B4513; }
      .bill-to h3 { color: #8B4513; font-size: 12px; margin-bottom: 4px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
      .bill-to p { margin: 1px 0; }
      .summary-stats { text-align: right; }
      .summary-stats p { margin: 1px 0; }
      .charges-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 10px; }
      .charges-table th { background: linear-gradient(135deg, #8B4513 0%, #A0522D 100%); color: white; padding: 6px 8px; text-align: left; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-size: 9px; }
      .charges-table td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
      .charges-table tr:hover { background-color: #faf8f5; }
      .sub-row td { background-color: #f9fafb; color: #666; font-style: italic; padding-left: 20px; font-size: 9px; }
      .text-right { text-align: right; }
      .text-center { text-align: center; }
      .totals { display: flex; justify-content: flex-end; margin-top: 10px; }
      .totals-table { width: 250px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
      .totals-table td { padding: 4px 10px; border-bottom: 1px solid #eee; font-size: 10px; }
      .totals-table tr:last-child td { border-bottom: none; }
      .total-row { background: linear-gradient(135deg, #8B4513 0%, #A0522D 100%); color: white; font-weight: 700; font-size: 12px!important; }
      .total-row td { padding: 8px!important; }
      .footer { margin-top: 15px; text-align: center; font-size: 9px; color: #888; border-top: 1px solid #eee; padding-top: 10px; }
      .footer p { margin: 2px 0; }
    </style>
  </head>
  <body>
    <div class="invoice-container">
      <div class="header">
        <div class="hotel-info">
          <h1>${data.hotel.name}</h1>
          <p>${data.hotel.address}</p>
          <p>${data.hotel.phone} | ${data.hotel.email}</p>
          <p class="tin">TIN: 71786161-3</p>
        </div>
        <div class="invoice-meta">
          <h2>Group Invoice</h2>
          <p><strong>Invoice #:</strong> ${data.invoiceNumber}</p>
          <p><strong>Date:</strong> ${new Date(data.invoiceDate).toLocaleDateString()}</p>
          <p><strong>Due Date:</strong> ${new Date(data.dueDate).toLocaleDateString()}</p>
          <p><strong>Reference:</strong> ${data.groupReference}</p>
        </div>
      </div>

      <div class="invoice-details">
        <div class="bill-to">
          <h3>Bill To (Group Contact):</h3>
          <p><strong>${data.billingContact.name}</strong></p>
          <p>${data.billingContact.email}</p>
          ${data.billingContact.phone ? `<p>${data.billingContact.phone}</p>` : ''}
        </div>
        <div class="summary-stats">
          <p><strong>Total Rooms:</strong> ${data.summary.totalRooms}</p>
          <p><strong>Total Nights:</strong> ${data.summary.totalNights}</p>
        </div>
      </div>

      <table class="charges-table">
        <thead>
          <tr>
            <th>Room / Guest</th>
            <th class="text-center">Dates</th>
            <th class="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${data.bookings.map(b => `
            <tr>
              <td>
                <strong>Room ${b.roomNumber} (${b.roomType})</strong><br/>
                Guest: ${b.guestName}
              </td>
              <td class="text-center">
                ${new Date(b.checkIn).toLocaleDateString()} - ${new Date(b.checkOut).toLocaleDateString()}<br/>
                (${b.nights} nights)
              </td>
              <td class="text-right">
                <strong>${formatCurrencySync(b.subtotal, currency)}</strong>
              </td>
            </tr>
            ${b.additionalCharges.length > 0 ? b.additionalCharges.map(ch => `
              <tr class="sub-row">
                <td colspan="2">↳ Additional Charge (${ch.description}) (x${ch.quantity})</td>
                <td class="text-right">${formatCurrencySync(ch.amount, currency)}</td>
              </tr>
            `).join('') : ''}
          `).join('')}
        </tbody>
      </table>

      <div class="totals">
        <table class="totals-table">
          ${data.summary.discountTotal > 0 ? `
            <tr style="color: #dc2626;">
              <td>Discount ${data.summary.discount?.type === 'percentage' ? `(${data.summary.discount.value}%)` : ''}</td>
              <td class="text-right">- ${formatCurrencySync(data.summary.discountTotal, currency)}</td>
            </tr>
          ` : ''}
          ${data.summary.additionalCharges && data.summary.additionalCharges.length > 0 ? data.summary.additionalCharges.map(charge => `
            <tr>
              <td>Additional Charge (${charge.description})</td>
              <td class="text-right">+ ${formatCurrencySync(charge.amount, currency)}</td>
            </tr>
          `).join('') : ''}
          <tr style="border-top: 2px solid #8B4513; background: #faf8f5;">
            <td colspan="2" style="padding: 8px 12px; font-size: 10px; color: #666; text-transform: uppercase;">Tax Breakdown</td>
          </tr>
          <tr>
            <td>Sales Total</td>
            <td class="text-right">${formatCurrencySync(data.summary.salesTotal, currency)}</td>
          </tr>
          <tr>
            <td>GF / NHIL (5%)</td>
            <td class="text-right">${formatCurrencySync(data.summary.gfNhil, currency)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
            <td><strong>Sub Total</strong></td>
            <td class="text-right"><strong>${formatCurrencySync(data.summary.taxSubTotal, currency)}</strong></td>
          </tr>
          <tr>
            <td>VAT (15%)</td>
            <td class="text-right">${formatCurrencySync(data.summary.vat, currency)}</td>
          </tr>
          <tr>
            <td>Tourism Levy (1%)</td>
            <td class="text-right">${formatCurrencySync(data.summary.tourismLevy, currency)}</td>
          </tr>
          <tr class="total-row">
            <td>Grand Total</td>
            <td class="text-right">${formatCurrencySync(data.summary.total, currency)}</td>
          </tr>
        </table>
      </div>

      <div class="footer">
        <div style="background: #F5F1E8; padding: 6px 12px; border-radius: 6px; text-align: center; margin-bottom: 8px;">
          <p style="font-size: 11px; color: #8B4513; font-weight: 600; margin: 0;">Thank you for choosing ${data.hotel.name}!</p>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 9px; color: #888;">
          <div>
            <p style="margin: 1px 0;"><strong>Payment Terms:</strong> Due upon receipt</p>
            <p style="margin: 1px 0;"><strong>Payment Methods:</strong> Cash, Mobile Money, Bank Transfer</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 1px 0;">${data.hotel.phone} | ${data.hotel.email}</p>
            <p style="margin: 1px 0;">TIN: 71786161-3</p>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `
}

export async function generateGroupInvoicePDF(data: GroupInvoiceData): Promise<Blob> {
  console.log('📄 [GroupInvoicePDF] Generating PDF with', data.bookings.length, 'bookings...')
  const htmlContent = await generateGroupInvoiceHTML(data)

  const element = document.createElement('div')
  element.innerHTML = htmlContent
  element.style.position = 'absolute'
  element.style.left = '-9999px'
  element.style.top = '0'
  // Set a fixed width to ensure consistent rendering
  element.style.width = '800px'
  document.body.appendChild(element)

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    // Ensure full height is captured
    windowHeight: element.scrollHeight,
    height: element.scrollHeight
  })
  document.body.removeChild(element)

  const imgData = canvas.toDataURL('image/jpeg', 0.95)
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const imgWidth = 210 // A4 width in mm
  const pageHeight = 297 // A4 height in mm
  const imgHeight = (canvas.height * imgWidth) / canvas.width
  let heightLeft = imgHeight
  let position = 0

  // Add first page
  pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
  heightLeft -= pageHeight

  // Add additional pages if content extends beyond first page
  while (heightLeft > 0) {
    position = heightLeft - imgHeight
    pdf.addPage()
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight
  }

  console.log('✅ [GroupInvoicePDF] PDF generated with', pdf.getNumberOfPages(), 'page(s)')
  return pdf.output('blob')
}

export async function downloadGroupInvoicePDF(data: GroupInvoiceData): Promise<void> {
  try {
    const pdfBlob = await generateGroupInvoicePDF(data)
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `group - invoice - ${data.invoiceNumber}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    console.error('Failed to download group invoice', e)
    throw e
  }
}