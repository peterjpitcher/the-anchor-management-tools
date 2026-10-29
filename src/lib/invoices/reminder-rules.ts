/**
 * The rules for automatic invoice reminders: when one is sent, when it is not, and why.
 *
 * PURE: no database, no clock, no environment. Everything is passed in, so the same function
 * decides what the reminder job sends, what the owner's summary lists under "Going next", and
 * what the invoice page shows as the next reminder. All dates are calendar dates
 * (YYYY-MM-DD) in London time; the caller converts timestamps before calling.
 *
 * The schedule (owner decision, 4 October 2026):
 *   - nothing on the due date
 *   - first reminder when 5 to 13 days overdue
 *   - second reminder when 14 to 20 days overdue, at least 7 days after the first, and only
 *     if the first was sent
 *   - from 21 days overdue nothing automatic: the owner chases by hand
 *
 * A window that is missed is not caught up. See
 * tasks/spec-2026-10-04-invoice-issuing-and-chasing.md (R2).
 *
 * Weekly chasers (owner decision, 29 October 2026), once `INVOICE_WEEKLY_REMINDERS_FROM` is
 * set: an unpaid invoice is never left alone. From 21 days overdue the client is emailed every
 * week until it is paid, voided or written off, "without exception":
 *   - invoices that fell due before the go-live date, and invoices the app has no record of
 *     emailing, join at 21 days (the first and second wordings would not be true for them)
 *   - a private hire invoice joins at 21 days, a week after the party (its first and second
 *     reminders stay off, because those windows land in the run-up to the event)
 *   - a client chased in the last week gets nothing else until the next weekly email, which
 *     then covers every invoice of theirs that is due
 *   - each weekly email goes at least 7 days after the invoice's own latest reminder and at
 *     least 7 days after the client's latest weekly email or hand-sent chase, so a client with
 *     several unpaid invoices gets one email a week, not one per invoice
 * Still never chased: nothing owed, paid, void, written off, a hold, a cancelled booking's
 * invoice (it waits for a credit note), and everything the job checks before sending (the
 * bank, an address, the email kill switches). See tasks/plan-2026-10-29-invoice-weekly-chasers.md.
 */

export type ReminderStage = 'first' | 'second' | 'weekly'

export const FIRST_WINDOW = { from: 5, to: 13 } as const
export const SECOND_WINDOW = { from: 14, to: 20 } as const
/**
 * From this many days overdue the agreed schedule has run. With weekly chasers off the invoice
 * is then the owner's to chase; with them on, the weekly emails start here.
 */
export const HANDOVER_DAYS = 21
/** The second reminder waits at least this many days after the first. */
export const SECOND_MIN_GAP_DAYS = 7
/** A weekly chaser waits at least this many days after the last one, for the invoice and the client. */
export const WEEKLY_GAP_DAYS = 7
/**
 * A client who was sent any invoice email today or on either of the two London dates before
 * it is left alone. So an email on Friday blocks Friday, Saturday and Sunday, and Monday is
 * clear.
 */
export const QUIET_DAYS = 3

const UNCOLLECTABLE_STATUSES = new Set(['draft', 'paid', 'void', 'written_off'])

export interface ReminderInvoice {
  status: string | null | undefined
  /** Calendar date the invoice fell due. */
  dueDate: string
  /** Set when the app has a record of emailing the invoice. Null means never emailed. */
  sentAt: string | null | undefined
  deletedAt?: string | null
  /** What is still owed, from `invoiceBalanceDue`: already allows for credit notes. */
  balance: number
  /** True when the invoice is linked to a private booking. */
  isPrivateHire: boolean
  /** Reminders are held through this calendar date, inclusive. */
  heldUntil?: string | null
  /** London calendar date the first reminder was accepted for sending. */
  firstReminderDate?: string | null
  /** London calendar date the second reminder was accepted for sending. */
  secondReminderDate?: string | null
  /** London calendar date of the latest weekly chaser that listed this invoice. */
  lastWeeklyDate?: string | null
  /**
   * True when the invoice belongs to a private booking that was cancelled. Such an invoice is
   * left open only for a credit note, so nothing is owed and it is never chased.
   */
  bookingCancelled?: boolean
}

