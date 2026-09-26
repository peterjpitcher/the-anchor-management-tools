import Link from 'next/link'
import { Alert, Badge, Card, CardBody, CustomerLink, Empty, Section } from '@/ds'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import type { UndeliveredGuestMessage } from '@/lib/notifications/undelivered'
import { messageDeliveryStatusLabel, messageDeliveryStatusTone } from '@/lib/messages/status-ui'

function describeAttempts(row: UndeliveredGuestMessage): string {
  if (row.attempts.length === 0) return 'No attempt recorded'
  return row.attempts
    .map((attempt) => `${attempt.channel === 'sms' ? 'Text' : attempt.channel === 'email' ? 'Email' : attempt.channel}: ${attempt.error ?? 'sent, then undelivered'}`)
    .join('; ')
}

/**
 * Booking messages that reached the guest by no channel at all. Each row needs a person to get in
 * touch another way; nothing here retries on its own.
 */
export function UndeliveredGuestMessagesSection({
  rows,
  error,
}: {
  rows: UndeliveredGuestMessage[]
  error: string | null
}) {
  return (
    <Section
      title="Undelivered Guest Messages"
      description="Booking messages that reached the guest by neither email nor text. Contact these guests another way."
    >
      <Card padding="none">
        {error ? (
          <CardBody>
            <Alert tone="danger">Failed to load undelivered guest messages: {error}</Alert>
          </CardBody>
        ) : rows.length === 0 ? (
          <Empty size="sm" title="No undelivered guest messages for this period" />
        ) : (
          <ul className="divide-y divide-border" aria-label="Undelivered guest messages">
            {rows.map((row) => (
              <li key={row.id} className="px-pad-card py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CustomerLink customerId={row.customerId} name={row.customerName} className="font-medium" />
                    <Badge tone={messageDeliveryStatusTone('undelivered')}>{messageDeliveryStatusLabel('undelivered')}</Badge>
                  </div>
                  <time className="text-xs text-text-muted" dateTime={row.failedAt}>
                    {formatDateTime12Hour(row.failedAt)}
                  </time>
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-text-muted">Message</dt>
                    <dd>{row.templateKey}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-text-muted">Why</dt>
                    <dd>{row.reason}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-text-muted">Attempts</dt>
                    <dd className="text-text-muted">{describeAttempts(row)}</dd>
                  </div>
                  {row.booking && (
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-text-muted">Booking</dt>
                      <dd>
                        <Link href={row.booking.href} className="text-primary hover:underline">
                          {row.booking.label}
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  )
}
