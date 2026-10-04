/**
 * What the invoice page shows about emails: the history of what was sent, and the one line
 * that says what the reminder job will do next.
 *
 * PURE: no database, no clock, no environment. The server action reads the rows and passes
 * them in. The "next reminder" line is worked out with the same rules the job runs
 * (`reminder-rules.ts`), so the page can never promise something the job would not do.
 * See tasks/spec-2026-10-04-invoice-issuing-and-chasing.md (R3).
 */

import { formatDateInLondon, formatDateTimeInLondon, shiftIsoDate } from '@/lib/dateUtils'
import { formatInvoiceDate, type InvoiceEmailKind } from './email-copy'
import { emailMetadata, isInternalInvoiceAlert } from './email-log-rules'
import {
  daysBetween,
  decideReminder,
  describeNeedsOwner,
  forecastNextReminder,
  isWeekday,
  type ReminderContext,
  type ReminderDecision,
  type ReminderInvoice,
  type ReminderStage,
} from './reminder-rules'

/**
 * The app began saving invoice emails to `email_messages` on this date (the communications
 * logging change). Anything sent before it is simply not there.
 */
export const EMAIL_HISTORY_STARTS = '2026-06-25'

/** A row of `email_messages`, as the history action selects it. */
export interface InvoiceEmailRow {
  id: string
  to_address?: string | null
  subject?: string | null
  status?: string | null
  error?: string | null
  created_at?: string | null
  sent_at?: string | null
  body_text?: string | null
  metadata?: unknown
  /** The provider's own id. Only the tracked route (Resend) returns one. */
  resend_message_id?: string | null
}

type InvoiceEmailHistoryKind = InvoiceEmailKind | 'reminder' | 'other'

type InvoiceEmailOutcomeTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface InvoiceEmailHistoryEntry {
  id: string
  /** Date and time on the London clock, ready to show. */
  sentAtLabel: string
  kind: InvoiceEmailHistoryKind
  kindLabel: string
  /** True when the kind was worked out from the subject line because it was not recorded. */
  kindInferred: boolean
  to: string
  /** Who was copied. Null means it was not recorded, which is not the same as nobody. */
  copies: string[] | null
  /**
   * Copied addresses that were left off because they are on the block list (an earlier bounce
   * or complaint). Shown as that, not as a failed email: everyone else still got it.
   */
  droppedCopies: string[]
  outcome: string
  outcomeTone: InvoiceEmailOutcomeTone
  subject: string
  /** The wording as plain text. Shown escaped, never as HTML. */
  body: string | null
}

export interface NextReminderLine {
  line: string
  detail: string | null
}

export interface InvoiceEmailHistory {
  nextReminder: NextReminderLine
  /** The invoice's own record of what was sent, as a cross-check on the list. */
  crossCheck: Array<{ label: string; value: string }>
  /** True when the invoice was emailed before the app began saving emails. */
  earlierEmailsNotRecorded: boolean
  emails: InvoiceEmailHistoryEntry[]
  /** True when there were more emails than the list holds. */
  truncated: boolean
}

const KIND_LABELS: Record<InvoiceEmailHistoryKind, string> = {
  invoice: 'Invoice',
  reminder_first: 'First reminder',
  reminder_second: 'Second reminder',
  reminder: 'Reminder',
  chase: 'Chase',
  receipt: 'Receipt',
  other: 'Email',
}

const RECORDED_KINDS = new Set<string>(['invoice', 'reminder_first', 'reminder_second', 'chase', 'receipt'])

/**
 * The kind of an email saved before kinds were recorded, from its subject line. The old
 * automatic reminders are told apart by the stage their subject opened with; "Final Reminder"
 * and "Payment Due Today" have no equivalent now, so they are a plain "Reminder".
 */
function inferKind(subject: string): InvoiceEmailHistoryKind {
  const text = subject.trim().toLowerCase()
  if (text.startsWith('receipt') || text.includes('payment received')) return 'receipt'
  if (text.startsWith('first reminder') || text.includes('a quick reminder')) return 'reminder_first'
  if (text.startsWith('second reminder') || text.includes('still outstanding')) return 'reminder_second'
  if (text.startsWith('final reminder') || text.startsWith('payment due today')) return 'reminder'
  if (text.includes('gentle reminder') || text.includes('chas')) return 'chase'
  if (text.includes('invoice')) return 'invoice'
  return 'other'
}

