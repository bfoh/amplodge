import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { debugInvoiceSystem } from '@/services/invoice-debug-service'
import { createInvoiceData, generateInvoicePDF, sendInvoiceEmail } from '@/services/invoice-service'
import { toast } from 'sonner'

export function InvoiceDebugPage() {
  const [debugging, setDebugging] = useState(false)
  const [debugResults, setDebugResults] = useState<any>(null)
  const [testing, setTesting] = useState(false)

  const runComprehensiveDebug = async () => {
    setDebugging(true)
    setDebugResults(null)
    try {
      console.log('🔍 [InvoiceDebugPage] Starting comprehensive debug...')
      const results = await debugInvoiceSystem()
      setDebugResults(results)
      
      if (results.success) {
        toast.success('✅ Debug completed successfully!')
      } else {
        toast.error(`❌ Debug failed: ${results.error}`)
      }
    } catch (error: any) {
      console.error('❌ [InvoiceDebugPage] Debug failed:', error)
      toast.error(`❌ Debug failed: ${error.message}`)
    } finally {
      setDebugging(false)
    }
  }

  const testInvoiceWorkflow = async () => {
    setTesting(true)
    try {
      console.log('🧪 [InvoiceDebugPage] Testing invoice workflow...')

      // Test data
      const testBooking = {
        id: 'debug-workflow-test-123',
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
          name: 'Debug Workflow Test Guest',
          email: 'debug-workflow@test.com',
          phone: '+1234567890',
          address: '123 Debug Workflow St'
        },
        room: {
          roomNumber: 'DEBUG-WF-101',
          roomType: 'Debug Workflow Room'
        }
      }

      const testRoom = {
        roomNumber: 'DEBUG-WF-101',
        roomType: 'Debug Workflow Room'
      }

      console.log('📊 [InvoiceDebugPage] Creating invoice data...')
      const invoiceData = createInvoiceData(testBooking, testRoom)
      console.log('✅ [InvoiceDebugPage] Invoice data created:', invoiceData.invoiceNumber)

      console.log('📄 [InvoiceDebugPage] Generating invoice HTML...')
      const invoiceHtml = await generateInvoicePDF(invoiceData)
      console.log('✅ [InvoiceDebugPage] Invoice HTML generated, length:', invoiceHtml.length)

      console.log('📧 [InvoiceDebugPage] Sending invoice email...')
      const emailResult = await sendInvoiceEmail(invoiceData, invoiceHtml)
      console.log('📧 [InvoiceDebugPage] Email result:', emailResult)

      if (emailResult.success) {
        toast.success('✅ Invoice workflow test completed successfully!')
        console.log('🎉 [InvoiceDebugPage] All workflow tests passed!')
      } else {
        toast.error(`❌ Invoice workflow test failed: ${emailResult.error}`)
        console.error('❌ [InvoiceDebugPage] Workflow test failed:', emailResult.error)
      }

    } catch (error: any) {
      console.error('❌ [InvoiceDebugPage] Workflow test failed:', error)
      toast.error(`❌ Invoice workflow test failed: ${error.message}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              🔍 Invoice System Debug Center
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              This comprehensive debug center will test all aspects of the invoice system to identify issues.
            </p>
            
            <div className="flex gap-4">
              <Button 
                onClick={runComprehensiveDebug} 
                disabled={debugging}
                className="flex-1"
              >
                {debugging ? 'Running Debug...' : '🔍 Run Comprehensive Debug'}
              </Button>
              
              <Button 
                onClick={testInvoiceWorkflow} 
                disabled={testing}
                variant="outline"
                className="flex-1"
              >
                {testing ? 'Testing...' : '🧪 Test Invoice Workflow'}
              </Button>
            </div>

            <div className="text-sm text-gray-500">
              <p><strong>Debug:</strong> Tests all system components individually</p>
              <p><strong>Workflow:</strong> Tests the complete invoice generation and sending process</p>
            </div>
          </CardContent>
        </Card>

        {debugResults && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                📊 Debug Results
                <Badge variant={debugResults.success ? "default" : "destructive"}>
                  {debugResults.success ? "SUCCESS" : "FAILED"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {debugResults.details?.tests?.map((test: any, index: number) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={test.success ? "default" : "destructive"}>
                      {test.success ? "✅" : "❌"}
                    </Badge>
                    <span className="font-medium">{test.test}</span>
                  </div>
                  
                  {test.success && test.details && (
                    <div className="ml-6 text-sm text-gray-600">
                      <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
                        {JSON.stringify(test.details, null, 2)}
                      </pre>
                    </div>
                  )}
                  
                  {!test.success && test.error && (
                    <div className="ml-6 text-sm text-red-600">
                      <p><strong>Error:</strong> {test.error}</p>
                      {test.details && (
                        <pre className="bg-red-50 p-2 rounded text-xs overflow-x-auto mt-2">
                          {JSON.stringify(test.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                  
                  {index < debugResults.details.tests.length - 1 && <Separator />}
                </div>
              ))}
              
              {debugResults.error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded">
                  <h4 className="font-medium text-red-800">Overall Error:</h4>
                  <p className="text-red-700">{debugResults.error}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>📋 Debug Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h4 className="font-medium">1. Run Comprehensive Debug</h4>
              <p className="text-sm text-gray-600">
                This will test each component individually:
              </p>
              <ul className="text-sm text-gray-600 list-disc list-inside ml-4 space-y-1">
                <li>Blink client availability</li>
                <li>Invoice data creation</li>
                <li>HTML generation</li>
                <li>Email sending capability</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium">2. Test Invoice Workflow</h4>
              <p className="text-sm text-gray-600">
                This will test the complete workflow as used in the actual checkout process.
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium">3. Check Console Logs</h4>
              <p className="text-sm text-gray-600">
                Open browser developer tools (F12) and check the Console tab for detailed logs.
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium">4. Test Real Checkout</h4>
              <p className="text-sm text-gray-600">
                After fixing any issues found here, test the actual checkout process in:
              </p>
              <ul className="text-sm text-gray-600 list-disc list-inside ml-4 space-y-1">
                <li>Staff → Reservations page</li>
                <li>Staff → Calendar page</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
