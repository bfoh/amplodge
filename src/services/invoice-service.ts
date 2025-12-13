import { hotelSettingsService } from './hotel-settings'
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
    
    const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24))
    
    // Validate nights calculation
    if (nights < 0) {
      throw new Error('Check-out date cannot be before check-in date')
    }
    
    const roomRate = booking.totalPrice / nights
    const subtotal = booking.totalPrice
    const taxRate = hotelSettings.taxRate // Use real tax rate from settings
    const taxAmount = subtotal * taxRate
    const total = subtotal + taxAmount

    console.log('✅ [InvoiceData] Invoice data created with real hotel settings:', {
      hotelName: hotelSettings.name,
      taxRate: `${(taxRate * 100).toFixed(1)}%`,
      invoiceNumber,
      nights,
      total
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
        taxRate,
        taxAmount,
        total
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
              <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <div style="display: flex; align-items: center; margin-right: 15px;">
                  <img src="/amp.png" alt="AMP LODGE" style="height: 40px; width: auto; max-width: 120px;" />
                </div>
                <h1 style="margin: 0; color: #2563eb; font-size: 32px; font-weight: bold;">${invoiceData.hotel.name}</h1>
              </div>
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
                <td class="text-right">${formatCurrencySync(invoiceData.charges.roomRate, currency)}</td>
                <td class="text-right">${formatCurrencySync(invoiceData.charges.subtotal, currency)}</td>
              </tr>
            </tbody>
          </table>

          <!-- Totals -->
          <div class="totals">
            <table class="totals-table">
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
    const imgData = canvas.toDataURL('image/png')
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
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    // Add new pages if needed
    while (heightLeft >= 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
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
          .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; margin: -20px -20px 30px -20px; }
          .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 16px; }
          .invoice-summary { background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .invoice-summary h2 { color: #2563eb; font-size: 20px; margin-bottom: 15px; }
          .summary-row { display: flex; justify-content: space-between; margin: 8px 0; padding: 5px 0; border-bottom: 1px solid #e2e8f0; }
          .summary-row:last-child { border-bottom: none; font-weight: bold; color: #2563eb; }
          .summary-label { color: #555; }
          .summary-value { color: #333; font-weight: 500; }
          .download-section { background: #f0f9ff; border: 1px solid #0ea5e9; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
          .download-section h3 { color: #0c4a6e; margin: 0 0 15px 0; font-size: 18px; }
          .download-btn { background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; margin: 10px; }
          .download-btn:hover { background: #1d4ed8; }
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
      return { success: true, result }
    }

    console.error('❌ [InvoiceEmail] Email send reported failure:', result.error)
    return { success: false, error: result.error }
  } catch (error: any) {
    console.error('❌ [InvoiceEmail] Failed to send email:', error)
    return { success: false, error: error.message }
  }
}

// Helper function to convert blob to base64
function blobToBase64(blob: Blob): Promise<string> {
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