export interface ReminderContext {
  /** London calendar date of the run being decided. */
  today: string
  /**
   * `INVOICE_REMINDERS_GO_LIVE_DATE`. Null means automatic reminders are switched off, and
   * nothing is ever sent.
   */
  goLiveDate: string | null
  /**
   * London calendar date of the most recent invoice email this CLIENT was sent (any of their
   * invoices: a new invoice, a reminder, a chase or a receipt). Only emails to the customer
   * that were accepted for sending count. Null means none on record.
   */
  lastClientEmailDate?: string | null
  /**
   * `INVOICE_WEEKLY_REMINDERS_FROM`. Null, unreadable or later than `today` means weekly
   * chasers are off and the schedule ends at 21 days, exactly as before.
   */
  weeklyFrom?: string | null
  /**
   * London calendar date of the latest weekly chaser or hand-sent chase this CLIENT was sent,
   * for any of their invoices. Null means none on record.
   */
  lastClientChaserDate?: string | null
}

export type ReminderDecision =
  /** Send this stage now. */
  | { action: 'send'; stage: ReminderStage; daysOverdue: number }
  /** Nothing today, but an automatic reminder may still follow. */
  | {
      action: 'wait'
      reason:
        | 'not_due_yet'
        | 'held'
        | 'recent_client_email'
        | 'second_too_soon'
        | 'weekly_too_soon'
        | 'waiting_for_weekly'
      daysOverdue: number
    }
  /** Nothing automatic will be sent. The owner should chase by hand. */
  | {
      action: 'needs_owner'
      reason:
        | 'reminders_off'
        | 'private_hire'
        | 'due_before_go_live'
        | 'overdue_21_days'
        | 'first_window_missed'
        | 'booking_cancelled'
      daysOverdue: number
    }
  /** Nothing to do, and nothing for the owner to do either. */
  | { action: 'none'; reason: 'not_collectable' | 'nothing_owed' | 'never_emailed' | 'not_overdue' | 'both_sent' }

const MS_PER_DAY = 24 * 60 * 60 * 1000

