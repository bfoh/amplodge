import { useState } from 'react'

// Test component to isolate the processing issue
export function TestProcessingComponent() {
  const [processing, setProcessing] = useState(false)
  
  const handleTest = async () => {
    setProcessing(true)
    try {
      // Simulate async operation
      await new Promise(resolve => setTimeout(resolve, 1000))
      console.log('Test completed')
    } catch (error) {
      console.error('Test failed:', error)
    } finally {
      setProcessing(false)
    }
  }
  
  return (
    <div>
      <button onClick={handleTest} disabled={processing}>
        {processing ? 'Processing...' : 'Test'}
      </button>
    </div>
  )
}