function kindOf(row: InvoiceEmailRow): { kind: InvoiceEmailHistoryKind; inferred: boolean } {
  const recorded = emailMetadata(row).email_kind
  if (typeof recorded === 'string' && RECORDED_KINDS.has(recorded)) {
    return { kind: recorded as InvoiceEmailKind, inferred: false }
  }
  return { kind: inferKind(String(row.subject ?? '')), inferred: true }
}

/**
 * The outcome, said honestly. An email sent through the Orange Jelly mailbox has no delivery
 * tracking: Microsoft does not tell the app whether it arrived, so "sent" is all that is known
 * and the label says exactly that. Older emails keep whatever was recorded for them.
 */
function outcomeOf(row: InvoiceEmailRow): { outcome: string; tone: InvoiceEmailOutcomeTone } {
  const status = String(row.status ?? '').toLowerCase()
  const reason = String(row.error ?? '').trim()

  switch (status) {
    case 'sent':
    case 'queued':
      return row.resend_message_id
        ? { outcome: 'Sent (no delivery report yet)', tone: 'neutral' }
        : { outcome: 'Sent (delivery not tracked)', tone: 'neutral' }
    case 'delivered':
      return { outcome: 'Delivered', tone: 'success' }
    case 'read':
    case 'opened':
    case 'clicked':
      return { outcome: 'Delivered and opened', tone: 'success' }
    case 'delivery_delayed':
      return { outcome: "Delayed by the recipient's mail server", tone: 'warning' }
    case 'bounced':
      return { outcome: 'Bounced', tone: 'danger' }
    case 'complained':
      return { outcome: 'Delivered, then marked as spam', tone: 'danger' }
    case 'suppressed':
      return { outcome: 'Refused: the address is on the block list', tone: 'danger' }
    case 'failed':
      return { outcome: reason ? `Failed: ${reason.slice(0, 200)}` : 'Failed', tone: 'danger' }
    default:
      return { outcome: status ? `Recorded as "${status}"` : 'Outcome not recorded', tone: 'neutral' }
  }
}

function copiesOf(row: InvoiceEmailRow): string[] | null {
  const copies = emailMetadata(row).cc
  if (!Array.isArray(copies)) return null
  return copies.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
}

function droppedCopiesOf(row: InvoiceEmailRow): string[] {
  const dropped = emailMetadata(row).cc_dropped
  if (!Array.isArray(dropped)) return []
  return dropped.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
}

