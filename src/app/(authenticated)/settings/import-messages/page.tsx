'use client'

import { useState } from 'react'
import { importMissedMessages } from '@/app/actions/import-messages'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'

export default function ImportMessagesPage() {
  const [startDate, setStartDate] = useState('2025-06-18')
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ error?: string; success?: boolean; summary?: { totalFound: number; inboundMessages: number; outboundMessages: number; alreadyInDatabase: number; imported: number; failed: number }; errors?: string[] } | null>(null)

  async function handleImport() {
    setLoading(true)
    setResult(null)
    
    try {
      const response = await importMissedMessages(startDate, endDate)
      setResult(response)
    } catch (error) {
      setResult({ error: 'Import failed: ' + error })
    } finally {
      setLoading(false)
    }
  }

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Import Messages' }
  ]

  return (
    <Page
      title="Import Missed Messages from Twilio"
      breadcrumbs={breadcrumbs}
      loading={false}
    >
      <Section>
        <Alert
          variant="warning"
          title="Note"
          
          className="mb-6"
        />

        <Card>
          <div className="space-y-4">
            <FormGroup
              label="Start Date"
              htmlFor="startDate"
            >
              <Input
                type="date"
                id="startDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading}
              />
            </FormGroup>

            <FormGroup
              label="End Date"
              htmlFor="endDate"
            >
              <Input
                type="date"
                id="endDate"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={loading}
              />
            </FormGroup>
          </div>

          <div className="mt-6">
            <Button
              onClick={handleImport}
              disabled={loading}
              loading={loading}
              variant="primary"
            >
              {loading ? 'Importing...' : 'Import Messages'}
            </Button>
          </div>
        </Card>

        {result && (
          <Card className="mt-6">
            {result.error ? (
              <Alert variant="error"
                title="Import Failed"
                description={result.error}
              />
            ) : (
              <>
                <Alert
                  variant="success"
                  title="Import Complete"
                  className="mb-4"
                />
                <div className="space-y-2 text-sm">
                  <p>Total messages found: <strong>{result.summary?.totalFound}</strong></p>
                  <p>Inbound messages: <strong>{result.summary?.inboundMessages}</strong></p>
                  <p>Outbound messages: <strong>{result.summary?.outboundMessages}</strong></p>
                  <p>Already in database: <strong>{result.summary?.alreadyInDatabase}</strong></p>
                  <p>Successfully imported: <strong className="text-green-600">{result.summary?.imported}</strong></p>
                  {result.summary && result.summary.failed > 0 && (
                    <p>Failed to import: <strong className="text-red-600">{result.summary.failed}</strong></p>
                  )}
                </div>
                
                {result.errors && result.errors.length > 0 && (
                  <Alert
                    variant="error"
                    title="Errors occurred during import"
                    className="mt-4"
                  >
                    <ul className="list-disc list-inside space-y-1 mt-2">
                      {result.errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  
            This will import all SMS messages (both inbound and outbound) from Twilio that are not already in the database. Messages will be matched to existing customers or new customers will be created for unknown numbers.</Alert>
                )}
              </>
            )}
          </Card>
        )}

        <Card className="mt-8">
          <h3 className="text-base font-semibold mb-3">How this works</h3>
          <ul className="list-disc list-inside space-y-2 text-sm text-gray-600">
            <li>Fetches all messages (inbound and outbound) from your Twilio account within the date range</li>
            <li>Imports both messages you sent and messages you received</li>
            <li>Skips messages that already exist in the database</li>
            <li>Creates new customers for unknown phone numbers</li>
            <li>Preserves the original timestamp from when the message was sent</li>
            <li>Calculates cost estimates for outbound messages</li>
          </ul>
        </Card>
      </Section>
    </Page>
  )
}