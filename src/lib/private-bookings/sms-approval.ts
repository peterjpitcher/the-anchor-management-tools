/**
 * Which private booking texts go straight out and which wait for staff approval. A trigger absent
 * from this set is queued as `pending` and only leaves when a member of staff presses Send Now, so
 * a new trigger nobody has listed fails safe: it waits rather than sends.
 *
 * Every trigger the app sends today is listed (owner decision D16, 26 October 2026: deposit,
 * balance and cancellation texts send automatically again). When the reminders were renamed in
 * July 2026 the new names were never added here, so the 3-day deposit reminder, the four balance
 * reminders and three cancellation texts waited for an approval nobody gave (BK-064, customer
 * bookings review of 24 October 2026). tests/lib/privateBookingSmsApproval.test.ts fails when a
 * trigger the app uses is missing.
 *
 * Email still goes first: a text leaves only when the booking has no usable email address, or the
 * email fails (src/lib/private-bookings/messenger.ts), and every send respects the SMS kill
 * switches and limits in src/lib/sms/.
 *
 * Kept free of imports so the text queue (src/services/sms-queue.ts), the email-first messenger
 * and the bounce fallback all read the one rule without pulling in each other's dependencies.
 */
const PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS = new Set<string>([
  // Sent when a member of staff presses Confirm deposit: the click is the approval.
  'deposit_request',
  'deposit_received',
  'final_payment_received',
  'booking_confirmed',
  'booking_completed',
  'date_changed',
  // A moved balance deadline must reach the customer without waiting on
  // manual approval: the same corrective class as 'date_changed'.
  'balance_due_date_changed',
  // The six cancellation texts, one per financial outcome (resolveCancellationSmsVariant).
  'booking_cancelled_hold',
  'booking_cancelled_refundable',
  'booking_cancelled_partial_refund',
  'booking_cancelled_retention',
  'booking_cancelled_review_pending',
  'booking_cancelled_manual_review',
  'booking_expired',
  'hold_extended',
  // Deposit reminders, 7, 3 and 1 days before the hold ends (classifyDepositReminderWindow).
  'deposit_reminder_7day',
  'deposit_reminder_3day',
  'deposit_reminder_1day',
  // Balance reminders in the week before the deadline (classifyBalanceReminderWindow).
  'balance_reminder_21day',
  'balance_reminder_16day',
  'balance_reminder_15day',
  'balance_reminder_due',
  'event_reminder_1d',
  'setup_reminder',
  'review_request',
  'manual',
]);

/** False for a trigger whose text waits for staff approval. */
export function shouldAutoSendPrivateBookingSms(triggerType: string): boolean {
  return PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS.has(triggerType);
}
