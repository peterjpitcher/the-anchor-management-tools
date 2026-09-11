/**
 * Which private booking texts go straight out and which wait for staff approval. A trigger absent
 * from this set is queued as `pending` and only leaves when a member of staff presses Send Now.
 *
 * Kept free of imports so the text queue (src/services/sms-queue.ts), the email-first messenger
 * and the bounce fallback all read the one rule without pulling in each other's dependencies.
 */
const PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS = new Set<string>([
  'booking_created',
  'deposit_received',
  'final_payment_received',
  'payment_received',
  'booking_confirmed',
  'booking_completed',
  'date_changed',
  // A moved balance deadline must reach the customer without waiting on
  // manual approval: the same corrective class as 'date_changed'.
  'balance_due_date_changed',
  // Retained for backward compatibility with historical queue rows. New
  // cancellation writes use the four variant triggers below.
  'booking_cancelled',
  'booking_cancelled_hold',
  'booking_cancelled_refundable',
  'booking_cancelled_non_refundable',
  'booking_cancelled_manual_review',
  'booking_expired',
  'hold_extended',
  'deposit_reminder_7day',
  'deposit_reminder_1day',
  'balance_reminder_14day',
  'balance_reminder_7day',
  'balance_reminder_1day',
  'event_reminder_1d',
  'setup_reminder',
  'post_event_followup',
  'review_request',
  'manual',
]);

/** False for a trigger whose text waits for staff approval. */
export function shouldAutoSendPrivateBookingSms(triggerType: string): boolean {
  return PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS.has(triggerType);
}
