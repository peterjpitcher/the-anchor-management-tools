'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { CheckCircle2, XCircle, Info, Loader2 } from 'lucide-react'

export default function CalendarTestPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const testConnection = async () => {
    setLoading(true)
    setResult(null)
    
    try {
      const response = await fetch('/api/test-calendar')
      const data = await response.json()
      setResult(data)
    } catch (error) {
      setResult({
        success: false,
        message: 'Failed to test connection',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-8">Google Calendar Test</h1>
      
      <div className="bg-white shadow sm:rounded-lg mb-6">
        <div className="px-4 py-5 sm:p-6 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Test Calendar Connection</h2>
          <p className="mt-1 text-sm text-gray-500">
            This tool helps diagnose Google Calendar integration issues.
          </p>
        </div>
        <div className="px-4 py-5 sm:p-6">
          <Button 
            onClick={testConnection} 
            disabled={loading}
            className="mb-4"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
          
          {result && (
            <div className="space-y-4">
              {/* Status Alert */}
              <div className={`${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} border rounded-lg p-4`}>
                <div className="flex">
                  <div className="flex-shrink-0">
                    {result.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-400" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-400" />
                    )}
                  </div>
                  <div className="ml-3">
                    <h3 className={`text-sm font-medium ${result.success ? 'text-green-800' : 'text-red-800'}`}>
                      {result.success ? 'Success' : 'Failed'}
                    </h3>
                    <div className={`mt-2 text-sm ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                      {result.message}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Configuration Status */}
              {result.configStatus && (
                <div className="bg-white shadow sm:rounded-lg">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">Configuration Status</h3>
                  </div>
                  <div className="px-4 py-4">
                    <dl className="grid grid-cols-1 gap-2 text-sm">
                      <div className="flex justify-between">
                        <dt className="font-medium">Configured:</dt>
                        <dd className={result.configStatus.isConfigured ? 'text-green-600' : 'text-red-600'}>
                          {result.configStatus.isConfigured ? 'Yes' : 'No'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="font-medium">Calendar ID:</dt>
                        <dd className="font-mono text-xs">{result.configStatus.calendarId}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="font-medium">Auth Method:</dt>
                        <dd>{result.configStatus.authMethod}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              )}
              
              {/* Details */}
              {result.details && (
                <div className="bg-white shadow sm:rounded-lg">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">Details</h3>
                  </div>
                  <div className="px-4 py-4">
                    <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto">
                      {JSON.stringify(result.details, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
              
              {/* Setup Instructions */}
              {!result.success && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <Info className="h-5 w-5 text-blue-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-blue-800">Setup Instructions</h3>
                      <div className="mt-2 text-sm text-blue-700 space-y-2">
                        <p className="font-medium">To fix this issue:</p>
                        {result.details?.errorCode === 404 && (
                          <ol className="list-decimal list-inside space-y-1">
                            <li>Check that GOOGLE_CALENDAR_ID is correct in your .env.local</li>
                            <li>Use either &quot;primary&quot; or the full calendar ID (e.g., &quot;calendar-id@group.calendar.google.com&quot;)</li>
                          </ol>
                        )}
                        {result.details?.errorCode === 403 && (
                          <ol className="list-decimal list-inside space-y-1">
                            <li>Go to Google Calendar settings</li>
                            <li>Find your calendar and click &quot;Settings and sharing&quot;</li>
                            <li>Under &quot;Share with specific people&quot;, add the service account email</li>
                            <li>Grant &quot;Make changes to events&quot; permission</li>
                            <li>The service account email is shown in the Google Cloud Console</li>
                          </ol>
                        )}
                        {!result.configStatus?.isConfigured && (
                          <div>
                            <p className="mb-2">Set these environment variables in .env.local:</p>
                            <ul className="list-disc list-inside space-y-1">
                              <li>GOOGLE_CALENDAR_ID (required)</li>
                              <li>GOOGLE_SERVICE_ACCOUNT_KEY (recommended)</li>
                              <li>Or: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN</li>
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Debug Instructions</h2>
        </div>
        <div className="px-4 py-5 sm:p-6 space-y-4">
          <div>
            <h3 className="font-medium mb-2">1. Check Browser Console</h3>
            <p className="text-sm text-gray-600">
              Open Developer Tools (F12) and check the Console tab for detailed logging when creating/updating bookings.
            </p>
          </div>
          
          <div>
            <h3 className="font-medium mb-2">2. Run Debug Script</h3>
            <p className="text-sm text-gray-600 mb-2">
              From the terminal, run:
            </p>
            <code className="block bg-gray-100 p-2 rounded text-xs">
              npm run tsx scripts/debug-google-calendar.ts
            </code>
          </div>
          
          <div>
            <h3 className="font-medium mb-2">3. Check Server Logs</h3>
            <p className="text-sm text-gray-600">
              Look for logs starting with [Google Calendar] in your server console when creating bookings.
            </p>
          </div>
          
          <div>
            <h3 className="font-medium mb-2">4. Verify Calendar Events</h3>
            <p className="text-sm text-gray-600">
              After creating a booking, check the database to see if calendar_event_id is populated:
            </p>
            <code className="block bg-gray-100 p-2 rounded text-xs">
              SELECT id, customer_name, calendar_event_id FROM private_bookings ORDER BY created_at DESC LIMIT 5;
            </code>
          </div>
        </div>
      </div>
    </div>
  )
}