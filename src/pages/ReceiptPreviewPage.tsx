import { useEffect, useState } from 'react'
import { generateReceipt80mmHTML } from '@/services/invoice-service'

// Mock data shaped to the InvoiceData interface for visual preview only.
const mockInvoiceData: any = {
  invoiceNumber: 'INV-PREVIEW-AB12CD',
  invoiceDate: new Date().toISOString(),
  dueDate: new Date().toISOString(),
  guest: { name: 'John Doe', email: 'john@example.com', phone: '024 000 0000' },
  booking: {
    id: 'preview',
    roomNumber: '204',
    roomType: 'Standard Room',
    checkIn: new Date(Date.now() - 2 * 86400000).toISOString(),
    checkOut: new Date().toISOString(),
    nights: 2,
    numGuests: 2,
  },
  charges: {
    roomRate: 150,
    nights: 2,
    subtotal: 300,
    additionalCharges: [{ description: 'Laundry', quantity: 1, unitPrice: 40, amount: 40 }],
    additionalChargesTotal: 40,
    discount: undefined,
    discountTotal: 0,
    salesTotal: 295.16,
    gfNhil: 14.76,
    taxSubTotal: 309.92,
    vat: 45.08,
    tourismLevy: 2.95,
    total: 340,
  },
  hotel: {
    name: 'AMP LODGE',
    address: 'Accra, Ghana',
    phone: '030 000 0000',
    email: 'info@amplodge.com',
    website: 'www.amplodge.com',
  },
}

export function ReceiptPreviewPage() {
  const [html, setHtml] = useState('')

  useEffect(() => {
    generateReceipt80mmHTML(mockInvoiceData).then(setHtml)
  }, [])

  return (
    <div style={{ padding: 20, background: '#eee', minHeight: '100vh' }}>
      <h2 style={{ marginBottom: 12 }}>80mm Receipt Preview (72mm content)</h2>
      <iframe
        title="receipt-preview"
        srcDoc={html}
        style={{ width: '80mm', height: '600px', border: '1px solid #999', background: '#fff' }}
      />
    </div>
  )
}