function isoToUtcMs(isoDate: string | null | undefined): number | null {
  const value = String(isoDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isNaN(ms) ? null : ms
}

/** Whole calendar days from `from` to `to`. Null when either date cannot be read. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const start = isoToUtcMs(from)
  const end = isoToUtcMs(to)
  if (start === null || end === null) return null
  return Math.round((end - start) / MS_PER_DAY)
}

function addDays(isoDate: string, days: number): string {
  const ms = isoToUtcMs(isoDate)
  if (ms === null) return isoDate
  return new Date(ms + days * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Monday to Friday. Bank holidays are deliberately not handled (see the spec). */
export function isWeekday(isoDate: string): boolean {
  const ms = isoToUtcMs(isoDate)
  if (ms === null) return false
  const day = new Date(ms).getUTCDay()
  return day >= 1 && day <= 5
}

/** The next date the job runs after `isoDate`: the next Monday to Friday. */
export function nextRunDate(isoDate: string): string {
  let candidate = addDays(isoDate, 1)
  for (let guard = 0; guard < 7 && !isWeekday(candidate); guard += 1) {
    candidate = addDays(candidate, 1)
  }
  return candidate
}

function isHeld(invoice: ReminderInvoice, today: string): boolean {
  if (!invoice.heldUntil) return false
  const remaining = daysBetween(today, invoice.heldUntil)
  // Held THROUGH the date: a hold until today still holds today.
  return remaining !== null && remaining >= 0
}

function clientEmailedRecently(context: ReminderContext): boolean {
  if (!context.lastClientEmailDate) return false
  const since = daysBetween(context.lastClientEmailDate, context.today)
  // An email dated after "today" can only mean clock skew. Treat it as recent: when in doubt,
  // do not send.
  return since !== null && since < QUIET_DAYS
}

/**
 * True once weekly chasers are switched on for `today`. A date that cannot be read leaves them
 * off: failing closed here means today's behaviour, never an extra email.
 */
export function weeklyChasersOn(context: Pick<ReminderContext, 'today' | 'weeklyFrom'>): boolean {
  if (!context.weeklyFrom) return false
  const since = daysBetween(context.weeklyFrom, context.today)
  return since !== null && since >= 0
}

/**
 * The weekly chaser for an invoice that is 21 or more days overdue. Fails closed: a reminder
 * date that cannot be read counts as recent, so it can hold an email back but never add one.
 */
function decideWeekly(invoice: ReminderInvoice, context: ReminderContext, daysOverdue: number): ReminderDecision {
  if (isHeld(invoice, context.today)) return { action: 'wait', reason: 'held', daysOverdue }
  if (clientEmailedRecently(context)) return { action: 'wait', reason: 'recent_client_email', daysOverdue }

  // A week after this invoice's own latest reminder, whichever stage that was.
  for (const date of [invoice.firstReminderDate, invoice.secondReminderDate, invoice.lastWeeklyDate]) {
    if (!date) continue
    const since = daysBetween(date, context.today)
    if (since === null || since < WEEKLY_GAP_DAYS) return { action: 'wait', reason: 'weekly_too_soon', daysOverdue }
  }

  if (clientChasedThisWeek(context)) return { action: 'wait', reason: 'weekly_too_soon', daysOverdue }

  return { action: 'send', stage: 'weekly', daysOverdue }
}

/**
 * True within a week of the client's latest weekly email or hand-sent chase, for any invoice.
 * That is what keeps a client with unpaid invoices to one email a week: an invoice that comes
 * due between two of them, at any stage, waits for the next and goes in the same email. A first
 * or second window that passes while it waits is picked up by the weekly emails at 21 days.
 */
function clientChasedThisWeek(context: ReminderContext): boolean {
  if (!context.lastClientChaserDate) return false
  const since = daysBetween(context.lastClientChaserDate, context.today)
  return since === null || since < WEEKLY_GAP_DAYS
}

/**
 * What the reminder job should do about one invoice on one run.
 *
 * FAILS CLOSED. Anything that cannot be read (a bad due date, for one) ends in "do not send".
 */
export function decideReminder(invoice: ReminderInvoice, context: ReminderContext): ReminderDecision {
  if (invoice.deletedAt || UNCOLLECTABLE_STATUSES.has(String(invoice.status ?? ''))) {
    return { action: 'none', reason: 'not_collectable' }
  }
  if (!(invoice.balance > 0)) {
    return { action: 'none', reason: 'nothing_owed' }
  }
  const weekly = weeklyChasersOn(context)
  // Status is not delivery. Without weekly chasers, an invoice the app has no record of
  // emailing is never chased: "I've attached another copy in case the first one got buried"
  // would be untrue. With them, every invoice that is owed is followed up from 21 days (owner
  // decision, 29 October 2026): one marked sent by hand reached the client some other way.
  if (!invoice.sentAt && !weekly) {
    return { action: 'none', reason: 'never_emailed' }
  }

  const daysOverdue = daysBetween(invoice.dueDate, context.today)
  if (daysOverdue === null || daysOverdue <= 0) {
    return { action: 'none', reason: 'not_overdue' }
  }

  // A private hire balance falls due 14 days before the event, so the first and second windows
  // would land in the run-up to the party and on the day itself. The booking code already has
  // the rule that an overdue balance goes to the owner, not to an automatic chaser. Weekly
  // chasers start at 21 days, a week after the party, and take it from there.
  if (invoice.isPrivateHire) {
    // Cancelling a booking voids an unpaid invoice; one with money received stays open only
    // until its credit note is issued. Nothing is owed on it, so it is never chased.
    if (weekly && invoice.bookingCancelled) {
      return { action: 'needs_owner', reason: 'booking_cancelled', daysOverdue }
    }
    if (!weekly || daysOverdue < HANDOVER_DAYS) {
      return { action: 'needs_owner', reason: 'private_hire', daysOverdue }
    }
  }

  if (!context.goLiveDate) {
    return { action: 'needs_owner', reason: 'reminders_off', daysOverdue }
  }

  if (daysOverdue >= HANDOVER_DAYS && weekly) return decideWeekly(invoice, context, daysOverdue)

  // Invoices that fell due before the switch-on date may already have had old-style reminders.
  // With weekly chasers they are followed up like any other, from 21 days: the first and second
  // wordings ("a quick nudge") would be wrong for them, and for one the app never emailed.
  const dueAgainstGoLive = daysBetween(context.goLiveDate, invoice.dueDate)
  if (dueAgainstGoLive === null || dueAgainstGoLive < 0) {
    return weekly
      ? { action: 'wait', reason: 'waiting_for_weekly', daysOverdue }
      : { action: 'needs_owner', reason: 'due_before_go_live', daysOverdue }
  }
  if (!invoice.sentAt) return { action: 'wait', reason: 'waiting_for_weekly', daysOverdue }

  if (daysOverdue >= HANDOVER_DAYS) {
    return { action: 'needs_owner', reason: 'overdue_21_days', daysOverdue }
  }

  if (invoice.firstReminderDate && invoice.secondReminderDate) {
    return weekly ? { action: 'wait', reason: 'waiting_for_weekly', daysOverdue } : { action: 'none', reason: 'both_sent' }
  }

  if (!invoice.firstReminderDate) {
    // A second reminder recorded without a first cannot happen through this job. If it has,
    // something is wrong with the record: hand it to the owner rather than send anything.
    if (invoice.secondReminderDate) {
      return { action: 'needs_owner', reason: 'first_window_missed', daysOverdue }
    }
    if (daysOverdue < FIRST_WINDOW.from) {
      return { action: 'wait', reason: 'not_due_yet', daysOverdue }
    }
    if (daysOverdue > FIRST_WINDOW.to) {
      // Not caught up. Opening with "still outstanding" would be the first the customer hears.
      // With weekly chasers the first of those, at 21 days, picks it up.
      return weekly
        ? { action: 'wait', reason: 'waiting_for_weekly', daysOverdue }
        : { action: 'needs_owner', reason: 'first_window_missed', daysOverdue }
    }
    if (isHeld(invoice, context.today)) return { action: 'wait', reason: 'held', daysOverdue }
    if (clientEmailedRecently(context)) return { action: 'wait', reason: 'recent_client_email', daysOverdue }
    if (weekly && clientChasedThisWeek(context)) return { action: 'wait', reason: 'weekly_too_soon', daysOverdue }
    return { action: 'send', stage: 'first', daysOverdue }
  }

  // First sent, second not.
  if (daysOverdue < SECOND_WINDOW.from) {
    return { action: 'wait', reason: 'not_due_yet', daysOverdue }
  }
  const sinceFirst = daysBetween(invoice.firstReminderDate, context.today)
  if (sinceFirst === null || sinceFirst < SECOND_MIN_GAP_DAYS) {
    return { action: 'wait', reason: 'second_too_soon', daysOverdue }
  }
  if (isHeld(invoice, context.today)) return { action: 'wait', reason: 'held', daysOverdue }
  if (clientEmailedRecently(context)) return { action: 'wait', reason: 'recent_client_email', daysOverdue }
  if (weekly && clientChasedThisWeek(context)) return { action: 'wait', reason: 'weekly_too_soon', daysOverdue }
  return { action: 'send', stage: 'second', daysOverdue }
}

export interface ReminderForecast {
  /** Calendar date of the run that is expected to send it. */
  date: string
  stage: ReminderStage
}

/**
 * The next automatic reminder this invoice is expected to get, looking at the runs AFTER
 * `context.today`, or null when none is expected.
 *
 * A FORECAST, not a promise. It assumes nothing changes: no payment, no hold, no other email
 * to the client. The job checks everything again, against fresh data, before it sends.
 */
export function forecastNextReminder(invoice: ReminderInvoice, context: ReminderContext): ReminderForecast | null {
  let date = context.today
  // Day 21 ends every sequence when weekly chasers are off, and with them on the next email is
  // never more than a week or so away, so 30 runs is more than enough to reach an answer. A
  // hold longer than that is forecast from its end date by the caller.
  for (let step = 0; step < 30; step += 1) {
    date = nextRunDate(date)
    const decision = decideReminder(invoice, { ...context, today: date })
    if (decision.action === 'send') return { date, stage: decision.stage }
    if (decision.action === 'needs_owner') return null
    if (decision.action === 'none' && decision.reason !== 'not_overdue') return null
  }
  return null
}

/** True when the reminder is expected on the very next run. Used for "Going next". */
export function isDueOnNextRun(invoice: ReminderInvoice, context: ReminderContext): ReminderStage | null {
  const next = nextRunDate(context.today)
  const decision = decideReminder(invoice, { ...context, today: next })
  return decision.action === 'send' ? decision.stage : null
}

/** Plain words for the owner's "Needs you" list and the invoice page. */
export function describeNeedsOwner(decision: Extract<ReminderDecision, { action: 'needs_owner' }>): string {
  const days = `${decision.daysOverdue} ${decision.daysOverdue === 1 ? 'day' : 'days'} overdue`
  switch (decision.reason) {
    case 'private_hire':
      return `${days}. Private hire: chase by hand`
    case 'reminders_off':
      return `${days}. Automatic reminders are switched off: chase by hand`
    case 'due_before_go_live':
      return `${days}. Fell due before automatic reminders were switched on: chase by hand`
    case 'overdue_21_days':
      return `${days}. Automatic reminders have finished: chase by hand`
    case 'first_window_missed':
      return `${days}. No first reminder was sent in its window: chase by hand`
    case 'booking_cancelled':
      return `${days}. Its private booking was cancelled, so it is not chased: settle it with a credit note`
  }
}
