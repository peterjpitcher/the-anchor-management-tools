'use client'

import { useState } from 'react'
import { importMissedMessages } from '@/app/actions/import-messages'
import { PageLayout } from '@/ds'
import { Section } from '@/ds'
import { Card } from '@/ds'
import { Field } from '@/ds'
import { Input } from '@/ds'
import { Button } from '@/ds'
import { Alert } from '@/ds'

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
            tone="warning"
            title="About this tool"
          >
            Imports inbound and outbound SMS from Twilio for the selected window. Existing records are skipped automatically.
          </Alert>

          {!canManage && (
            <Alert
              tone="info"
              title="Read-only access"
            >
              You can review import results, but only users with the messages manage permission can run imports.
            </Alert>
          )}
        </div>

        <Card className="mt-6">
          <div className="space-y-4">
            <Field label="Start Date" htmlFor="startDate">
              <Input
                type="date"
                id="startDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading || !canManage}
              />
            </Field>

            <Field label="End Date" htmlFor="endDate">
              <Input
                type="date"
                id="endDate"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={loading || !canManage}
              />
            </Field>
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
          <Card className="mt-6">
            {/* The spacing sits inside the Card's padded wrapper; on the Card itself it had
                nothing to space, so the summary sat hard against the alert above it. */}
            <div className="space-y-4">
            {'error' in result ? (
              <Alert
                tone="danger"
                title="Import Failed"
              >
                {result.error}
              </Alert>
            ) : (
              <>
                <Alert
                  tone="success"
                  title="Import Complete"
                >
                  Messages were reconciled with Twilio successfully.
                </Alert>
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
                    <strong className="text-success-fg">
                      {result.summary.imported}
                    </strong>
                  </p>
                  {result.summary.failed > 0 && (
                    <p>
                      Failed to import:{' '}
                      <strong className="text-danger">
                        {result.summary.failed}
                      </strong>
                    </p>
                  )}
                </div>

                {result.errors && result.errors.length > 0 && (
                  <Alert
                    tone="danger"
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
            </div>
          </Card>
        )}

        <Card className="mt-8">
          <h3 className="text-base font-semibold mb-3">How this works</h3>
          <ul className="list-disc list-inside space-y-2 text-sm text-text-muted">
            <li>
              Fetches all messages (inbound and outbound) from your Twilio
              account within the date range.
            </li>
            <li>Imports both messages you sent and messages you received.</li>
            <li>Skips messages that already exist in the database.</li>
            <li>
              Creates placeholder customers for unknown phone numbers (SMS is deactivated by default).
            </li>
            <li>Preserves the original timestamp from when the message was sent.</li>
            <li>Calculates outbound message cost estimates for reporting.</li>
          </ul>
        </Card>
      </Section>
    </PageLayout>
  )
}
