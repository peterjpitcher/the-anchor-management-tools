/**
 * Turns a `sendSmsReply` result into what staff should be told.
 *
 * The send path has five distinct successful-looking outcomes and the inbox
 * used to call all of them "Message sent":
 *
 *  - sent or queued to Twilio, which is the normal case;
 *  - deferred to the job queue because of quiet hours, which returns
 *    `success: true, status: 'scheduled', deferred: true` and sends nothing
 *    until the morning;
 *  - suppressed as a duplicate inside the idempotency window, which sends
 *    nothing at all;
 *  - sent but with the audit log write failed, so there is no record of it;
 *  - a plain failure.
 *
 * Telling a staff member a customer has been replied to when the message is
 * queued for 8am is the kind of thing that gets a booking lost, so each outcome
 * gets its own message and only a real send clears the draft.
 */

export type SendReplyResult = {
  error?: string
  success?: boolean
  suppressed?: boolean
  suppressionReason?: string | null
  deferred?: boolean
  scheduledFor?: string | null
  status?: string | null
  logFailure?: boolean
}

export type SendOutcome = {
  kind: 'sent' | 'scheduled' | 'suppressed' | 'logged_failure' | 'error'
  tone: 'success' | 'warning' | 'error'
  message: string
  /** Only a genuine handover to the carrier should empty the composer. */
  clearsDraft: boolean
}

function formatScheduledFor(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
    timeZone: 'Europe/London',
  })
}

export function interpretSendResult(result: SendReplyResult | null | undefined): SendOutcome {
  if (!result) {
    return { kind: 'error', tone: 'error', message: 'Failed to send message', clearsDraft: false }
  }

  if (result.error) {
    return { kind: 'error', tone: 'error', message: result.error, clearsDraft: false }
  }

  if (result.suppressed) {
    return {
      kind: 'suppressed',
      tone: 'error',
      message: 'Not sent: identical to a recent message. Change the wording and try again.',
      clearsDraft: false,
    }
  }

  if (result.success !== true) {
    return { kind: 'error', tone: 'error', message: 'Failed to send message', clearsDraft: false }
  }

  if (result.deferred || result.status === 'scheduled') {
    const when = formatScheduledFor(result.scheduledFor)
    return {
      kind: 'scheduled',
      tone: 'warning',
      message: when
        ? `Scheduled, not sent yet. Quiet hours are on, so this goes out ${when}.`
        : 'Scheduled, not sent yet. Quiet hours are on, so this goes out when they end.',
      clearsDraft: true,
    }
  }

  if (result.logFailure) {
    return {
      kind: 'logged_failure',
      tone: 'warning',
      message: 'Sent, but it could not be recorded against the customer. Tell a manager.',
      clearsDraft: true,
    }
  }

  return { kind: 'sent', tone: 'success', message: 'Message sent', clearsDraft: true }
}
