/**
 * The delivery status of a text or an email, as a DS Badge: one tone and one set of words for
 * every screen that shows one. Pure module, safe to import from server and client components.
 *
 * Before 26 September 2026 three screens each had their own copy and they disagreed: the event
 * page (its own tone map in events/_shared/status-ui.ts, since removed), the private booking
 * Communications tab (its own statusTone and emailStatusTone) and the marketing recipient list
 * (a map in marketing/_shared/marketing-ui.tsx), all since replaced by this one. An email marked "sent" was info
 * on one and a text marked "sent" success on the others; "pending" was info on one and neutral on
 * another. Render every delivery chip as
 *   <Badge tone={messageDeliveryStatusTone(status)}>{messageDeliveryStatusLabel(status)}</Badge>
 *
 * The meanings, one tone per status:
 * - on its way (pending, approved, queued, accepted, scheduled, sending): info.
 * - handed over or better (sent, delivered, read, opened, clicked): success. "Sent" is the last
 *   status most texts and every marketing email ever reach, so it reads as done.
 * - held up but not lost (delivery_delayed) or waiting for a person (needs_review): warning.
 * - did not arrive (failed, undelivered, bounced, complained, suppressed): danger.
 * - never going to be sent, or not a send at all (cancelled, skipped, received): neutral.
 *
 * Keys are the stored values: Twilio's message statuses (messages.status), the private booking
 * SMS queue (pending, approved, sent, cancelled, failed), the email log (EmailMessageStatus in
 * src/lib/email/logging.ts) and marketing recipients (MarketingRecipientStatus).
 */

export type MessageDeliveryStatus =
  | 'pending'
  | 'approved'
  | 'queued'
  | 'accepted'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'opened'
  | 'clicked'
  | 'delivery_delayed'
  | 'needs_review'
  | 'failed'
  | 'undelivered'
  | 'bounced'
  | 'complained'
  | 'suppressed'
  | 'cancelled'
  | 'skipped'
  | 'received'

export type MessageDeliveryTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export const MESSAGE_DELIVERY_STATUS_TONE: Readonly<Record<MessageDeliveryStatus, MessageDeliveryTone>> = {
  pending: 'info',
  approved: 'info',
  queued: 'info',
  accepted: 'info',
  scheduled: 'info',
  sending: 'info',
  sent: 'success',
  delivered: 'success',
  read: 'success',
  opened: 'success',
  clicked: 'success',
  delivery_delayed: 'warning',
  needs_review: 'warning',
  failed: 'danger',
  undelivered: 'danger',
  bounced: 'danger',
  complained: 'danger',
  suppressed: 'danger',
  cancelled: 'neutral',
  skipped: 'neutral',
  received: 'neutral',
}

/**
 * Sentence case, plain words. "Waiting" is the marketing list's word for a send that has not gone
 * yet, "Not delivered" the Messages inbox's word for a text the network gave up on, and
 * "Marked as spam" says what a complaint is.
 */
export const MESSAGE_DELIVERY_STATUS_LABEL: Readonly<Record<MessageDeliveryStatus, string>> = {
  pending: 'Waiting',
  approved: 'Approved',
  queued: 'Queued',
  accepted: 'Accepted',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  opened: 'Opened',
  clicked: 'Clicked',
  delivery_delayed: 'Delayed',
  needs_review: 'Needs review',
  failed: 'Failed',
  undelivered: 'Not delivered',
  bounced: 'Bounced',
  complained: 'Marked as spam',
  suppressed: 'Suppressed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  received: 'Received',
}

function deliveryStatusKey(status: string | null | undefined): MessageDeliveryStatus | null {
  const key = (status ?? '').trim().toLowerCase()
  // hasOwnProperty, so a status such as "constructor" never resolves to an inherited property.
  return Object.prototype.hasOwnProperty.call(MESSAGE_DELIVERY_STATUS_TONE, key) ? (key as MessageDeliveryStatus) : null
}

/** The Badge tone for a delivery status, matched without regard to case. Anything unknown is neutral. */
export function messageDeliveryStatusTone(status: string | null | undefined): MessageDeliveryTone {
  const key = deliveryStatusKey(status)
  return key ? MESSAGE_DELIVERY_STATUS_TONE[key] : 'neutral'
}

/** The words for a delivery status. An unknown value is shown as stored, tidied, so nothing renders blank. */
export function messageDeliveryStatusLabel(status: string | null | undefined): string {
  const key = deliveryStatusKey(status)
  if (key) return MESSAGE_DELIVERY_STATUS_LABEL[key]
  const raw = (status ?? '').trim().replace(/_/g, ' ')
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unknown'
}
