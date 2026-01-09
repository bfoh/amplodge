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

    // TAX UPDATE: 17% of the TOTAL amount (room + additional charges)
    const taxRate = 0.17

    // Room price from booking
    const roomTotal = booking.totalPrice

    // Grand total = room cost + additional charges
    const grandTotal = roomTotal + additionalChargesTotal
    const taxAmount = grandTotal * taxRate
    const subtotal = grandTotal - taxAmount

    // Room rate per night (based on room subtotal)
    const roomSubtotal = roomTotal - (roomTotal * taxRate)
    const roomRate = roomSubtotal / nights

    console.log('✅ [InvoiceData] Invoice data created with charges:', {
      hotelName: hotelSettings.name,
      taxRate: `${(taxRate * 100).toFixed(1)}%`,
      invoiceNumber,
      nights,
      roomTotal,
      additionalChargesTotal,
      grandTotal,
      taxAmount
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
        subtotal,
        additionalCharges,
        additionalChargesTotal,
        taxRate,
        taxAmount,
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
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.4; color: #333; background: #fff; font-size: 12px; }
          .invoice-container { max-width: 800px; margin: 0 auto; padding: 20px 40px; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #8B4513; padding-bottom: 10px; }
          .hotel-info h1 { color: #8B4513; font-size: 24px; font-weight: bold; margin-bottom: 5px; }
          .hotel-info p { color: #666; font-size: 11px; margin: 1px 0; }
          .invoice-meta { text-align: right; }
          .invoice-meta h2 { color: #8B4513; font-size: 18px; margin-bottom: 5px; }
          .invoice-meta p { color: #666; font-size: 11px; margin: 1px 0; }
          .invoice-details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
          .bill-to, .invoice-info { background: #F5F1E8; padding: 15px; border-radius: 6px; }
          .bill-to h3, .invoice-info h3 { color: #8B4513; font-size: 14px; margin-bottom: 5px; font-weight: bold; }
          .bill-to p, .invoice-info p { color: #555; font-size: 11px; margin: 2px 0; }
          .charges-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
          .charges-table th { background: #8B4513; color: white; padding: 8px; text-align: left; font-weight: bold; }
          .charges-table td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
          .charges-table tr:nth-child(even) { background: #f9fafb; }
          .charges-table .text-right { text-align: right; }
          .charges-table .text-center { text-align: center; }
          .totals { display: flex; justify-content: flex-end; margin-bottom: 20px; }
          .totals-table { width: 250px; font-size: 11px; }
          .totals-table td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; }
          .totals-table .total-row { background: #8B4513; color: white; font-weight: bold; font-size: 14px; }
          .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; text-align: center; color: #666; font-size: 10px; }
          .footer p { margin: 2px 0; }
          .thank-you { background: #F5F1E8; padding: 15px; border-radius: 6px; text-align: center; margin-top: 15px; }
          .thank-you h3 { color: #8B4513; font-size: 14px; margin-bottom: 5px; }
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
              <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <div style="display: flex; align-items: center; margin-right: 15px;">
                  <img src="/amp.png" alt="AMP LODGE" style="height: 40px; width: auto; max-width: 120px;" />
                </div>
                <h1 style="margin: 0; color: #8B4513; font-size: 32px; font-weight: bold;">${invoiceData.hotel.name}</h1>
              </div>
              <p>${invoiceData.hotel.address}</p>
              <p>Phone: ${invoiceData.hotel.phone}</p>
              <p>Email: ${invoiceData.hotel.email}</p>
              <p>Website: ${invoiceData.hotel.website}</p>
            </div>
            <div class="invoice-meta">
              <h2>${invoiceData.invoiceNumber.startsWith('PRE-') ? 'PRE-INVOICE' : 'INVOICE'}</h2>
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
                <td>${charge.description}</td>
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
              <tr>
                <td>Room Charges:</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.roomRate * invoiceData.charges.nights, currency)}</td>
              </tr>
              ${invoiceData.charges.additionalChargesTotal > 0 ? `
              <tr>
                <td>Additional Charges:</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.additionalChargesTotal, currency)}</td>
              </tr>
              ` : ''}
              <tr>
                <td>Subtotal:</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.subtotal, currency)}</td>
              </tr>
              <tr>
                <td>Tax (${(invoiceData.charges.taxRate * 100).toFixed(1)}%):</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.taxAmount, currency)}</td>
              </tr>
              <tr class="total-row">
                <td>Total:</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.total, currency)}</td>
              </tr>
            </table>
          </div>

          <!-- Thank You Message -->
          <div class="thank-you">
            <h3>Thank You for Staying with ${invoiceData.hotel.name}!</h3>
            <p>We hope you enjoyed your stay and look forward to welcoming you back soon.</p>
          </div>

          <!-- Footer -->
          <div class="footer">
            <p><strong>${invoiceData.hotel.name} Hotel Management System</strong></p>
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

// ===================== PRE-INVOICE FUNCTIONS =====================

export interface PreInvoiceData extends InvoiceData {
  status: 'pending' | 'paid'
  isPreInvoice: boolean
}

/**
 * Create pre-invoice data for a confirmed booking (not yet paid)
 */
export async function createPreInvoiceData(booking: BookingWithDetails, roomDetails: any): Promise<PreInvoiceData> {
  console.log('📋 [PreInvoice] Creating pre-invoice data for booking:', booking.id)

  // Use the existing createInvoiceData function as base
  const invoiceData = await createInvoiceData(booking, roomDetails)

  // Add pre-invoice specific fields
  return {
    ...invoiceData,
    invoiceNumber: `PRE-${invoiceData.invoiceNumber}`,
    status: 'pending',
    isPreInvoice: true
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

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Pre-Invoice ${preInvoiceData.invoiceNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.4; color: #333; background: #fff; font-size: 12px; }
          .invoice-container { max-width: 800px; margin: 0 auto; padding: 20px 40px; background: #fff; }
          .pre-invoice-banner { background: #f59e0b; color: white; padding: 10px; text-align: center; font-weight: bold; font-size: 14px; margin-bottom: 15px; border-radius: 4px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #8B4513; padding-bottom: 10px; }
          .hotel-info h1 { color: #8B4513; font-size: 24px; font-weight: bold; margin-bottom: 5px; }
          .hotel-info p { color: #666; font-size: 11px; margin: 1px 0; }
          .invoice-meta { text-align: right; }
          .invoice-meta h2 { color: #f59e0b; font-size: 18px; margin-bottom: 5px; }
          .invoice-meta p { color: #666; font-size: 11px; margin: 1px 0; }
          .status-badge { display: inline-block; background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: bold; margin-top: 8px; }
          .invoice-details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
          .bill-to, .invoice-info { background: #F5F1E8; padding: 15px; border-radius: 6px; }
          .bill-to h3, .invoice-info h3 { color: #8B4513; font-size: 14px; margin-bottom: 5px; font-weight: bold; }
          .bill-to p, .invoice-info p { color: #555; font-size: 11px; margin: 2px 0; }
          .charges-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
          .charges-table th { background: #8B4513; color: white; padding: 8px; text-align: left; font-weight: bold; }
          .charges-table td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
          .charges-table tr:nth-child(even) { background: #f9fafb; }
          .charges-table .text-right { text-align: right; }
          .charges-table .text-center { text-align: center; }
          .totals { display: flex; justify-content: flex-end; margin-bottom: 20px; }
          .totals-table { width: 250px; font-size: 11px; }
          .totals-table td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; }
          .totals-table .total-row { background: #f59e0b; color: white; font-weight: bold; font-size: 14px; }
          .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; text-align: center; color: #666; font-size: 10px; }
          .footer p { margin: 2px 0; }
          .payment-notice { background: #fef3c7; border: 2px solid #f59e0b; padding: 15px; border-radius: 6px; text-align: center; margin-top: 15px; }
          .payment-notice h3 { color: #92400e; font-size: 14px; margin-bottom: 5px; }
          .payment-notice p { color: #78350f; font-size: 11px; }
          @media print { 
            .invoice-container { padding: 10px 20px; } 
            body { -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <!-- Pre-Invoice Banner -->
          <div class="pre-invoice-banner">
            ⏳ PRE-INVOICE - PAYMENT DUE AT CHECK-IN
          </div>

          <!-- Header -->
          <div class="header">
            <div class="hotel-info">
              <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <div style="display: flex; align-items: center; margin-right: 15px;">
                  <img src="/amp.png" alt="AMP LODGE" style="height: 40px; width: auto; max-width: 120px;" />
                </div>
                <h1 style="margin: 0; color: #8B4513; font-size: 32px; font-weight: bold;">${preInvoiceData.hotel.name}</h1>
              </div>
              <p>${preInvoiceData.hotel.address}</p>
              <p>Phone: ${preInvoiceData.hotel.phone}</p>
              <p>Email: ${preInvoiceData.hotel.email}</p>
              <p>Website: ${preInvoiceData.hotel.website}</p>
            </div>
            <div class="invoice-meta">
              <h2>PRE-INVOICE</h2>
              <p><strong>Invoice #:</strong> ${preInvoiceData.invoiceNumber}</p>
              <p><strong>Date:</strong> ${new Date(preInvoiceData.invoiceDate).toLocaleDateString()}</p>
              <p><strong>Due Date:</strong> At Check-in</p>
              <span class="status-badge">⏳ UNPAID</span>
            </div>
          </div>

          <!-- Invoice Details -->
          <div class="invoice-details">
            <div class="bill-to">
              <h3>Bill To:</h3>
              <p><strong>${preInvoiceData.guest.name}</strong></p>
              ${preInvoiceData.guest.email ? `<p>${preInvoiceData.guest.email}</p>` : ''}
              ${preInvoiceData.guest.phone ? `<p>Phone: ${preInvoiceData.guest.phone}</p>` : ''}
              ${preInvoiceData.guest.address ? `<p>${preInvoiceData.guest.address}</p>` : ''}
            </div>
            <div class="invoice-info">
              <h3>Booking Details:</h3>
              <p><strong>Booking ID:</strong> ${preInvoiceData.booking.id}</p>
              <p><strong>Room:</strong> ${preInvoiceData.booking.roomNumber} (${preInvoiceData.booking.roomType})</p>
              <p><strong>Check-in:</strong> ${new Date(preInvoiceData.booking.checkIn).toLocaleDateString()}</p>
              <p><strong>Check-out:</strong> ${new Date(preInvoiceData.booking.checkOut).toLocaleDateString()}</p>
              <p><strong>Nights:</strong> ${preInvoiceData.booking.nights}</p>
              <p><strong>Guests:</strong> ${preInvoiceData.booking.numGuests}</p>
            </div>
          </div>

          <!-- Charges Table -->
          <table class="charges-table">
            <thead>
              <tr>
                <th>Description</th>
                <th class="text-center">Qty/Nights</th>
                <th class="text-right">Rate</th>
                <th class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${preInvoiceData.booking.roomType} - Room ${preInvoiceData.booking.roomNumber}</td>
                <td class="text-center">${preInvoiceData.charges.nights}</td>
                <td class="text-right">${formatCurrencySync(preInvoiceData.charges.roomRate, currency)}/night</td>
                <td class="text-right">${formatCurrencySync(preInvoiceData.charges.subtotal, currency)}</td>
              </tr>
            </tbody>
          </table>

          <!-- Totals -->
          <div class="totals">
            <table class="totals-table">
              <tr>
                <td>Subtotal</td>
                <td class="text-right">${formatCurrencySync(preInvoiceData.charges.subtotal, currency)}</td>
              </tr>
              <tr>
                <td>Tax (${(preInvoiceData.charges.taxRate * 100).toFixed(0)}%)</td>
                <td class="text-right">${formatCurrencySync(preInvoiceData.charges.taxAmount, currency)}</td>
              </tr>
              <tr class="total-row">
                <td><strong>Total Due</strong></td>
                <td class="text-right"><strong>${formatCurrencySync(preInvoiceData.charges.total, currency)}</strong></td>
              </tr>
            </table>
          </div>

          <!-- Payment Notice -->
          <div class="payment-notice">
            <h3>💳 Payment Information</h3>
            <p>Full payment of <strong>${formatCurrencySync(preInvoiceData.charges.total, currency)}</strong> is due upon check-in.</p>
            <p>We accept Cash, Mobile Money, and Bank Transfers.</p>
          </div>

          <!-- Footer -->
          <div class="footer">
            <p>This is a pre-invoice. Final invoice will be issued after checkout.</p>
            <p>Thank you for choosing ${preInvoiceData.hotel.name}!</p>
            <p>© ${new Date().getFullYear()} ${preInvoiceData.hotel.name}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `

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
    pdf.save(`pre-invoice-${preInvoiceData.invoiceNumber}.pdf`)

    console.log('✅ [PreInvoicePDF] Pre-invoice PDF downloaded successfully')
  } catch (error: any) {
    console.error('❌ [PreInvoicePDF] Failed to download pre-invoice PDF:', error)
    throw new Error(`Failed to download pre-invoice PDF: ${error.message}`)
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
    subtotal: number // Pre-tax subtotal
    taxRate: number
    taxAmount: number
    total: number // Grand total
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
    const invoiceNumber = `GRP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    const invoiceDate = new Date().toISOString()
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    // Group reference from first booking
    let groupReference = 'N/A'
    if (bookings.length > 0 && (bookings[0] as any).groupReference) {
      groupReference = (bookings[0] as any).groupReference
    }

    const processedBookings = await Promise.all(bookings.map(async (booking) => {
      // Get additional charges
      const additionalCharges = await bookingChargesService.getChargesForBooking(booking.id)
      const additionalChargesTotal = additionalCharges.reduce((sum, c) => sum + (c.amount || 0), 0)

      const checkIn = new Date(booking.checkIn)
      const checkOut = new Date(booking.actualCheckOut || booking.checkOut)
      // Normalize to midnight UTC for consistent night calculation
      const d1 = new Date(Date.UTC(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate()))
      const d2 = new Date(Date.UTC(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate()))

      const nights = Math.max(1, Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)))

      const taxRate = 0.17
      const roomTotal = booking.totalPrice // Total room price (likely strictly room cost or whatever stored in DB)

      const grandTotalForRoom = roomTotal + additionalChargesTotal // This line item total

      // Calculate room rate per night (removing tax from roomTotal portion?)
      // Assuming totalPrice in DB includes tax if that's the convention, OR adds tax later.
      // Based on createInvoiceData logic:
      // const grandTotal = roomTotal + additionalChargesTotal
      // const taxAmount = grandTotal * taxRate
      // const subtotal = grandTotal - taxAmount
      // This implies "grandTotal" is the base, and tax is EXTRACTED. Wait.
      // Line 110: const grandTotal = roomTotal + additionalChargesTotal
      // Line 111: const taxAmount = grandTotal * taxRate
      // This means tax is calculated ON TOP of the total? No, line 112 says subtotal = grandTotal - taxAmount
      // This implies grandTotal is INCLUSIVE of tax. 
      // Tax = 17% of total? That's unusual (usually total = sub * 1.17).
      // But adhering to existing logic:

      const totalInclusive = grandTotalForRoom
      const taxAmountForItem = totalInclusive * taxRate
      const subtotalForItem = totalInclusive - taxAmountForItem

      const roomSubtotal = roomTotal - (roomTotal * taxRate)
      const roomRate = roomSubtotal / nights

      return {
        id: booking.id,
        guestName: booking.guest?.name || 'Guest',
        roomNumber: booking.room?.roomNumber || 'N/A',
        roomType: booking.room?.roomType || 'Standard Room',
        checkIn: booking.checkIn,
        checkOut: booking.actualCheckOut || booking.checkOut,
        nights,
        roomRate,
        subtotal: totalInclusive, // Display total per line item
        additionalCharges,
        additionalChargesTotal,
        // Internal fields for summary calc
        _subtotalExclTax: subtotalForItem,
        _taxAmount: taxAmountForItem
      }
    }))

    // Calculate Summary
    const totalWithTax = processedBookings.reduce((sum, b) => sum + b.subtotal, 0)
    const totalSubtotalExclTax = processedBookings.reduce((sum, b) => sum + b._subtotalExclTax, 0)
    const totalTaxAmount = processedBookings.reduce((sum, b) => sum + b._taxAmount, 0)

    // Recalculate precisely
    const taxRate = 0.17

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
        subtotal: totalSubtotalExclTax,
        taxRate,
        taxAmount: totalTaxAmount,
        total: totalWithTax
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
    throw new Error(`Failed to create group invoice data: ${error.message}`)
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
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.4; color: #333; background: #fff; font-size: 12px; }
        .invoice-container { max-width: 800px; margin: 0 auto; padding: 20px 40px; background: #fff; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #8B4513; padding-bottom: 10px; }
        .hotel-info h1 { color: #8B4513; font-size: 24px; font-weight: bold; margin-bottom: 5px; }
        .hotel-info p { color: #666; font-size: 11px; margin: 1px 0; }
        .invoice-meta { text-align: right; }
        .invoice-meta h2 { color: #8B4513; font-size: 18px; margin-bottom: 5px; }
        .invoice-details { display: flex; justify-content: space-between; margin-bottom: 20px; background: #F5F1E8; padding: 15px; border-radius: 6px; }
        .bill-to h3 { color: #8B4513; font-size: 14px; margin-bottom: 5px; font-weight: bold; }
        .charges-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
        .charges-table th { background: #8B4513; color: white; padding: 8px; text-align: left; }
        .charges-table td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
        .sub-row td { background-color: #f9fafb; color: #666; font-style: italic; padding-left: 20px; }
        .totals { display: flex; justify-content: flex-end; }
        .totals-table { width: 250px; }
        .totals-table td { padding: 5px; border-bottom: 1px solid #eee; }
        .total-row { background: #8B4513; color: white; font-weight: bold; }
        .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #666; border-top: 1px solid #eee; padding-top: 10px; }
      </style>
    </head>
    <body>
      <div class="invoice-container">
        <div class="header">
          <div class="hotel-info">
            <h1>${data.hotel.name}</h1>
            <p>${data.hotel.address}</p>
            <p>${data.hotel.phone} | ${data.hotel.email}</p>
          </div>
          <div class="invoice-meta">
            <h2>GROUP INVOICE</h2>
            <p><strong>Invoice #:</strong> ${data.invoiceNumber}</p>
            <p><strong>Date:</strong> ${new Date(data.invoiceDate).toLocaleDateString()}</p>
            <p><strong>Ref:</strong> ${data.groupReference}</p>
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
                  <td colspan="2">↳ ${ch.description} (x${ch.quantity})</td>
                  <td class="text-right">${formatCurrencySync(ch.amount, currency)}</td>
                </tr>
              `).join('') : ''}
            `).join('')}
          </tbody>
        </table>

        <div class="totals">
          <table class="totals-table">
            <tr>
              <td>Subtotal</td>
              <td class="text-right">${formatCurrencySync(data.summary.subtotal, currency)}</td>
            </tr>
            <tr>
              <td>Tax (${(data.summary.taxRate * 100).toFixed(0)}%)</td>
              <td class="text-right">${formatCurrencySync(data.summary.taxAmount, currency)}</td>
            </tr>
            <tr class="total-row">
              <td>Grand Total</td>
              <td class="text-right">${formatCurrencySync(data.summary.total, currency)}</td>
            </tr>
          </table>
        </div>

        <div class="footer">
          <p>Thank you for choosing ${data.hotel.name} for your group stay.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export async function generateGroupInvoicePDF(data: GroupInvoiceData): Promise<Blob> {
  console.log('📄 [GroupInvoicePDF] Generating PDF...')
  const htmlContent = await generateGroupInvoiceHTML(data)

  const element = document.createElement('div')
  element.innerHTML = htmlContent
  element.style.position = 'absolute'
  element.style.left = '-9999px'
  document.body.appendChild(element)

  const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
  document.body.removeChild(element)

  const imgData = canvas.toDataURL('image/jpeg', 0.95)
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const imgWidth = 210
  const imgHeight = (canvas.height * imgWidth) / canvas.width

  pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight)
  return pdf.output('blob')
}

export async function downloadGroupInvoicePDF(data: GroupInvoiceData): Promise<void> {
  try {
    const pdfBlob = await generateGroupInvoicePDF(data)
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `group-invoice-${data.invoiceNumber}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    console.error('Failed to download group invoice', e)
    throw e
  }
}