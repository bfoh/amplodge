import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { createInvoiceData, generateInvoiceHTML, sendInvoiceEmail } from '@/services/invoice-service'

export function InvoiceTestPage() {
  const [testEmail, setTestEmail] = useState('test@example.com')
  const [loading, setLoading] = useState(false)

  const handleTestInvoice = async () => {
    setLoading(true)
    try {
      console.log('🧪 [InvoiceTest] Starting test invoice generation...')

      // Create test booking data
      const testBooking = {
        id: 'test_booking_123',
        guestId: 'test_guest_123',
        roomId: 'test_room_123',
        checkIn: '2024-01-15T14:00:00Z',
        checkOut: '2024-01-17T11:00:00Z',
        status: 'checked-out',
        totalPrice: 200.00,
        numGuests: 2,
        actualCheckOut: '2024-01-17T11:00:00Z',
        createdAt: '2024-01-10T10:00:00Z',
        guest: {
          name: 'Test Guest',
          email: testEmail,
          phone: '+1234567890',
          address: '123 Test Street, Test City, TC 12345'
        },
        room: {
          roomNumber: '101',
          roomType: 'Deluxe Suite'
        }
      }

      const testRoom = {
        roomNumber: '101',
        roomType: 'Deluxe Suite'
      }

      console.log('📊 [InvoiceTest] Creating invoice data...')
      const invoiceData = createInvoiceData(testBooking, testRoom)
      console.log('✅ [InvoiceTest] Invoice data created:', invoiceData.invoiceNumber)

      console.log('📄 [InvoiceTest] Generating invoice HTML...')
      const invoiceHtml = await generateInvoiceHTML(invoiceData)
      console.log('✅ [InvoiceTest] Invoice HTML generated, length:', invoiceHtml.length)

      console.log('📧 [InvoiceTest] Sending test email...')
      const emailResult = await sendInvoiceEmail(invoiceData, invoiceHtml)
      console.log('📧 [InvoiceTest] Email result:', emailResult)

      if (emailResult.success) {
        toast.success(`✅ Test invoice sent to ${testEmail}!`)
        console.log('🎉 [InvoiceTest] Test completed successfully!')
      } else {
        toast.error(`❌ Test email failed: ${emailResult.error}`)
        console.error('❌ [InvoiceTest] Test failed:', emailResult.error)
      }
    } catch (error: any) {
      console.error('❌ [InvoiceTest] Test failed:', error)
      toast.error(`❌ Test failed: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-6">
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">🧾 Invoice System Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="testEmail">Test Email Address</Label>
            <Input
              id="testEmail"
              type="email"
              placeholder="test@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </div>
          
          <Button 
            onClick={handleTestInvoice} 
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Sending Test Invoice...' : 'Send Test Invoice'}
          </Button>
          
          <div className="text-sm text-gray-600 space-y-2">
            <p><strong>This will:</strong></p>
            <ul className="list-disc list-inside space-y-1">
              <li>Generate a test invoice</li>
              <li>Send it to the email address above</li>
              <li>Show detailed logs in console</li>
              <li>Display success/error messages</li>
            </ul>
          </div>
          
          <div className="text-xs text-gray-500">
            <p><strong>Check console logs for detailed information</strong></p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}