'use client'

import type { ScheduledSmsPreview, ScheduledSmsSuppressionReason } from '@/services/private-bookings/scheduled-sms'
import { Alert, Badge, Card, CardBody, CardHeader, Empty, Icon } from '@/ds'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { SCHEDULED_REMINDER_TONE } from '@/app/(authenticated)/private-bookings/_shared/status-ui'

export type CommunicationsHistoryRow = {
  id: string
  created_at: string
  trigger_type: string | null
  template_key: string | null
  status: string
  message_body: string | null
  twilio_sid: string | null
  scheduled_for: string | null
  /** 'email' when Send Now delivered this approved text as an email instead. */
  delivered_by?: 'email' | null
}

export type CommunicationsEmailRow = {
  id: string
  created_at: string
  comm_type: string | null
  subject: string | null
  status: string
  to_address: string | null
  error: string | null
}

const UNDELIVERED_EMAIL_STATUSES = new Set(['bounced', 'complained', 'failed', 'suppressed'])

function emailStatusTone(status: string): StatusTone {
  if (UNDELIVERED_EMAIL_STATUSES.has(status)) return 'danger'
  if (status === 'delivered' || status === 'opened' || status === 'clicked') return 'success'
  if (status === 'sent' || status === 'queued') return 'info'
  return 'neutral'
}

type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

function statusTone(status: string): StatusTone {
  switch (status) {
    case 'sent':
      return 'success'
    case 'approved':
    case 'pending':
      return 'info'
    case 'failed':
      return 'danger'
    case 'cancelled':
      return 'neutral'
    default:
      return 'neutral'
  }
}

function statusLabel(status: string): string {
  if (!status) return 'Unknown'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function labelForSuppression(reason: ScheduledSmsSuppressionReason): string {
  switch (reason) {
    case 'feature_flag_disabled':
      return "Won't send — feature disabled in production."
    case 'date_tbd':
      return 'No date-based reminders — booking date is TBD.'
    case 'already_sent':
      return 'Already sent this cycle.'
    case 'stop_opt_out':
      return 'Customer has opted out of SMS.'
    case 'policy_skip':
      return 'Policy: no reminder for this case.'
    default:
      return reason
  }
}

export function CommunicationsTab({
  history,
  scheduled,
  isDateTbd,
  emails = [],
  emailsError = null,
  historyError = null,
}: {
  history: CommunicationsHistoryRow[]
  scheduled: ScheduledSmsPreview[]
  isDateTbd: boolean
  emails?: CommunicationsEmailRow[]
  emailsError?: string | null
  /** A failed read of the SMS history: shown as an error, never as "no messages". */
  historyError?: string | null
}) {
  // Three cards, passed straight to the page's PageLayout, which spaces them.
  return (
    <>
      <Card>
        <CardHeader
          title="History"
          subtitle="Messages already sent or queued for this booking (most recent first)."
        />
          {historyError ? (
            <CardBody>
              <Alert tone="danger">{`Messages could not be loaded: ${historyError}`}</Alert>
            </CardBody>
          ) : history.length === 0 ? (
            <Empty
              size="sm"
              icon={<Icon name="message" size={40} />}
              title="No messages sent yet"
              description="Once a message is queued or sent, it will appear here."
            />
          ) : (
            <CardBody>
            <ul className="divide-y divide-border" aria-label="SMS message history">
              {history.map((row) => (
                <li key={row.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">
                        {row.trigger_type ?? row.template_key ?? 'Manual'}
                      </span>
                      <Badge tone={statusTone(row.status)} size="sm">
                        {row.delivered_by === 'email' && row.status === 'sent' ? 'Sent by email' : statusLabel(row.status)}
                      </Badge>
                    </div>
                    <time
                      className="text-xs text-text-muted"
                      dateTime={row.created_at}
                    >
                      {formatDateTime12Hour(row.created_at)}
                    </time>
                  </div>
                  {row.message_body && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-text">
                      {row.message_body}
                    </p>
                  )}
                  {row.twilio_sid && row.status === 'sent' && (
                    <p className="mt-1 text-xs text-text-muted">
                      Twilio SID: <code className="font-mono">{row.twilio_sid}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
            </CardBody>
          )}
      </Card>

      <Card>
        <CardHeader
          title="Emails"
          subtitle="Emails sent about this booking (most recent first), with their delivery status."
        />
          {emailsError ? (
            <CardBody>
              <Alert tone="danger">{`Emails could not be loaded: ${emailsError}`}</Alert>
            </CardBody>
          ) : emails.length === 0 ? (
            <Empty
              size="sm"
              icon={<Icon name="mail" size={40} />}
              title="No emails sent yet"
              description="Emails about this booking will appear here."
            />
          ) : (
            <CardBody>
            <ul className="divide-y divide-border" aria-label="Email history">
              {emails.map((email) => (
                <li key={email.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">{email.subject || '(no subject)'}</span>
                      <Badge tone={emailStatusTone(email.status)} size="sm">
                        {statusLabel(email.status)}
                      </Badge>
                    </div>
                    <time className="text-xs text-text-muted" dateTime={email.created_at}>
                      {formatDateTime12Hour(email.created_at)}
                    </time>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {email.comm_type ?? 'email'}
                    {email.to_address ? ` to ${email.to_address}` : ''}
                  </p>
                  {email.error && UNDELIVERED_EMAIL_STATUSES.has(email.status) && (
                    <p className="mt-1 text-xs text-danger-fg">{email.error}</p>
                  )}
                </li>
              ))}
            </ul>
            </CardBody>
          )}
      </Card>

      <Card>
        <CardHeader
          title="Scheduled"
          subtitle="Automated reminders that would fire for this booking based on current eligibility."
        />
          {scheduled.length === 0 ? (
            <Empty
              size="sm"
              icon={<Icon name="clock" size={40} />}
              title={
                isDateTbd
                  ? 'No date-based reminders scheduled'
                  : 'Nothing scheduled'
              }
              description={
                isDateTbd
                  ? 'Booking date is still to be confirmed. Date-based reminders will appear once a firm date is set.'
                  : 'No automated reminders are eligible to fire right now.'
              }
            />
          ) : (
            <CardBody>
            <ul className="divide-y divide-border" aria-label="Scheduled SMS reminders">
              {scheduled.map((item) => {
                const suppressed = Boolean(item.suppression_reason)
                return (
                  <li
                    key={item.trigger_type}
                    className={`py-4 first:pt-0 last:pb-0 ${suppressed ? 'opacity-75' : ''}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">
                          {item.trigger_type}
                        </span>
                        {suppressed ? (
                          <Badge tone={SCHEDULED_REMINDER_TONE.suppressed} size="sm">Suppressed</Badge>
                        ) : (
                          <Badge tone={SCHEDULED_REMINDER_TONE.eligible} size="sm">Eligible</Badge>
                        )}
                      </div>
                      <span className="text-xs text-text-muted">
                        {item.expected_fire_at
                          ? `Fires around ${item.expected_fire_at}`
                          : 'Will not fire'}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-text">
                      {item.preview_body}
                    </p>
                    {item.suppression_reason && (
                      <Alert
                        tone="warning"
                        className="mt-2"
                      >
                        {labelForSuppression(item.suppression_reason)}
                      </Alert>
                    )}
                  </li>
                )
              })}
            </ul>
            </CardBody>
          )}
      </Card>
    </>
  )
}
