'use client'

import { useState } from 'react'
import { importMissedMessages } from '@/app/actions/import-messages'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormFooter,
  Input,
  PageLayout,
  Stat,
  StatGrid,
} from '@/ds'

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

  return (
    <PageLayout
      title="Import Messages"
      subtitle="Missed SMS messages from your Twilio account"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      containerSize="md"
    >
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

      <Card>
        <CardHeader title="Date Range" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
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

          <FormFooter>
            <Button
              onClick={handleImport}
              disabled={loading || !canManage}
              loading={loading}
              variant="primary"
            >
              {loading ? 'Importing...' : 'Import Messages'}
            </Button>
          </FormFooter>
        </CardBody>
      </Card>

      {result && ('error' in result ? (
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

          <StatGrid columns={3}>
            <Stat label="Total messages found" value={result.summary.totalFound} />
            <Stat label="Inbound messages" value={result.summary.inboundMessages} />
            <Stat label="Outbound messages" value={result.summary.outboundMessages} />
            <Stat label="Already in database" value={result.summary.alreadyInDatabase} />
            <Stat label="Successfully imported" value={result.summary.imported} tone="success" />
            {result.summary.failed > 0 && (
              <Stat label="Failed to import" value={result.summary.failed} tone="danger" />
            )}
          </StatGrid>

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
      ))}

      <Card>
        <CardHeader title="How This Works" />
        <CardBody>
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
        </CardBody>
      </Card>
    </PageLayout>
  )
}
