'use client'

import type { ScheduledSmsPreview, ScheduledSmsSuppressionReason } from '@/services/private-bookings/scheduled-sms'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { ChatBubbleLeftRightIcon, ClockIcon } from '@heroicons/react/24/outline'

export type CommunicationsHistoryRow = {
  id: string
  created_at: string
  trigger_type: string | null
  template_key: string | null
  status: string
  message_body: string | null
  twilio_sid: string | null
  scheduled_for: string | null
}

type StatusVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary' | 'neutral'

function statusVariant(status: string): StatusVariant {
  switch (status) {
    case 'sent':
      return 'success'
    case 'approved':
    case 'pending':
      return 'info'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'neutral'
    default:
      return 'default'
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
}: {
  history: CommunicationsHistoryRow[]
  scheduled: ScheduledSmsPreview[]
  isDateTbd: boolean
}) {
  return (
    <div className="space-y-8">
      <Section
        id="sms-history"
        title="History"
        description="Messages already sent or queued for this booking (most recent first)."
      >
        <Card>
          {history.length === 0 ? (
            <EmptyState
              icon={<ChatBubbleLeftRightIcon className="h-10 w-10" aria-hidden="true" />}
              title="No messages sent yet"
              description="Once a message is queued or sent, it will appear here."
            />
          ) : (
            <ul className="divide-y divide-gray-200" aria-label="SMS message history">
              {history.map((row) => (
                <li key={row.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {row.trigger_type ?? row.template_key ?? 'Manual'}
                      </span>
                      <Badge variant={statusVariant(row.status)} size="sm">
                        {statusLabel(row.status)}
                      </Badge>
                    </div>
                    <time
                      className="text-xs text-gray-500"
                      dateTime={row.created_at}
                    >
                      {formatDateTime12Hour(row.created_at)}
                    </time>
                  </div>
                  {row.message_body && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                      {row.message_body}
                    </p>
                  )}
                  {row.twilio_sid && row.status === 'sent' && (
                    <p className="mt-1 text-xs text-gray-500">
                      Twilio SID: <code className="font-mono">{row.twilio_sid}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section
        id="sms-scheduled"
        title="Scheduled"
        description="Automated reminders that would fire for this booking based on current eligibility."
      >
        <Card>
          {scheduled.length === 0 ? (
            <EmptyState
              icon={<ClockIcon className="h-10 w-10" aria-hidden="true" />}
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
            <ul className="divide-y divide-gray-200" aria-label="Scheduled SMS reminders">
              {scheduled.map((item) => {
                const suppressed = Boolean(item.suppression_reason)
                return (
                  <li
                    key={item.trigger_type}
                    className={`py-4 first:pt-0 last:pb-0 ${suppressed ? 'opacity-75' : ''}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {item.trigger_type}
                        </span>
                        {suppressed ? (
                          <Badge variant="warning" size="sm">Suppressed</Badge>
                        ) : (
                          <Badge variant="info" size="sm">Eligible</Badge>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">
                        {item.expected_fire_at
                          ? `Fires around ${item.expected_fire_at}`
                          : 'Will not fire'}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                      {item.preview_body}
                    </p>
                    {item.suppression_reason && (
                      <Alert
                        variant="warning"
                        className="mt-2"
                        description={labelForSuppression(item.suppression_reason)}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  )
}
