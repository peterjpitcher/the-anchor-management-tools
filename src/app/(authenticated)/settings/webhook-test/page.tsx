'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'

export default function WebhookTestPage() {
  const [testResult, setTestResult] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const supabase = useSupabase()
  const [isAuthorized, setIsAuthorized] = useState(false)
  
  const webhookUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/webhooks/twilio`
    : ''

  useEffect(() => {
    // Only super admins can access this page
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: userRole } = await supabase
        .from('user_roles')
        .select('roles(name)')
        .eq('user_id', user.id)
        .single()

      if (userRole && userRole.roles && typeof userRole.roles === 'object' && 'name' in userRole.roles) {
        setIsAuthorized(userRole.roles.name === 'super_admin')
      } else {
        setIsAuthorized(false)
      }
    }
    checkAuth()
  }, [supabase])

  if (!isAuthorized) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex">
          <ExclamationTriangleIcon className="h-6 w-6 text-red-400 mr-3" />
          <div>
            <h3 className="text-lg font-medium text-red-800">Access Denied</h3>
            <p className="mt-2 text-sm text-red-700">
              This page is restricted to super administrators only.
            </p>
            <Link href="/dashboard" className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-800">
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }
  
  async function testWebhook() {
    setLoading(true)
    setTestResult('Testing webhook...')
    
    try {
      // Note: This will fail in production due to signature validation
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
      setTestResult(`❌ Network error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Webhook Test Tool</h1>
      
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex">
          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400 mr-3 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-yellow-800">Production Security Notice</h3>
            <p className="mt-1 text-sm text-yellow-700">
              This test will fail in production due to Twilio signature validation. 
              To properly test webhooks in production, use Twilio&apos;s webhook debugger or configure a proper test number.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium mb-4">Webhook Configuration</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Webhook URL</label>
            <input
              type="text"
              value={webhookUrl}
              readOnly
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50"
            />
            <p className="mt-1 text-sm text-gray-500">
              Configure this URL in your Twilio console for SMS webhooks.
            </p>
          </div>
          
          <div className="pt-4">
            <button
              onClick={testWebhook}
              disabled={loading}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Testing...' : 'Test Webhook'}
            </button>
          </div>
          
          {testResult && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Test Result</label>
              <pre className="bg-gray-100 p-4 rounded-md text-sm overflow-x-auto whitespace-pre-wrap">
                {testResult}
              </pre>
            </div>
          )}
        </div>
      </div>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-medium text-blue-900 mb-2">Testing in Development</h3>
        <p className="text-sm text-blue-700 mb-4">
          For local development testing, you can use ngrok to expose your local server:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm text-blue-700">
          <li>Install ngrok: <code className="bg-blue-100 px-1 py-0.5 rounded">brew install ngrok</code></li>
          <li>Start your dev server: <code className="bg-blue-100 px-1 py-0.5 rounded">npm run dev</code></li>
          <li>In another terminal: <code className="bg-blue-100 px-1 py-0.5 rounded">ngrok http 3000</code></li>
          <li>Use the ngrok URL + <code className="bg-blue-100 px-1 py-0.5 rounded">/api/webhooks/twilio</code> in Twilio</li>
        </ol>
      </div>
    </div>
  )
}