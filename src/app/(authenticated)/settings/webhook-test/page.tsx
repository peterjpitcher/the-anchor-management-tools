'use client'

import { useState } from 'react'

export default function WebhookTestPage() {
  const [testResult, setTestResult] = useState<string>('')
  const [loading, setLoading] = useState(false)
  
  const webhookUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/webhooks/twilio`
    : ''
  
  async function testWebhook() {
    setLoading(true)
    setTestResult('Testing webhook...')
    
    try {
      // Simulate a Twilio webhook request
      const response = await fetch('/api/webhooks/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          MessageSid: 'TEST' + Date.now(),
          AccountSid: 'TEST_ACCOUNT',
          From: '+15551234567',
          To: '+447990587315',
          Body: 'Test message from webhook test page',
          NumMedia: '0',
          NumSegments: '1',
          MessageStatus: 'received',
          ApiVersion: '2010-04-01',
        }).toString(),
      })
      
      const result = await response.json()
      
      if (response.ok) {
        setTestResult(`✅ Success! Response: ${JSON.stringify(result, null, 2)}`)
      } else {
        setTestResult(`❌ Error ${response.status}: ${JSON.stringify(result, null, 2)}`)
      }
    } catch (error) {
      setTestResult(`❌ Network error: ${error}`)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Webhook Configuration Test</h1>
      
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Twilio Webhook URL</h2>
        <p className="mb-4">Configure this URL in your Twilio console for incoming messages:</p>
        <div className="bg-gray-100 p-4 rounded font-mono text-sm break-all">
          {webhookUrl}
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Test Webhook Endpoint</h2>
        <p className="mb-4">
          This will send a test message to your webhook endpoint to verify it's working correctly.
          The test will create a new "Unknown" customer if the phone number doesn't exist.
        </p>
        <button
          onClick={testWebhook}
          disabled={loading}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Send Test Message'}
        </button>
        
        {testResult && (
          <div className="mt-4 p-4 bg-gray-100 rounded">
            <pre className="whitespace-pre-wrap text-sm">{testResult}</pre>
          </div>
        )}
      </div>
      
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Troubleshooting</h2>
        <ol className="list-decimal list-inside space-y-2">
          <li>Ensure your Twilio phone number is configured to send webhooks to the URL above</li>
          <li>Check that your environment variables are set correctly (TWILIO_AUTH_TOKEN)</li>
          <li>In production, webhook signature verification is enabled</li>
          <li>Check the Vercel logs for any webhook errors</li>
          <li>Messages from unknown numbers will auto-create a customer record</li>
        </ol>
      </div>
    </div>
  )
}