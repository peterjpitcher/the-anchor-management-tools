'use client'

import { useState } from 'react'
import { importMissedMessages } from '@/app/actions/import-messages'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'

interface ImportSummary {
  totalFound: number;
  inboundMessages: number;
  outboundMessages: number;
  alreadyInDatabase: number;
  imported: number;
  failed: number;
}

type ImportResult =
  | { success: true; summary: ImportSummary; errors?: string[] }
  | { error: string }

interface ImportMessagesClientProps {
  canManage: boolean;
  defaultStartDate: string;
  defaultEndDate: string;
}

export default function ImportMessagesClient({
  canManage,
  defaultStartDate,
  defaultEndDate,
}: ImportMessagesClientProps) {
  const [startDate, setStartDate] = useState(defaultStartDate)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function handleImport() {
    if (!canManage) {
      setResult({ error: 'You do not have permission to import messages.' })
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const response = await importMissedMessages(startDate, endDate)
      setResult(response)
    } catch (error) {
      setResult({
        error: `Import failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      })
    } finally {
      setLoading(false)
    }
  }

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Import Messages' },
  ]

  return (
    <PageLayout
      title="Import Missed Messages from Twilio"
      breadcrumbs={breadcrumbs}
      loading={loading}
      loadingLabel="Importing messages..."
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <Section>
        <div className="space-y-4">
          <Alert
            variant="warning"
            title="About this tool"
            description="Imports inbound and outbound SMS from Twilio for the selected window. Existing records are skipped automatically."
          />

          {!canManage && (
            <Alert
              variant="info"
              title="Read-only access"
              description="You can review import results, but only users with the messages manage permission can run imports."
            />
          )}
        </div>

        <Card className="mt-6">
          <div className="space-y-4">
            <FormGroup label="Start Date" htmlFor="startDate">
              <Input
                type="date"
                id="startDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading || !canManage}
              />
            </FormGroup>

            <FormGroup label="End Date" htmlFor="endDate">
              <Input
                type="date"
                id="endDate"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={loading || !canManage}
              />
            </FormGroup>
          </div>

          <div className="mt-6">
            <Button
              onClick={handleImport}
              disabled={loading || !canManage}
              loading={loading}
              variant="primary"
            >
              {loading ? 'Importing...' : 'Import Messages'}
            </Button>
          </div>
        </Card>

        {result && (
          <Card className="mt-6 space-y-4">
            {'error' in result ? (
              <Alert
                variant="error"
                title="Import Failed"
                description={result.error}
              />
            ) : (
              <>
                <Alert
                  variant="success"
                  title="Import Complete"
                  description="Messages were reconciled with Twilio successfully."
                />
                <div className="space-y-2 text-sm">
                  <p>
                    Total messages found:{' '}
                    <strong>{result.summary.totalFound}</strong>
                  </p>
                  <p>
                    Inbound messages:{' '}
                    <strong>{result.summary.inboundMessages}</strong>
                  </p>
                  <p>
                    Outbound messages:{' '}
                    <strong>{result.summary.outboundMessages}</strong>
                  </p>
                  <p>
                    Already in database:{' '}
                    <strong>{result.summary.alreadyInDatabase}</strong>
                  </p>
                  <p>
                    Successfully imported:{' '}
                    <strong className="text-green-600">
                      {result.summary.imported}
                    </strong>
                  </p>
                  {result.summary.failed > 0 && (
                    <p>
                      Failed to import:{' '}
                      <strong className="text-red-600">
                        {result.summary.failed}
                      </strong>
                    </p>
                  )}
                </div>

                {result.errors && result.errors.length > 0 && (
                  <Alert
                    variant="error"
                    title="Errors occurred during import"
                  >
                    <ul className="list-disc list-inside space-y-1 mt-2">
                      {result.errors.map((errorMessage, index) => (
                        <li key={index}>{errorMessage}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
              </>
            )}
          </Card>
        )}

        <Card className="mt-8">
          <h3 className="text-base font-semibold mb-3">How this works</h3>
          <ul className="list-disc list-inside space-y-2 text-sm text-gray-600">
            <li>
              Fetches all messages (inbound and outbound) from your Twilio
              account within the date range.
            </li>
            <li>Imports both messages you sent and messages you received.</li>
            <li>Skips messages that already exist in the database.</li>
            <li>Creates new customers for unknown phone numbers.</li>
            <li>Preserves the original timestamp from when the message was sent.</li>
            <li>Calculates outbound message cost estimates for reporting.</li>
          </ul>
        </Card>
      </Section>
    </PageLayout>
  )
}
