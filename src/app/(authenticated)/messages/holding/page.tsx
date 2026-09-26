import { redirect } from 'next/navigation'
import { PageLayout, Alert, Card, CardBody, Badge, Empty } from '@/ds'
import { CommunicationsService } from '@/services/communications'
import { checkUserPermission } from '@/app/actions/rbac'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import { HoldingQueueActions } from './_components/HoldingQueueActions'
import { MESSAGE_ATTACHMENT_BADGE_TONE, MESSAGE_CHANNEL_BADGE_TONE } from '../_shared/status-ui'

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
    <PageLayout
      title="Holding Queue"
      subtitle={error ? undefined : `${rows.length} unmatched communication${rows.length === 1 ? '' : 's'}`}
      backButton={{ label: 'Back to Messages', href: '/messages' }}
    >
      {error ? (
        <Alert tone="danger" title="Could not load the holding queue">{error}</Alert>
      ) : rows.length === 0 ? (
        <Card>
          <CardBody>
            <Empty size="sm" icon="inbox" title="No unmatched communications" />
          </CardBody>
        </Card>
      ) : (
        <Card padding="none">
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="p-pad-card">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone={MESSAGE_CHANNEL_BADGE_TONE}>{channelLabel(row.channel)}</Badge>
                    {Array.isArray(row.attachments) && row.attachments.length > 0 && (
                      <Badge tone={MESSAGE_ATTACHMENT_BADGE_TONE}>Attachment</Badge>
                    )}
                    <span className="text-xs text-text-muted">
                      {formatDateTimeInLondon(row.received_at)}
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
                </li>
              ))}
            </ul>
        </Card>
      )}
    </PageLayout>
  )
}
