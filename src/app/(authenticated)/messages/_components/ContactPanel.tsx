'use client'

import { Avatar, Badge, Button } from '@/ds'
import { cn } from '@/lib/utils'
import { getSmsConsentState, SMS_CONSENT_LABEL } from '@/lib/messages/replyEligibility'
import type { CommunicationChannel } from '@/types/communications'

import {
  channelLabel,
  formatCustomerName,
  formatInboxTimestamp,
  type ConversationCustomer,
} from './messagesFormat'

export interface ContactPanelProps {
  customer: ConversationCustomer
  channels: CommunicationChannel[]
  lastMessageAt?: string
  onViewProfile: () => void
  className?: string
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="flex-shrink-0 text-[11px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-[13px] text-text">{children}</dd>
    </div>
  )
}

const CONSENT_TONE = {
  opted_in: 'success',
  opted_out: 'danger',
  // Amber, not green. "We never asked" is not consent, and the server rejects a
  // send in this state, so the panel must not imply the customer is contactable.
  not_recorded: 'warning',
} as const

export function ContactPanel({
  customer,
  channels,
  lastMessageAt,
  onViewProfile,
  className,
}: ContactPanelProps) {
  const name = formatCustomerName(customer)
  const consent = getSmsConsentState(customer.sms_opt_in)

  return (
    <div className={cn('p-4', className)}>
      <div className="flex flex-col items-center text-center">
        <Avatar name={name} size="xl" />
        <h3 className="mt-3 text-sm font-semibold text-text-strong">{name}</h3>
        {channels.length > 0 && (
          <p className="mt-0.5 text-xs text-text-muted">{channels.map(channelLabel).join(' · ')}</p>
        )}
      </div>

      <dl className="mt-4 divide-y divide-border border-y border-border">
        <DetailRow label="Phone">
          {customer.mobile_number ? (
            // A tel: link is the point of this panel on an iPad: staff can ring
            // the customer without leaving the thread.
            <a href={`tel:${customer.mobile_number}`} className="break-all text-primary hover:underline">
              {customer.mobile_number}
            </a>
          ) : (
            <span className="text-text-muted">Not on file</span>
          )}
        </DetailRow>
        <DetailRow label="Email">
          {customer.email ? (
            <a href={`mailto:${customer.email}`} className="break-all text-primary hover:underline">
              {customer.email}
            </a>
          ) : (
            <span className="text-text-muted">Not on file</span>
          )}
        </DetailRow>
        <DetailRow label="SMS">
          <Badge tone={CONSENT_TONE[consent]}>{SMS_CONSENT_LABEL[consent]}</Badge>
        </DetailRow>
        <DetailRow label="WhatsApp">
          {customer.whatsapp_opt_in ? (
            <Badge tone="success">{customer.whatsapp_status ?? 'Active'}</Badge>
          ) : (
            <Badge tone="neutral">Not opted in</Badge>
          )}
        </DetailRow>
        {lastMessageAt && (
          <DetailRow label="Last activity">{formatInboxTimestamp(lastMessageAt)}</DetailRow>
        )}
      </dl>

      <Button variant="secondary" size="md" className="mt-4 w-full justify-center" onClick={onViewProfile}>
        View full profile
      </Button>
    </div>
  )
}
