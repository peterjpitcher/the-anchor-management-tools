import { PageHeader, Card, CardBody, Badge, Button, Input } from '@/ds'
import { CommunicationsService } from '@/services/communications'
import {
  ignoreUnmatchedCommunicationAction,
  linkUnmatchedCommunicationAction,
} from '@/app/actions/communications'

export const dynamic = 'force-dynamic'

function previewText(row: any): string {
  const subject = typeof row.subject === 'string' ? row.subject.trim() : ''
  const body = typeof row.body_text === 'string' ? row.body_text.trim() : ''
  const value = subject || body || 'No body'
  return value.length > 160 ? `${value.slice(0, 160)}...` : value
}

function channelLabel(channel: string): string {
  if (channel === 'sms') return 'SMS'
  if (channel === 'whatsapp') return 'WhatsApp'
  if (channel === 'email') return 'Email'
  return channel
}

export default async function HoldingQueuePage() {
  let rows: any[] = []
  let error: string | null = null

  async function linkAction(formData: FormData): Promise<void> {
    'use server'
    await linkUnmatchedCommunicationAction(formData)
  }

  async function ignoreAction(formData: FormData): Promise<void> {
    'use server'
    await ignoreUnmatchedCommunicationAction(formData)
  }

  try {
    rows = await CommunicationsService.getUnmatchedCommunications()
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Failed to load holding queue'
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Messages', href: '/messages' },
          { label: 'Holding queue' },
        ]}
        title="Holding Queue"
        subtitle={`${rows.length} unmatched communication${rows.length === 1 ? '' : 's'}`}
      />

      <Card>
        <CardBody className="space-y-4">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-text-muted">No unmatched communications.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="rounded border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone="info">{channelLabel(row.channel)}</Badge>
                    {Array.isArray(row.attachments) && row.attachments.length > 0 && (
                      <Badge tone="neutral">Attachment</Badge>
                    )}
                    <span className="text-xs text-text-muted">
                      {new Date(row.received_at).toLocaleString('en-GB')}
                    </span>
                  </div>
                  <div className="grid gap-1 text-sm md:grid-cols-2">
                    <p><span className="font-medium">From:</span> {row.from_address ?? 'Unknown'}</p>
                    <p><span className="font-medium">To:</span> {row.to_address ?? 'Unknown'}</p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-text">{previewText(row)}</p>
                  {Array.isArray(row.candidate_customer_ids) && row.candidate_customer_ids.length > 0 && (
                    <p className="mt-2 text-xs text-text-muted">
                      Candidate customers: {row.candidate_customer_ids.join(', ')}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <form action={linkAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="unmatchedId" value={row.id} />
                      <Input name="customerId" label="Customer ID" placeholder="Paste customer ID" required />
                      <Button type="submit" size="sm">Link</Button>
                    </form>
                    <form action={ignoreAction}>
                      <input type="hidden" name="unmatchedId" value={row.id} />
                      <Button type="submit" variant="ghost" size="sm">Ignore</Button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
