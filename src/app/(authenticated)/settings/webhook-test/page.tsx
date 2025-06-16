'use client'

import { useState } from 'react'

export default function WebhookTestPage() {
  const [testResult, setTestResult] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [useUnsecured, setUseUnsecured] = useState(false)
  
  const webhookUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/webhooks/twilio`
    : ''
    
  const unsecuredWebhookUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/webhooks/twilio-unsecured`
    : ''
  
  async function testWebhook() {
    setLoading(true)
    setTestResult('Testing webhook...')
    
    try {
      // Simulate a Twilio webhook request
      const endpoint = useUnsecured ? '/api/webhooks/twilio-unsecured' : '/api/webhooks/twilio'
      const response = await fetch(endpoint, {
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
        <h2 className="text-xl font-semibold mb-4">Twilio Webhook URLs</h2>
        
        <div className="mb-6">
          <h3 className="font-medium mb-2">Production URL (with signature validation):</h3>
          <div className="bg-gray-100 p-4 rounded font-mono text-sm break-all mb-2">
            {webhookUrl}
          </div>
          <p className="text-sm text-gray-600">Use this in your Twilio console for production.</p>
        </div>
        
        <div className="mb-6">
          <h3 className="font-medium mb-2">Testing URL (NO security - testing only!):</h3>
          <div className="bg-red-50 border border-red-200 p-4 rounded font-mono text-sm break-all mb-2">
            {unsecuredWebhookUrl}
          </div>
          <p className="text-sm text-red-600">⚠️ WARNING: This endpoint has no security. Use only for debugging!</p>
        </div>
        
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="useUnsecured"
            checked={useUnsecured}
            onChange={(e) => setUseUnsecured(e.target.checked)}
            className="rounded border-gray-300"
          />
          <label htmlFor="useUnsecured" className="text-sm">
            Use unsecured endpoint for testing (bypasses signature validation)
          </label>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Test Webhook Endpoint</h2>
        <p className="mb-4">
          This will send a test message to your webhook endpoint to verify it&apos;s working correctly.
          The test will create a new &quot;Unknown&quot; customer if the phone number doesn&apos;t exist.
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
      
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Troubleshooting 401 Errors</h2>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium mb-1">1. Check TWILIO_AUTH_TOKEN</h3>
            <p className="text-sm text-gray-600">Ensure your Vercel environment variable matches your Twilio Auth Token exactly.</p>
          </div>
          
          <div>
            <h3 className="font-medium mb-1">2. Verify Webhook URL</h3>
            <p className="text-sm text-gray-600">In Twilio console, make sure the webhook URL matches exactly (including https://).</p>
          </div>
          
          <div>
            <h3 className="font-medium mb-1">3. Temporary Bypass (Testing Only)</h3>
            <p className="text-sm text-gray-600">Add this environment variable in Vercel: <code className="bg-gray-100 px-1">SKIP_TWILIO_SIGNATURE_VALIDATION=true</code></p>
            <p className="text-sm text-red-600">⚠️ Remove this after testing!</p>
          </div>
          
          <div>
            <h3 className="font-medium mb-1">4. Use Unsecured Endpoint</h3>
            <p className="text-sm text-gray-600">For debugging only, you can temporarily use the unsecured endpoint in Twilio.</p>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">General Troubleshooting</h2>
        <ol className="list-decimal list-inside space-y-2">
          <li>Check the Webhook Monitor at Settings → Webhook Monitor</li>
          <li>Look for webhook_logs entries in your Supabase database</li>
          <li>Check Vercel function logs for detailed error messages</li>
          <li>Ensure all environment variables are set in Vercel</li>
          <li>Messages from unknown numbers will auto-create a customer record</li>
        </ol>
      </div>
    </div>
  )
}