import { redirect } from 'next/navigation'
import { PageHeader, Card, CardBody, Badge } from '@/ds'
import { CommunicationsService } from '@/services/communications'
import { checkUserPermission } from '@/app/actions/rbac'
import { HoldingQueueActions } from './_components/HoldingQueueActions'

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
  const canViewMessages = await checkUserPermission('messages', 'view')
  if (!canViewMessages) {
    redirect('/unauthorized')
  }

  let rows: any[] = []
  let error: string | null = null

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
                  <HoldingQueueActions
                    unmatchedId={row.id}
                    candidateCustomerIds={Array.isArray(row.candidate_customer_ids) ? row.candidate_customer_ids : []}
                  />
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
