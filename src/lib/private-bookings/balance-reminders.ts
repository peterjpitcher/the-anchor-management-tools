/**
 * Balance reminders by email (owner decision, 11 September 2026; messaging flag
 * private_booking_balance_email_auto): "send them by email automatically from now on, don't send
 * historic ones".
 *
 * While the flag is on, every balance reminder the monitor queues carries this marker in its
 * metadata. A balance reminder row without it was queued before the switch (the backlog that has
 * waited for approval since July) and is never sent: Approve and Send Now refuse it. This does
 * not depend on those rows being cancelled in the database, and with the flag off nothing here
 * applies.
 *
 * Kept free of imports so the text queue can read it without pulling anything else in.
 */
export const BALANCE_REMINDER_EMAIL_AUTO_MARKER = 'balance_email_auto'

/** Every balance reminder trigger, the current four and the older three that may still be queued. */
const BALANCE_REMINDER_TRIGGERS = new Set<string>([
  'balance_reminder_21day',
  'balance_reminder_16day',
  'balance_reminder_15day',
  'balance_reminder_due',
  'balance_reminder_14day',
  'balance_reminder_7day',
  'balance_reminder_1day',
])

export function isBalanceReminderTrigger(triggerType: string | null | undefined): boolean {
  return typeof triggerType === 'string' && BALANCE_REMINDER_TRIGGERS.has(triggerType)
}

/** A queued balance reminder from before the switch: never to be sent once the flag is on. */
export function isHistoricBalanceReminderRow(row: {
  trigger_type?: string | null
  metadata?: Record<string, unknown> | null
}): boolean {
  if (!isBalanceReminderTrigger(row.trigger_type)) return false
  return row.metadata?.[BALANCE_REMINDER_EMAIL_AUTO_MARKER] !== true
}

export const HISTORIC_BALANCE_REMINDER_REFUSAL =
  'This balance reminder was queued before balance reminders moved to email, so it will not be sent. Reject it to clear it from the queue.'
