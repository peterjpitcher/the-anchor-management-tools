'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, Info, Loader2 } from 'lucide-react'
// New UI components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
// Code component not implemented yet - using pre tag instead

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
    <Page 
      title="Google Calendar Test"
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Calendar Test' }
      ]}
    >
      
      <Section 
        title="Test Calendar Connection"
        description="This tool helps diagnose Google Calendar integration issues."
      >
        <Card>
          <Button 
            onClick={testConnection} 
            disabled={loading}
            loading={loading}
            variant="primary"
            className="mb-4"
          >
            Test Connection
          </Button>
          
          {result && (
            <div className="space-y-4">
              {/* Status Alert */}
              <Alert variant={result.success ? 'success' : 'error'}
                title={result.success ? 'Success' : 'Failed'}
                
                icon={result.success ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              />
              
              {/* Configuration Status */}
              {result.configStatus && (
                <Card>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Configuration Status</h3>
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
                </Card>
              )}
              
              {/* Details */}
              {result.details && (
                <Card>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Details</h3>
                  <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                    <code>{JSON.stringify(result.details, null, 2)}</code>
                  </pre>
                </Card>
              )}
              
              {/* Setup Instructions */}
              {!result.success && (
                <Alert variant="info"
                  title="Setup Instructions"
                  description="To fix this issue:"
                  icon={<Info className="h-5 w-5" />}
                >
                  <div className="mt-2 space-y-2">
                    {result.details?.errorCode === 404 && (
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Check that GOOGLE_CALENDAR_ID is correct in your .env.local</li>
                        <li>Use either "primary" or the full calendar ID (e.g., "calendar-id@group.calendar.google.com")</li>
                      </ol>
                    )}
                    {result.details?.errorCode === 403 && (
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Go to Google Calendar settings</li>
                        <li>Find your calendar and click "Settings and sharing"</li>
                        <li>Under "Share with specific people", add the service account email</li>
                        <li>Grant "Make changes to events" permission</li>
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
                
            {result.message}</Alert>
              )}
            </div>
          )}
        </Card>
      </Section>
      
      <Section title="Debug Instructions">
        <Card>
          <div className="space-y-4">
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
              <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>npm run tsx scripts/debug-google-calendar.ts</code>
              </pre>
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
              <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>SELECT id, customer_name, calendar_event_id FROM private_bookings ORDER BY created_at DESC LIMIT 5;</code>
              </pre>
            </div>
          </div>
        </Card>
      </Section>
    </Page>
  )
}