function sentAtLabelOf(row: InvoiceEmailRow): string {
  const timestamp = row.sent_at ?? row.created_at
  if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return 'Date not recorded'
  // Two calls, joined here: en-GB puts "at" or a comma between a date and a time depending on
  // the runtime's version, and the label should not change with it. 24 hour clock, because
  // en-GB on Node 20 renders noon as "0 pm".
  const date = formatDateInLondon(timestamp, { day: 'numeric', month: 'long', year: 'numeric' })
  const time = formatDateTimeInLondon(timestamp, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${date}, ${time}`
}

/**
 * The emails to show for an invoice, newest first as given. The old job's internal alerts are
 * left out; everything else stays, including a genuine email to the Orange Jelly mailbox.
 */
export function toInvoiceEmailHistory(rows: InvoiceEmailRow[]): InvoiceEmailHistoryEntry[] {
  return rows
    .filter((row) => !isInternalInvoiceAlert(row))
    .map((row) => {
      const { kind, inferred } = kindOf(row)
      const { outcome, tone } = outcomeOf(row)
      return {
        id: row.id,
        sentAtLabel: sentAtLabelOf(row),
        kind,
        kindLabel: KIND_LABELS[kind],
        kindInferred: inferred,
        to: String(row.to_address ?? '').trim() || 'Address not recorded',
        copies: copiesOf(row),
        droppedCopies: droppedCopiesOf(row),
        outcome,
        outcomeTone: tone,
        subject: String(row.subject ?? '').trim() || '(no subject)',
        body: row.body_text?.trim() ? row.body_text : null,
      }
    })
}

function stageName(stage: ReminderStage): string {
  return stage === 'first' ? 'first' : 'second'
}

const NOTHING_AUTOMATIC: Record<Extract<ReminderDecision, { action: 'needs_owner' }>['reason'], string> = {
  private_hire: 'Private hire invoices are not chased automatically.',
  reminders_off: 'Automatic reminders are switched off.',
  due_before_go_live: 'It fell due before automatic reminders were switched on.',
  overdue_21_days: 'Automatic reminders have finished.',
  first_window_missed: 'No first reminder was sent in its window.',
}

/** Why no reminder is forecast, read from what the rules will say on the day after `from`. */
function whyNothingIsForecast(invoice: ReminderInvoice, context: ReminderContext, from: string): string {
  const nextDay = shiftIsoDate(from, 1)
  const probe = nextDay ? decideReminder(invoice, { ...context, today: nextDay }) : null
  return probe?.action === 'needs_owner'
    ? NOTHING_AUTOMATIC[probe.reason]
    : 'No further automatic reminder is expected for this invoice.'
}

export interface NextReminderInput {
  invoice: ReminderInvoice
  /** London calendar date. */
  today: string
  goLiveDate: string | null
  /** London date of the client's latest invoice email, when known. */
  lastClientEmailDate: string | null
  /** True once today's run of the reminder job has finished. */
  todayRunDone: boolean
}

/**
 * The line above the email list. One of:
 *   "Next automatic reminder: Tuesday 13 October (forecast)"
 *   "Reminders held until Tuesday 20 October"
 *   "No automatic reminders: both have been sent"
 *   "No automatic reminders: chase by hand"
 * and, for an invoice with nothing to chase, the reason in the same form.
 *
 * A forecast, never a promise: the job checks everything again before it sends.
 */
export function describeNextReminder(input: NextReminderInput): NextReminderLine {
  const { invoice, today, goLiveDate } = input
  const context = { today, goLiveDate, lastClientEmailDate: input.lastClientEmailDate }
  const decision = decideReminder(invoice, context)

  if (decision.action === 'none' && decision.reason !== 'not_overdue') {
    if (decision.reason === 'both_sent') {
      return { line: 'No automatic reminders: both have been sent', detail: null }
    }
    if (decision.reason === 'nothing_owed' || invoice.status === 'paid') {
      return { line: 'No automatic reminders: nothing is owed', detail: null }
    }
    if (decision.reason === 'never_emailed' || invoice.status === 'draft') {
      return {
        line: 'No automatic reminders: this invoice has not been emailed',
        detail: 'An invoice the app has no record of emailing is never chased automatically.',
      }
    }
    return { line: 'No automatic reminders: this invoice has been withdrawn', detail: null }
  }

  if (decision.action === 'needs_owner') {
    return { line: 'No automatic reminders: chase by hand', detail: `${describeNeedsOwner(decision)}.` }
  }

  // An invoice that is not due yet is forecast from its due date: the rules look a fixed number
  // of runs ahead, which would fall short on long payment terms.
  const forecastFrom = decision.action === 'none' && invoice.dueDate > today ? invoice.dueDate : today
  const forecast = forecastNextReminder(invoice, { ...context, today: forecastFrom })

  const holdRemaining = daysBetween(today, invoice.heldUntil)
  if (invoice.heldUntil && holdRemaining !== null && holdRemaining >= 0) {
    return {
      line: `Reminders held until ${formatInvoiceDate(invoice.heldUntil)}`,
      detail: forecast
        ? `After that, the ${stageName(forecast.stage)} reminder is forecast for ${formatInvoiceDate(forecast.date)}.`
        : 'No automatic reminder is expected after the hold: chase by hand.',
    }
  }

  // Due on today's run, which has not happened yet.
  if (decision.action === 'send' && isWeekday(today) && !input.todayRunDone) {
    return {
      line: `Next automatic reminder: ${formatInvoiceDate(today)} (forecast)`,
      detail: `The ${stageName(decision.stage)} reminder, on today's run. Everything is checked again before it is sent.`,
    }
  }

  if (forecast) {
    return {
      line: `Next automatic reminder: ${formatInvoiceDate(forecast.date)} (forecast)`,
      detail: `The ${stageName(forecast.stage)} reminder. Everything is checked again before it is sent.`,
    }
  }

  return { line: 'No automatic reminders: chase by hand', detail: whyNothingIsForecast(invoice, context, forecastFrom) }
}
