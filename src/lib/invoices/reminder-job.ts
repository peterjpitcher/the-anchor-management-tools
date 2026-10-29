/**
 * The automatic invoice reminder job (R2 of tasks/spec-2026-10-04-invoice-issuing-and-chasing.md).
 *
 * Runs once per London weekday. It marks invoices overdue, sends the first and second reminders
 * in the owner's own voice, and then sends the owner ONE summary of the run in place of an
 * alert per reminder.
 *
 * With `INVOICE_WEEKLY_REMINDERS_FROM` set (owner decision, 29 October 2026) an unpaid invoice
 * is never left alone: from 21 days overdue the client is emailed every week until it is paid,
 * and each run sends a client ONE email covering every invoice of theirs that is due a
 * reminder, each attached. Without it, at most one reminder per client per run, as before.
 *
 * What keeps a customer from being emailed wrongly, in the order it is checked:
 *   1. The switch. Without `INVOICE_REMINDERS_GO_LIVE_DATE` the send step is never entered.
 *   2. The rules (`reminder-rules.ts`), which fail closed and are re-run against a fresh read
 *      of the invoice immediately before each send.
 *   3. A claim per invoice and stage, taken before the send. A weekly chaser's claim is per
 *      London week, so a week can never send it twice.
 *   4. The columns on the invoice, written once the email is accepted. They are the lasting
 *      record: they do not expire and they survive a changed due date.
 *
 * SENT AND RECORDED ARE TWO DIFFERENT THINGS. Once the email is accepted, nothing here may
 * release the claim, whatever fails afterwards. A send that was definitely refused is released
 * so the next run can retry. A send whose outcome is unknown is kept, never retried, and
 * handed to the owner to check in Sent Items. A weekly chaser with an unknown outcome counts
 * as that week's: the next one goes a week later, so the chasing never stops.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { getIsoWeekday, getTodayIsoDate, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { reportCronFailure } from '@/lib/cron/alerting'
import { getAppUrl } from '@/lib/env'
import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/logger'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
import type { InvoiceWithDetails } from '@/types/invoices'
import { invoiceBalanceDue } from './balance'
import {
  buildCombinedReminderEmail,
  buildFirstReminderEmail,
  buildSecondReminderEmail,
  buildWeeklyReminderEmail,
  formatInvoiceDate,
  formatInvoiceMoney,
  payOnlinePostscriptForSeveral,
  type InvoiceEmailDraft,
  type InvoiceEmailKind,
} from './email-copy'
import { countsAsCustomerInvoiceEmail, emailMetadata } from './email-log-rules'
import { resolveInvoiceGreetingName } from './greeting'
import { invoiceRemindersGoLiveDate, invoiceWeeklyRemindersFrom } from './release-switches'
import {
  QUIET_DAYS,
  WEEKLY_GAP_DAYS,
  daysBetween,
  decideReminder,
  describeNeedsOwner,
  isDueOnNextRun,
  isWeekday,
  weeklyChasersOn,
  type ReminderDecision,
  type ReminderInvoice,
  type ReminderStage,
} from './reminder-rules'
import {
  buildReminderSummary,
  needsYouKeys,
  parseRunState,
  serialiseRunState,
  type ReminderRunState,
  type SummaryDelivery,
  type SummaryGoingNextEntry,
  type SummaryNeedsYouEntry,
  type SummaryProblemEntry,
  type SummarySentEntry,
} from './reminder-summary'

type AdminClient = ReturnType<typeof createAdminClient>

export const INVOICE_REMINDERS_JOB = 'invoice-reminders'

/** A run still marked "running" after this long is dead: the function is capped at 300 seconds. */
const STALE_RUN_MINUTES = 30

const CLAIM_TTL_HOURS = 24 * 45

/**
 * A claim left at "processing" is NEVER treated as abandoned and taken over. The shared helper
 * would do that after ten minutes, which is right for a web request but wrong here: a run that
 * died between the mailbox accepting the email and the claim being closed would be sent again
 * the next morning. So a dead claim stays a dead claim for its whole life, and the invoice goes
 * to the owner instead.
 */
const CLAIM_NEVER_STALE_MS = CLAIM_TTL_HOURS * 60 * 60 * 1000

/**
 * No new send is started after this long. Each send renders a PDF, and a send cut off by the
 * platform's time limit is an unknown outcome: a first or second reminder is then never
 * retried, and a weekly chaser waits a week. Better to leave the rest for the next run.
 */
const SEND_TIME_BUDGET_MS = 200_000

/** How far back to look for emails to a client. One day more than the rule needs, for margin. */
const RECENT_EMAIL_LOOKBACK_DAYS = QUIET_DAYS + 1

/** How far back to look for a client's latest weekly chaser or hand-sent chase. */
const CHASER_LOOKBACK_DAYS = WEEKLY_GAP_DAYS + 1

/** Logged emails that start a client's seven-day weekly clock. */
const CHASER_EMAIL_KINDS = new Set(['chase', 'reminder_weekly', 'reminder_combined'])

// The vendor columns are the ones the invoice PDF prints and the pay online line checks. The
// reminder says "I've attached another copy", so the copy must match the original: the old job
// left out the address, phone and VAT number.
const REMINDER_INVOICE_SELECT = `
  *,
  vendor:invoice_vendors(
    id,
    name,
    contact_name,
    email,
    phone,
    address,
    vat_number,
    payment_terms,
    paypal_payments_enabled
  ),
  line_items:invoice_line_items(*),
  payments:invoice_payments(*),
  credits:credit_notes(status, amount_inc_vat)
`

/**
 * Whether a failed send may nonetheless have reached the mailbox.
 *
 * `sendInvoiceEmail` never throws: a failure comes back as `success: false`. It marks the kind
 * where the request left and no answer came back (a timeout, a dropped connection) as
 * `uncertain`. That one is an unknown outcome: kept, not retried. A failure with no reason
 * given is treated the same way, because no reason is no proof of refusal. Everything else is
 * a definite refusal and nothing was sent.
 */
function failureIsAmbiguous(result: { uncertain?: boolean; error?: string | null }): boolean {
  return result.uncertain === true || String(result.error ?? '').trim() === ''
}

type BlockedReason = 'no_address' | 'reminder_outcome_unknown' | 'payment_waiting'

interface Candidate {
  invoice: InvoiceWithDetails
  vendorId: string
  clientName: string
  isPrivateHire: boolean
  /** True when its private booking was cancelled. Only read while weekly chasers are on. */
  bookingCancelled: boolean
  decision: ReminderDecision
  /** What is still owed, as last read. Null when the amounts could not be read. */
  balance: number | null
  /** The rules said send, but nothing automatic can go. Listed under "Needs you". */
  blocked?: { reason: BlockedReason; detail: string }
  /** True when this run left the invoice in a state the forecast cannot describe. */
  excludeFromForecast?: boolean
}

interface RunContext {
  supabase: AdminClient
  today: string
  goLiveDate: string | null
  /** `INVOICE_WEEKLY_REMINDERS_FROM`, or null while weekly chasers are off. */
  weeklyFrom: string | null
  appUrl: string
  startedMs: number
  /** London date of the latest email to each client, by client id. Updated as the run sends. */
  lastEmailByVendor: Map<string, string>
  /**
   * London date of the latest weekly chaser or hand-sent chase to each client, by client id.
   * Only filled while weekly chasers are on. Updated as the run sends.
   */
  lastChaserByVendor: Map<string, string>
  sent: SummarySentEntry[]
  problems: SummaryProblemEntry[]
  /** Invoice numbers whose reminder was refused, has an unknown outcome or could not be recorded. */
  sendFailures: string[]
  warnings: number
}

interface ReminderRunResponse {
  status: number
  body: Record<string, unknown>
}

function londonDateOf(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : toLocalIsoDate(date)
}

/**
 * The London date a reminder column records. An unreadable value is passed through as it is,
 * not dropped: the rules treat any non-empty value as "sent", so a damaged record can stop a
 * reminder but can never cause a second one.
 */
function reminderDateOf(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null
  return londonDateOf(timestamp) ?? String(timestamp)
}

/** The fields of an invoice row the reminder rules read. */
type ReminderInvoiceRow = Pick<
  InvoiceWithDetails,
  | 'status'
  | 'due_date'
  | 'sent_at'
  | 'deleted_at'
  | 'reminders_held_until'
  | 'reminder_first_sent_at'
  | 'reminder_second_sent_at'
  | 'reminder_last_weekly_sent_at'
>

/**
 * An invoice row in the shape the rules take. Shared with the invoice page, so its "next
 * reminder" line is worked out from exactly what the job would see.
 */
export function toReminderInvoice(
  invoice: ReminderInvoiceRow,
  isPrivateHire: boolean,
  balance: number,
  bookingCancelled = false
): ReminderInvoice {
  return {
    status: invoice.status,
    dueDate: String(invoice.due_date ?? '').slice(0, 10),
    sentAt: invoice.sent_at,
    deletedAt: invoice.deleted_at ?? null,
    balance,
    isPrivateHire,
    heldUntil: invoice.reminders_held_until ?? null,
    firstReminderDate: reminderDateOf(invoice.reminder_first_sent_at),
    secondReminderDate: reminderDateOf(invoice.reminder_second_sent_at),
    lastWeeklyDate: reminderDateOf(invoice.reminder_last_weekly_sent_at),
    bookingCancelled,
  }
}

/** Decides one invoice against what is known now. Throws when its amounts cannot be read. */
function decide(candidate: Candidate, context: RunContext): ReminderDecision {
  const balance = invoiceBalanceDue(candidate.invoice)
  candidate.balance = balance
  return decideReminder(toReminderInvoice(candidate.invoice, candidate.isPrivateHire, balance, candidate.bookingCancelled), {
    today: context.today,
    goLiveDate: context.goLiveDate,
    lastClientEmailDate: context.lastEmailByVendor.get(candidate.vendorId) ?? null,
    weeklyFrom: context.weeklyFrom,
    lastClientChaserDate: context.lastChaserByVendor.get(candidate.vendorId) ?? null,
  })
}

/** Keeps the later of the date already known for a client and a freshly read one. */
function noteLater(dates: Map<string, string>, vendorId: string, fresh: string | null | undefined): void {
  const known = dates.get(vendorId)
  if (fresh && (!known || fresh > known)) dates.set(vendorId, fresh)
}

/** Candidates grouped by client, in the order each client's oldest invoice comes. */
function groupByVendor(candidates: Candidate[]): Candidate[][] {
  const groups = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.vendorId)
    if (group) group.push(candidate)
    else groups.set(candidate.vendorId, [candidate])
  }
  return [...groups.values()]
}

function heldToday(invoice: { reminders_held_until?: string | null }, today: string): boolean {
  const remaining = daysBetween(today, invoice.reminders_held_until)
  return remaining !== null && remaining >= 0
}

function invoiceUrl(context: RunContext, invoiceId: string): string {
  return `${context.appUrl}/invoices/${invoiceId}`
}

function addProblem(context: RunContext, candidate: Candidate | null, message: string): void {
  context.problems.push({
    invoiceNumber: candidate?.invoice.invoice_number ?? null,
    clientName: candidate?.clientName ?? null,
    message,
    url: candidate ? invoiceUrl(context, candidate.invoice.id) : null,
    date: context.today,
  })
}

// ---------------------------------------------------------------------------------------------
// One run per London date
// ---------------------------------------------------------------------------------------------

type RunLock =
  | { skip: true; reason: 'already_completed' | 'already_running' }
  | { skip: false; runId: string; earlierAttempt: ReminderRunState | null }

/**
 * Takes the day's run, as the private booking monitor does: one `cron_job_runs` row per job
 * and London date. A completed run blocks every later trigger that day. A failed run, or one
 * left "running" by a function that died, may be taken over, and what it had already recorded
 * comes with it so the summary still reports it.
 */
async function acquireRun(supabase: AdminClient, runKey: string): Promise<RunLock> {
  const nowIso = new Date().toISOString()

  const { data: inserted, error: insertError } = await supabase
    .from('cron_job_runs')
    .insert({ job_name: INVOICE_REMINDERS_JOB, run_key: runKey, status: 'running', started_at: nowIso })
    .select('id')
    .single()

  if (inserted?.id) {
    return { skip: false, runId: inserted.id, earlierAttempt: null }
  }

  if ((insertError as { code?: string } | null)?.code !== '23505') {
    throw insertError ?? new Error('Could not record the start of the invoice reminder run')
  }

  const { data: existing, error: fetchError } = await supabase
    .from('cron_job_runs')
    .select('id, status, started_at, result')
    .eq('job_name', INVOICE_REMINDERS_JOB)
    .eq('run_key', runKey)
    .maybeSingle()

  if (fetchError) throw fetchError
  if (!existing) throw insertError

  if (existing.status === 'completed') {
    return { skip: true, reason: 'already_completed' }
  }

  const startedMs = Date.parse(existing.started_at ?? '')
  const isStale = !Number.isFinite(startedMs) || Date.now() - startedMs > STALE_RUN_MINUTES * 60 * 1000
  if (existing.status === 'running' && !isStale) {
    return { skip: true, reason: 'already_running' }
  }

  // Guarded on what was read, so two triggers arriving together cannot both take it over.
  // `result` is left alone: it holds what the earlier attempt recorded, and must survive if
  // this attempt dies too.
  const { data: restarted, error: restartError } = await supabase
    .from('cron_job_runs')
    .update({ status: 'running', started_at: nowIso, finished_at: null })
    .eq('id', existing.id)
    .eq('status', existing.status)
    .eq('started_at', existing.started_at)
    .select('id')
    .maybeSingle()

  if (restartError) throw restartError
  if (!restarted) {
    return { skip: true, reason: 'already_running' }
  }

  return { skip: false, runId: existing.id, earlierAttempt: parseRunState(existing.result) }
}

/**
 * Saves the run's results on its `cron_job_runs` row, in the `result` column (added with the
 * reminder columns in 20261004185059). `error_message` stays what its name says: it is set
 * only on a failed run. Returns false when the save did not happen.
 */
async function saveRun(
  supabase: AdminClient,
  runId: string,
  status: 'running' | 'completed' | 'failed',
  state: ReminderRunState
): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = {
      status,
      result: JSON.parse(serialiseRunState(state)),
      error_message: status === 'failed' ? state.error ?? 'The run failed' : null,
    }
    if (status !== 'running') payload.finished_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('cron_job_runs')
      .update(payload)
      .eq('id', runId)
      .select('id')
      .maybeSingle()

    if (error || !data) {
      console.error('[invoice-reminders] Could not save the run record:', error?.message ?? 'no row was updated')
      return false
    }
    return true
  } catch (error) {
    console.error('[invoice-reminders] Could not save the run record:', getErrorMessage(error))
    return false
  }
}

interface EarlierRuns {
  /** The "Needs you" keys the owner last saw, or null when no earlier list is on record. */
  previousNeedsYouKeys: string[] | null
  /** What the latest earlier run recorded, when its summary never reached the owner. */
  carriedOver: { sent: SummarySentEntry[]; problems: SummaryProblemEntry[] } | null
  readFailed: boolean
}

async function loadEarlierRuns(supabase: AdminClient, today: string): Promise<EarlierRuns> {
  const { data, error } = await supabase
    .from('cron_job_runs')
    .select('run_key, status, result')
    .eq('job_name', INVOICE_REMINDERS_JOB)
    .lt('run_key', today)
    .order('run_key', { ascending: false })
    .limit(15)

  if (error) {
    console.error('[invoice-reminders] Could not read earlier runs:', error.message)
    return { previousNeedsYouKeys: null, carriedOver: null, readFailed: true }
  }

  const states = ((data ?? []) as Array<{ result?: unknown }>).map((row) => parseRunState(row.result))

  // Walk back from the latest run, gathering what every run recorded until one is reached whose
  // summary did get through. A run with no readable record died before it could save one and
  // is stepped over. A run whose summary failed also saved what it was carrying itself, so the
  // same entry can turn up twice: each is taken once.
  const sent = new Map<string, SummarySentEntry>()
  const problems = new Map<string, SummaryProblemEntry>()
  for (const state of states) {
    if (!state) continue
    if (state.summary === 'accepted' || state.summary === 'not_needed') break
    for (const entry of state.sent) {
      sent.set(`${entry.date}|${entry.invoiceNumber}|${entry.stage}|${entry.to}`, entry)
    }
    for (const entry of state.problems) {
      problems.set(`${entry.date}|${entry.invoiceNumber ?? ''}|${entry.message}`, entry)
    }
  }

  const byDate = <T extends { date: string }>(left: T, right: T): number => left.date.localeCompare(right.date)
  const carriedOver =
    sent.size > 0 || problems.size > 0
      ? { sent: [...sent.values()].sort(byDate), problems: [...problems.values()].sort(byDate) }
      : null

  // "Not needed" counts as seen: it means the list was empty or unchanged that day, so its
  // keys are what the owner's picture of the list should be.
  const lastSeen = states.find((state) => state && (state.summary === 'accepted' || state.summary === 'not_needed'))

  return { previousNeedsYouKeys: lastSeen ? lastSeen.needs_you_keys : null, carriedOver, readFailed: false }
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

async function loadOverdueInvoices(supabase: AdminClient, today: string): Promise<InvoiceWithDetails[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(REMINDER_INVOICE_SELECT)
    .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
    .in('status', ['sent', 'partially_paid', 'overdue'])
    .lte('due_date', today)
    .is('deleted_at', null)
    .order('due_date', { ascending: true })

  if (error) {
    throw new Error(`Could not load overdue invoices: ${error.message}`)
  }

  return ((data ?? []) as InvoiceWithDetails[]).filter((invoice) => Boolean(invoice?.id))
}

async function loadPrivateHireInvoiceIds(supabase: AdminClient, invoiceIds: string[]): Promise<Set<string>> {
  if (invoiceIds.length === 0) return new Set()

  const { data, error } = await supabase
    .from('private_booking_invoices')
    .select('invoice_id')
    .in('invoice_id', invoiceIds)

  // Without this the job cannot tell a private hire invoice from any other, and those must
  // never be chased automatically. So the whole run stops.
  if (error) {
    throw new Error(`Could not read which invoices belong to private bookings: ${error.message}`)
  }

  return new Set(((data ?? []) as Array<{ invoice_id?: string | null }>).flatMap((row) => row.invoice_id ?? []))
}

/**
 * The invoices, of those given, whose private booking was cancelled. Cancelling a booking voids
 * an unpaid invoice; one with money already received stays open only until its credit note is
 * issued, so nothing is owed on it. Read the way `invoiceBookingCancelled`
 * (cancelled-private-booking.ts) reads it: the booking's own invoice, or a linked one.
 *
 * Throws when it cannot be read: weekly chasers would otherwise chase a guest whose booking is
 * cancelled, so the whole run stops, as it does for the private hire list.
 */
async function loadCancelledBookingInvoiceIds(supabase: AdminClient, invoiceIds: string[]): Promise<Set<string>> {
  if (invoiceIds.length === 0) return new Set()

  const [{ data: owners, error: ownersError }, { data: links, error: linksError }] = await Promise.all([
    supabase.from('private_bookings').select('invoice_id, status').in('invoice_id', invoiceIds),
    supabase.from('private_booking_invoices').select('invoice_id, booking_id').in('invoice_id', invoiceIds),
  ])
  if (ownersError || linksError) {
    throw new Error(`Could not read which invoices belong to cancelled bookings: ${(ownersError ?? linksError)?.message}`)
  }

  const cancelled = new Set<string>()
  for (const row of (owners ?? []) as Array<{ invoice_id?: string | null; status?: string | null }>) {
    if (row.invoice_id && row.status === 'cancelled') cancelled.add(row.invoice_id)
  }

  const linkRows = ((links ?? []) as Array<{ invoice_id?: string | null; booking_id?: string | null }>).filter(
    (row) => row.invoice_id && row.booking_id
  )
  const bookingIds = [...new Set(linkRows.map((row) => row.booking_id as string))]
  if (bookingIds.length > 0) {
    const { data: bookings, error: bookingsError } = await supabase
      .from('private_bookings')
      .select('id, status')
      .in('id', bookingIds)
    if (bookingsError) {
      throw new Error(`Could not read which invoices belong to cancelled bookings: ${bookingsError.message}`)
    }
    const cancelledBookings = new Set(
      ((bookings ?? []) as Array<{ id?: string | null; status?: string | null }>)
        .filter((booking) => booking.id && booking.status === 'cancelled')
        .map((booking) => booking.id as string)
    )
    for (const row of linkRows) {
      if (cancelledBookings.has(row.booking_id as string)) cancelled.add(row.invoice_id as string)
    }
  }

  return cancelled
}

/**
 * The London date of the latest invoice email each client was sent, from two sources:
 *
 *  (a) the invoices' own columns (`sent_at` and the reminder columns), across ALL of the
 *      client's invoices, and
 *  (b) the email log, for the client's invoices over the last few days.
 *
 * Both, because the app can send an email and fail to save its log row. Throws when either
 * cannot be read: without them the "not emailed in the last three days" rule cannot be
 * applied, and guessing would mean a reminder on top of a new invoice.
 */
export async function loadLastClientEmailDates(
  supabase: AdminClient,
  vendorIds: string[],
  today: string
): Promise<Map<string, string>> {
  const latest = new Map<string, string>()
  if (vendorIds.length === 0) return latest

  const since = shiftIsoDate(today, -RECENT_EMAIL_LOOKBACK_DAYS) ?? today
  const wanted = new Set(vendorIds)

  const note = (vendorId: string | null | undefined, timestamp: string | null | undefined): void => {
    const date = londonDateOf(timestamp)
    if (!vendorId || !date || !wanted.has(vendorId)) return
    const known = latest.get(vendorId)
    if (!known || date > known) latest.set(vendorId, date)
  }

  const { data: stamped, error: stampedError } = await supabase
    .from('invoices')
    .select('vendor_id, sent_at, reminder_first_sent_at, reminder_second_sent_at, reminder_last_weekly_sent_at')
    .in('vendor_id', vendorIds)
    .or(
      `sent_at.gte.${since},reminder_first_sent_at.gte.${since},reminder_second_sent_at.gte.${since},reminder_last_weekly_sent_at.gte.${since}`
    )

  if (stampedError) {
    throw new Error(`Could not read when each client was last emailed: ${stampedError.message}`)
  }

  for (const row of (stamped ?? []) as Array<Record<string, string | null | undefined>>) {
    note(row.vendor_id, row.sent_at)
    note(row.vendor_id, row.reminder_first_sent_at)
    note(row.vendor_id, row.reminder_second_sent_at)
    note(row.vendor_id, row.reminder_last_weekly_sent_at)
  }

  const { data: emails, error: emailsError } = await supabase
    .from('email_messages')
    .select('invoice_id, subject, status, metadata, created_at, sent_at')
    .eq('direction', 'outbound')
    .not('invoice_id', 'is', null)
    .gte('created_at', `${since}T00:00:00.000Z`)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (emailsError) {
    throw new Error(`Could not read recent invoice emails: ${emailsError.message}`)
  }

  type EmailRow = {
    invoice_id?: string | null
    subject?: string | null
    status?: string | null
    metadata?: unknown
    created_at?: string | null
    sent_at?: string | null
  }
  const customerEmails = ((emails ?? []) as EmailRow[]).filter(
    (row) => Boolean(row.invoice_id) && countsAsCustomerInvoiceEmail(row)
  )
  const emailedInvoiceIds = [...new Set(customerEmails.flatMap((row) => row.invoice_id ?? []))]
  if (emailedInvoiceIds.length === 0) return latest

  const { data: owners, error: ownersError } = await supabase
    .from('invoices')
    .select('id, vendor_id')
    .in('id', emailedInvoiceIds)

  if (ownersError) {
    throw new Error(`Could not match recent emails to clients: ${ownersError.message}`)
  }

  const vendorByInvoice = new Map<string, string>()
  for (const row of (owners ?? []) as Array<{ id?: string | null; vendor_id?: string | null }>) {
    if (row.id && row.vendor_id) vendorByInvoice.set(row.id, row.vendor_id)
  }

  for (const row of customerEmails) {
    note(vendorByInvoice.get(row.invoice_id as string), row.sent_at ?? row.created_at)
  }

  return latest
}

/**
 * The London date of the latest weekly chaser or hand-sent chase each client was sent, for any
 * of their invoices: the weekly column on every invoice of theirs, and the email log over the
 * last week. A weekly chaser waits a week after it, so a chase sent by hand counts as that
 * week's email. The log also carries the weekly and combined reminders themselves, so one whose
 * column could not be written still holds the next back a full week. A combined reminder counts
 * even when it held no weekly invoice: at worst that delays the next weekly email, never adds
 * one. Throws when either cannot be read: guessing could mean a second chaser in a week.
 */
export async function loadLastClientChaserDates(
  supabase: AdminClient,
  vendorIds: string[],
  today: string
): Promise<Map<string, string>> {
  const latest = new Map<string, string>()
  if (vendorIds.length === 0) return latest

  const since = shiftIsoDate(today, -CHASER_LOOKBACK_DAYS) ?? today
  const wanted = new Set(vendorIds)
  const note = (vendorId: string | null | undefined, timestamp: string | null | undefined): void => {
    const date = londonDateOf(timestamp)
    if (vendorId && date && wanted.has(vendorId)) noteLater(latest, vendorId, date)
  }

  const { data: weekly, error: weeklyError } = await supabase
    .from('invoices')
    .select('vendor_id, reminder_last_weekly_sent_at')
    .in('vendor_id', vendorIds)
    .gte('reminder_last_weekly_sent_at', since)

  if (weeklyError) {
    throw new Error(`Could not read when each client was last sent a weekly reminder: ${weeklyError.message}`)
  }
  for (const row of (weekly ?? []) as Array<{ vendor_id?: string | null; reminder_last_weekly_sent_at?: string | null }>) {
    note(row.vendor_id, row.reminder_last_weekly_sent_at)
  }

  const { data: emails, error: emailsError } = await supabase
    .from('email_messages')
    .select('invoice_id, subject, status, metadata, created_at, sent_at')
    .eq('direction', 'outbound')
    .not('invoice_id', 'is', null)
    .gte('created_at', `${since}T00:00:00.000Z`)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (emailsError) {
    throw new Error(`Could not read recent invoice chases: ${emailsError.message}`)
  }

  type EmailRow = {
    invoice_id?: string | null
    subject?: string | null
    status?: string | null
    metadata?: unknown
    created_at?: string | null
    sent_at?: string | null
  }
  const chases = ((emails ?? []) as EmailRow[]).filter(
    (row) =>
      Boolean(row.invoice_id) &&
      CHASER_EMAIL_KINDS.has(String(emailMetadata(row).email_kind ?? '')) &&
      countsAsCustomerInvoiceEmail(row)
  )
  const chasedInvoiceIds = [...new Set(chases.flatMap((row) => row.invoice_id ?? []))]
  if (chasedInvoiceIds.length === 0) return latest

  const { data: owners, error: ownersError } = await supabase
    .from('invoices')
    .select('id, vendor_id')
    .in('id', chasedInvoiceIds)

  if (ownersError) {
    throw new Error(`Could not match recent chases to clients: ${ownersError.message}`)
  }

  const vendorByInvoice = new Map<string, string>()
  for (const row of (owners ?? []) as Array<{ id?: string | null; vendor_id?: string | null }>) {
    if (row.id && row.vendor_id) vendorByInvoice.set(row.id, row.vendor_id)
  }
  for (const row of chases) {
    note(vendorByInvoice.get(row.invoice_id as string), row.sent_at ?? row.created_at)
  }

  return latest
}

/** One invoice, read again from the database. Deleted invoices come back too, as deleted. */
async function loadInvoiceFresh(supabase: AdminClient, invoiceId: string): Promise<InvoiceWithDetails> {
  const { data, error } = await supabase
    .from('invoices')
    .select(REMINDER_INVOICE_SELECT)
    .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
    .eq('id', invoiceId)
    .maybeSingle()

  if (error) throw new Error(error.message || 'the invoice could not be read')
  if (!data) throw new Error('the invoice could not be found')
  return data as InvoiceWithDetails
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

function stageWord(stage: ReminderStage): string {
  if (stage === 'first') return 'first'
  if (stage === 'second') return 'second'
  return 'weekly'
}

function stageTitle(stage: ReminderStage): string {
  if (stage === 'first') return 'First reminder'
  if (stage === 'second') return 'Second reminder'
  return 'Weekly reminder'
}

function reminderKind(stage: ReminderStage): InvoiceEmailKind {
  if (stage === 'first') return 'reminder_first'
  if (stage === 'second') return 'reminder_second'
  return 'reminder_weekly'
}

/** The invoice column that records an accepted reminder of each stage. */
function reminderColumn(
  stage: ReminderStage
): 'reminder_first_sent_at' | 'reminder_second_sent_at' | 'reminder_last_weekly_sent_at' {
  if (stage === 'first') return 'reminder_first_sent_at'
  if (stage === 'second') return 'reminder_second_sent_at'
  return 'reminder_last_weekly_sent_at'
}

/** The Monday of the London week a calendar date falls in. */
function weekStartOf(isoDate: string): string {
  const weekday = getIsoWeekday(isoDate)
  return (weekday ? shiftIsoDate(isoDate, 1 - weekday) : null) ?? isoDate
}

/**
 * The claim for one invoice's reminder. The old job's "cron:invoice-reminder:..." claims are
 * ignored on purpose: they mixed owner alerts with customer sends, so they prove nothing about
 * what a customer received. The hash covers the invoice and stage only, never the days
 * overdue, so the key means the same thing on every day of the window. A weekly chaser's claim
 * also names the London week, so each week has its own and no week can send it twice.
 */
function claimFor(invoiceId: string, stage: ReminderStage, today: string): { key: string; hash: string } {
  if (stage === 'weekly') {
    const week = weekStartOf(today)
    return {
      key: `invoice-reminder:v2:${invoiceId}:weekly:${week}`,
      hash: computeIdempotencyRequestHash({ invoice_id: invoiceId, stage, week }),
    }
  }
  return {
    key: `invoice-reminder:v2:${invoiceId}:${stage}`,
    hash: computeIdempotencyRequestHash({ invoice_id: invoiceId, stage }),
  }
}

/**
 * Closes a claim that must be kept. A failure here is only logged: the claim then stays at
 * "processing", which blocks a resend just as well (see CLAIM_NEVER_STALE_MS).
 */
async function keepClaim(
  supabase: AdminClient,
  key: string,
  hash: string,
  response: Record<string, unknown>
): Promise<void> {
  try {
    await persistIdempotencyResponse(supabase, key, hash, response, CLAIM_TTL_HOURS)
  } catch (error) {
    console.error(`[invoice-reminders] Could not close claim ${key}; it stays held:`, getErrorMessage(error))
  }
}

type WaitingPayment = { date: string; amount: number }

/** Whether a payment waiting for a person names this invoice among its options. */
function namesInvoice(payload: Record<string, unknown> | null, invoiceId: string): boolean {
  const options = Array.isArray(payload?.options) ? (payload?.options as Array<Record<string, unknown>>) : []
  return options.some((option) =>
    [option.allocations, option.entries].some(
      (parts) => Array.isArray(parts) && (parts as Array<Record<string, unknown>>).some((part) => part.invoice_id === invoiceId)
    )
  )
}

/**
 * A payment from this client that is in the bank, dated from a week before the invoice, and not
 * matched to any invoice yet or waiting for a person to match it, that fits what this invoice
 * owes or is offered as paying it. A reminder then risks asking a client who has paid to pay
 * again: Kier was sent a second and a final reminder in September 2026 for an invoice it paid on
 * the 3rd. The bank statement arrives late, so this only helps once it is uploaded.
 */
async function findWaitingClientPayment(supabase: RunContext['supabase'], candidate: Candidate): Promise<WaitingPayment | null> {
  const { data: vendors, error: vendorError } = await supabase
    .from('receipt_vendors')
    .select('id')
    .eq('invoice_vendor_id', candidate.vendorId)
    .limit(100)
  if (vendorError) throw new Error(vendorError.message)
  const vendorIds = ((vendors ?? []) as Array<{ id: string }>).map((vendor) => vendor.id)
  if (!vendorIds.length) return null

  const invoiceDate = String(candidate.invoice.invoice_date ?? '').slice(0, 10)
  const { data: lines, error: lineError } = await supabase
    .from('receipt_transactions')
    .select('id, transaction_date, amount_in')
    .in('vendor_id', vendorIds)
    .gte('transaction_date', shiftIsoDate(invoiceDate, -7) ?? invoiceDate)
    .not('amount_in', 'is', null)
    .order('transaction_date', { ascending: false })
    .limit(50)
  if (lineError) throw new Error(lineError.message)
  const received = ((lines ?? []) as Array<{ id: string; transaction_date: string; amount_in: number | string | null }>).filter(
    (line) => Number(line.amount_in) > 0
  )
  if (!received.length) return null

  const { data: matches, error: matchError } = await supabase
    .from('receipt_invoice_matches')
    .select('receipt_transaction_id, match_status, payload')
    .in('receipt_transaction_id', received.map((line) => line.id))
    .limit(500)
  if (matchError) throw new Error(matchError.message)
  const matchRows = (matches ?? []) as Array<{ receipt_transaction_id: string; match_status: string; payload: Record<string, unknown> | null }>

  const pence = (value: unknown) => Math.round(Number(value ?? 0) * 100)
  const owed = [candidate.balance, candidate.invoice.total_amount].filter((value) => value !== null && value !== undefined).map(pence)
  for (const line of received) {
    const rows = matchRows.filter((match) => match.receipt_transaction_id === line.id)
    const forPerson = rows.filter((match) => match.match_status === 'review_required' && !match.payload?.dismissed_at)
    if (rows.length && !forPerson.length) continue
    const fits = owed.includes(pence(line.amount_in)) || forPerson.some((match) => namesInvoice(match.payload, candidate.invoice.id))
    if (fits) return { date: line.transaction_date, amount: Number(line.amount_in) }
  }
  return null
}

function describeWaitingPayment(waiting: WaitingPayment): string {
  return `${formatInvoiceMoney(waiting.amount)} from this client arrived on ${formatInvoiceDate(waiting.date, { withYear: true })} and is not matched to an invoice yet, so no reminder was sent. Match it on the receipts page, or chase by hand if it was for something else`
}

function sentStage(candidate: Candidate): ReminderStage | null {
  return candidate.decision.action === 'send' ? candidate.decision.stage : null
}

/**
 * The pay online P.S. for an email covering several invoices, one link per invoice that can be
 * paid online. Imported here rather than at the top because the link module is server only.
 */
async function severalPaymentFooter(invoices: InvoiceWithDetails[]): Promise<string> {
  const { invoiceCanOfferPayPal, invoicePortalUrl } = await import('./payment-link-footer')
  const links = invoices
    .filter((invoice) => invoiceCanOfferPayPal(invoice))
    .map((invoice) => ({ invoiceNumber: invoice.invoice_number, url: invoicePortalUrl(invoice.id) }))
  return links.length > 0 ? `\n\n${payOnlinePostscriptForSeveral(links)}` : ''
}

/**
 * Records a weekly chaser whose outcome is unknown as sent, so the next one goes a week from now
 * and never sooner. A failure here is only logged: this week's claim still blocks a repeat.
 */
async function recordWeeklyAttempt(supabase: AdminClient, invoiceId: string, atIso: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('invoices')
      .update({ reminder_last_weekly_sent_at: atIso })
      .eq('id', invoiceId)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message || 'the update failed')
  } catch (error) {
    console.error(
      `[invoice-reminders] Could not record the weekly reminder attempt for invoice ${invoiceId}; this week's claim still blocks a repeat:`,
      getErrorMessage(error)
    )
  }
}

interface TakenClaim {
  candidate: Candidate
  stage: ReminderStage
  key: string
  hash: string
}

/**
 * Hands back the claims of an attempt that sent nothing, so the next run may try again. Returns
 * the ones that could not be released: those stay held.
 */
async function releaseClaims(supabase: AdminClient, taken: TakenClaim[]): Promise<Set<TakenClaim>> {
  const stuck = new Set<TakenClaim>()
  for (const entry of taken) {
    try {
      await releaseIdempotencyClaim(supabase, entry.key, entry.hash)
    } catch (error) {
      stuck.add(entry)
      console.error(`[invoice-reminders] Could not release claim ${entry.key}:`, getErrorMessage(error))
    }
  }
  return stuck
}

/**
 * Tries to send one reminder email to a client, covering every invoice in `batch`: all theirs,
 * oldest due date first, each already decided as "send". With weekly chasers off a batch is
 * always one invoice, and this does exactly what the single-invoice sender did. Several go in
 * one email with each invoice attached (owner decision, 29 October 2026).
 *
 * Returns true when the client must be left alone for the rest of this run: something was
 * attempted, or the invoices could not be checked. Returns false when nothing was attempted and
 * the client's next invoice may be looked at.
 */
async function attemptClientReminder(context: RunContext, batch: Candidate[]): Promise<boolean> {
  const { supabase, today } = context
  const vendorId = batch[0].vendorId
  const weekly = weeklyChasersOn(context)
  // The stage each invoice was picked for. A fresh look that says otherwise leaves it out.
  const wanted = new Map(batch.map((candidate) => [candidate, sentStage(candidate)]))

  // Everything is checked again against fresh data, so a payment, a hold or a chase entered
  // since the run started still counts.
  try {
    const freshEmails = await loadLastClientEmailDates(supabase, [vendorId], today)
    noteLater(context.lastEmailByVendor, vendorId, freshEmails.get(vendorId))
    if (weekly) {
      const freshChasers = await loadLastClientChaserDates(supabase, [vendorId], today)
      noteLater(context.lastChaserByVendor, vendorId, freshChasers.get(vendorId))
    }
    for (const candidate of batch) {
      candidate.invoice = await loadInvoiceFresh(supabase, candidate.invoice.id)
      candidate.decision = decide(candidate, context)
    }
  } catch (error) {
    for (const candidate of batch) {
      addProblem(
        context,
        candidate,
        `Could not re-check the invoice before sending, so nothing was sent: ${getErrorMessage(error)}`
      )
    }
    return true
  }

  const stillDue = batch.filter((candidate) => {
    const stage = sentStage(candidate)
    return stage !== null && stage === wanted.get(candidate)
  })
  if (stillDue.length === 0) return false

  // The bank may already show this client paying, and a reminder would then ask them to pay
  // twice. An invoice that a waiting payment fits is held back; the rest still go.
  const payable: Candidate[] = []
  for (const candidate of stillDue) {
    let waiting: WaitingPayment | null
    try {
      waiting = await findWaitingClientPayment(supabase, candidate)
    } catch (error) {
      addProblem(
        context,
        candidate,
        `Could not check the bank for a payment from this client, so nothing was sent: ${getErrorMessage(error)}`
      )
      return true
    }
    if (waiting) {
      candidate.blocked = { reason: 'payment_waiting', detail: describeWaitingPayment(waiting) }
      continue
    }
    payable.push(candidate)
  }
  if (payable.length === 0) return false

  let recipients: { to: string | null; cc: string[] }
  try {
    const resolved = await resolveVendorInvoiceRecipients(supabase, vendorId, payable[0].invoice.vendor?.email)
    if ('error' in resolved) throw new Error(resolved.error)
    recipients = resolved
  } catch (error) {
    for (const candidate of payable) {
      addProblem(context, candidate, `Could not read who to send to, so nothing was sent: ${getErrorMessage(error)}`)
    }
    return true
  }

  const toAddress = recipients.to
  if (!toAddress) {
    for (const candidate of payable) {
      candidate.blocked = {
        reason: 'no_address',
        detail: 'There is no email address on the client record or its contacts, so no reminder can be sent. Add one, or chase by hand',
      }
    }
    return false
  }

  const firstName = await resolveInvoiceGreetingName(supabase, vendorId)

  // One claim per invoice and stage, all taken before anything is sent.
  const taken: TakenClaim[] = []
  for (const candidate of payable) {
    const stage = sentStage(candidate) as ReminderStage
    const { key, hash } = claimFor(candidate.invoice.id, stage, today)

    let claimState: string
    try {
      const claim = await claimIdempotencyKey(supabase, key, hash, CLAIM_TTL_HOURS, CLAIM_NEVER_STALE_MS)
      claimState = claim.state
    } catch (error) {
      // Nothing has been sent, so whatever this attempt already took goes back.
      for (const entry of await releaseClaims(supabase, taken)) entry.candidate.excludeFromForecast = true
      addProblem(context, candidate, `Could not take the send lock, so nothing was sent: ${getErrorMessage(error)}`)
      return true
    }

    if (claimState !== 'claimed') {
      // The record says this reminder is due, yet a claim for it exists. An earlier attempt
      // either died part way or ended with an unknown outcome. Either way the customer may
      // already hold it.
      candidate.blocked = {
        reason: 'reminder_outcome_unknown',
        detail:
          stage === 'weekly'
            ? 'An earlier attempt this week to send the weekly reminder has an unknown outcome, so no more will be sent this week. Check Sent Items; the next weekly reminder goes next week'
            : weekly
              ? `An earlier attempt to send the ${stageWord(stage)} reminder has an unknown outcome, so it will not be sent again; the weekly reminders take over from 21 days overdue. Check Sent Items before chasing`
              : `An earlier attempt to send the ${stageWord(stage)} reminder has an unknown outcome, so nothing more will be sent automatically. Check Sent Items before chasing`,
      }
      continue
    }
    taken.push({ candidate, stage, key, hash })
  }
  if (taken.length === 0) return false

  const lead = taken[0].candidate
  const reminderInput = (candidate: Candidate) => ({
    firstName,
    invoiceNumber: candidate.invoice.invoice_number,
    balance: candidate.balance ?? 0,
    paid: Number(candidate.invoice.paid_amount) || 0,
    dueDate: String(candidate.invoice.due_date ?? '').slice(0, 10),
  })

  let draft: InvoiceEmailDraft
  let emailKind: InvoiceEmailKind
  let extraAttachments: Array<{ name: string; contentType: string; buffer: Buffer }> | undefined
  let paymentLinkFooter: string | undefined
  try {
    if (taken.length === 1) {
      const { stage } = taken[0]
      const input = reminderInput(lead)
      draft =
        stage === 'first'
          ? buildFirstReminderEmail(input)
          : stage === 'second'
            ? buildSecondReminderEmail(input)
            : buildWeeklyReminderEmail(input)
      emailKind = reminderKind(stage)
    } else {
      draft = buildCombinedReminderEmail({ firstName, invoices: taken.map(({ candidate }) => reminderInput(candidate)) })
      emailKind = 'reminder_combined'
      // The first invoice's PDF is made by the sender. The others are made here, before the
      // send, so a failure leaves nothing half sent.
      const { generateInvoicePDF } = await import('@/lib/pdf-generator')
      extraAttachments = []
      for (const { candidate } of taken.slice(1)) {
        extraAttachments.push({
          name: `invoice-${candidate.invoice.invoice_number}.pdf`,
          contentType: 'application/pdf',
          buffer: await generateInvoicePDF(candidate.invoice),
        })
      }
      paymentLinkFooter = await severalPaymentFooter(taken.map(({ candidate }) => candidate.invoice))
    }
  } catch (error) {
    // Nothing has been sent, so the claims go back and the next run may try again.
    const stuck = await releaseClaims(supabase, taken)
    for (const entry of taken) {
      if (stuck.has(entry)) entry.candidate.excludeFromForecast = true
      addProblem(
        context,
        entry.candidate,
        stuck.has(entry)
          ? `The reminder email could not be put together, so nothing was sent: ${getErrorMessage(error)}. It could not be queued to try again, so chase by hand`
          : `The reminder email could not be put together, so nothing was sent: ${getErrorMessage(error)}. The next run will try again`
      )
    }
    return true
  }

  const unknownOutcome = async (reason: string): Promise<void> => {
    const attemptedAtIso = new Date().toISOString()
    // The email may be in the customer's inbox, so the client counts as emailed today.
    context.lastEmailByVendor.set(vendorId, today)
    for (const { candidate, stage, key, hash } of taken) {
      await keepClaim(supabase, key, hash, {
        state: 'outcome_unknown',
        invoice_id: candidate.invoice.id,
        stage,
        error: reason,
        attempted_at: attemptedAtIso,
      })
      candidate.excludeFromForecast = true
      context.sendFailures.push(candidate.invoice.invoice_number)
      if (stage === 'weekly') {
        // Counted as this week's, so the chasing goes on next week and never twice in one.
        await recordWeeklyAttempt(supabase, candidate.invoice.id, attemptedAtIso)
        context.lastChaserByVendor.set(vendorId, today)
        addProblem(
          context,
          candidate,
          `The weekly reminder may or may not have been sent (${reason}). It counts as this week's, so the next one goes in a week. Check Sent Items`
        )
      } else {
        addProblem(
          context,
          candidate,
          `The ${stageWord(stage)} reminder may or may not have been sent (${reason}). It will not be retried automatically. Check Sent Items before chasing`
        )
      }
    }
  }

  let result: Awaited<ReturnType<typeof sendInvoiceEmail>>
  try {
    result = await sendInvoiceEmail(lead.invoice, toAddress, draft.subject, draft.body, recipients.cc, extraAttachments, {
      emailKind,
      ...(taken.length > 1
        ? { coversInvoiceIds: taken.map(({ candidate }) => candidate.invoice.id), paymentLinkFooter }
        : {}),
    })
  } catch (error) {
    await unknownOutcome(getErrorMessage(error))
    return true
  }

  // A provider id is acceptance even when the sender reports a failure: that combination means
  // the email went and only its log row could not be written.
  const accepted = result.success === true || Boolean(result.messageId)

  if (!accepted) {
    if (failureIsAmbiguous(result)) {
      await unknownOutcome(String(result.error ?? '').trim() || 'no reason was given')
      return true
    }

    // Definitely refused: nothing left the building, so the next run may try again while the
    // reminder is still due. A claim is only ever released when nothing was sent.
    const stuck = await releaseClaims(supabase, taken)
    for (const entry of taken) {
      if (stuck.has(entry)) entry.candidate.excludeFromForecast = true
      context.sendFailures.push(entry.candidate.invoice.invoice_number)
      const word = stageWord(entry.stage)
      addProblem(
        context,
        entry.candidate,
        stuck.has(entry)
          ? `The ${word} reminder was refused and nothing was sent: ${result.error}. It could not be queued to try again, so chase by hand`
          : `The ${word} reminder was refused and nothing was sent: ${result.error}. The next run will try again while the reminder is still due`
      )
    }
    return true
  }

  // ACCEPTED. From here no claim is released, whatever fails.
  const acceptedAtIso = new Date().toISOString()
  context.lastEmailByVendor.set(vendorId, today)
  if (taken.some(({ stage }) => stage === 'weekly')) context.lastChaserByVendor.set(vendorId, today)

  for (const { candidate, stage, key, hash } of taken) {
    const invoice = candidate.invoice
    context.sent.push({
      invoiceNumber: invoice.invoice_number,
      clientName: candidate.clientName,
      to: toAddress,
      stage,
      date: today,
    })

    const column = reminderColumn(stage)
    let recordError: string | null = null
    try {
      // First and second: only where still empty, so the first accepted send is the one that
      // counts. Weekly: always the latest, which is what the seven-day clock runs from.
      const update = supabase.from('invoices').update({ [column]: acceptedAtIso }).eq('id', invoice.id)
      const { error } = await (stage === 'weekly' ? update : update.is(column, null)).select('id').maybeSingle()
      if (error) recordError = error.message || 'the update failed'
    } catch (error) {
      recordError = getErrorMessage(error)
    }

    if (recordError) {
      await keepClaim(supabase, key, hash, {
        state: 'sent_not_recorded',
        invoice_id: invoice.id,
        stage,
        accepted_at: acceptedAtIso,
        error: recordError,
      })
      candidate.excludeFromForecast = true
      context.sendFailures.push(invoice.invoice_number)
      addProblem(
        context,
        candidate,
        stage === 'weekly'
          ? `The weekly reminder was sent to ${toAddress}, but the app could not record it (${recordError}). It will not be sent again this week`
          : weekly
            ? `The ${stageWord(stage)} reminder was sent to ${toAddress}, but the app could not record it (${recordError}). It will not be sent again; the weekly reminders take over from 21 days overdue`
            : `The ${stageWord(stage)} reminder was sent to ${toAddress}, but the app could not record it (${recordError}). It will not be sent again, and no further automatic reminder will follow: chase by hand from here`
      )
    } else {
      candidate.invoice =
        stage === 'first'
          ? { ...invoice, reminder_first_sent_at: acceptedAtIso }
          : stage === 'second'
            ? { ...invoice, reminder_second_sent_at: acceptedAtIso }
            : { ...invoice, reminder_last_weekly_sent_at: acceptedAtIso }
      await keepClaim(supabase, key, hash, {
        state: 'processed',
        invoice_id: invoice.id,
        stage,
        accepted_at: acceptedAtIso,
      })
    }
  }

  // The older per-recipient log, which the Chase Payment dialog's "recent reminder" warning
  // reads: one set of rows for each invoice the email covered. A failure here loses a log line,
  // not an email.
  try {
    const others = taken.length - 1
    const rows = taken.flatMap(({ candidate, stage }) => {
      const days = candidate.decision.action === 'send' ? candidate.decision.daysOverdue : 0
      const shared = others > 0 ? `, in one email with ${others} other ${others === 1 ? 'invoice' : 'invoices'}` : ''
      const body = `${stageTitle(stage)}, ${days} ${days === 1 ? 'day' : 'days'} overdue${shared}`
      return [toAddress, ...recipients.cc].map((address) => ({
        invoice_id: candidate.invoice.id,
        sent_to: address,
        sent_by: 'system',
        subject: draft.subject,
        body,
        status: 'sent',
      }))
    })
    const { error } = await supabase.from('invoice_email_logs').insert(rows)
    if (error) throw new Error(error.message)
  } catch (error) {
    context.warnings += 1
    console.warn(
      `[invoice-reminders] Reminder for ${taken.map(({ candidate }) => candidate.invoice.invoice_number).join(', ')} was sent but its email log could not be written:`,
      getErrorMessage(error)
    )
  }

  return true
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

interface RunCounts {
  processed: number
  marked_overdue: number
  reminders_sent: number
  going_next: number
  needs_you: number
  problems: number
  warnings: number
  summary: SummaryDelivery
}

/**
 * The overdue invoices as candidates, oldest due date first: that is the order reminders go in
 * when a client has several. Also notes when each client was last emailed and, with weekly
 * chasers on, last chased. Shared by the run and the preview, so they read the same things.
 */
async function loadCandidates(context: RunContext): Promise<Candidate[]> {
  const { supabase, today } = context
  const weekly = weeklyChasersOn(context)

  const invoices = await loadOverdueInvoices(supabase, today)
  const invoiceIds = invoices.map((invoice) => invoice.id)
  const privateHireIds = await loadPrivateHireInvoiceIds(supabase, invoiceIds)
  const cancelledIds = weekly ? await loadCancelledBookingInvoiceIds(supabase, invoiceIds) : new Set<string>()
  const vendorIds = [...new Set(invoices.map((invoice) => invoice.vendor_id).filter(Boolean))]
  for (const [vendorId, date] of await loadLastClientEmailDates(supabase, vendorIds, today)) {
    context.lastEmailByVendor.set(vendorId, date)
  }
  if (weekly) {
    for (const [vendorId, date] of await loadLastClientChaserDates(supabase, vendorIds, today)) {
      context.lastChaserByVendor.set(vendorId, date)
    }
  }

  return invoices
    .map((invoice) => ({
      invoice,
      vendorId: invoice.vendor_id,
      clientName: invoice.vendor?.name?.trim() || 'Unknown client',
      isPrivateHire: privateHireIds.has(invoice.id),
      bookingCancelled: cancelledIds.has(invoice.id),
      decision: { action: 'none', reason: 'not_collectable' } as ReminderDecision,
      balance: null,
    }))
    .sort(
      (left, right) =>
        String(left.invoice.due_date).localeCompare(String(right.invoice.due_date)) ||
        String(left.invoice.invoice_number).localeCompare(String(right.invoice.invoice_number))
    )
}

async function processRun(context: RunContext, runId: string): Promise<RunCounts> {
  const { supabase, today, goLiveDate } = context
  const weekly = weeklyChasersOn(context)

  const candidates = await loadCandidates(context)

  let markedOverdue = 0
  for (const candidate of candidates) {
    const { invoice } = candidate
    const daysOverdue = daysBetween(String(invoice.due_date ?? '').slice(0, 10), today)

    // As before: only an invoice the app has a record of emailing is moved to overdue.
    if (daysOverdue !== null && daysOverdue > 0 && invoice.status !== 'overdue' && invoice.sent_at) {
      const { data: updated, error: updateError } = await supabase
        .from('invoices')
        .update({ status: 'overdue', updated_at: new Date().toISOString() })
        .eq('id', invoice.id)
        .in('status', ['sent', 'partially_paid'])
        .select('id')
        .maybeSingle()

      if (updateError) {
        addProblem(context, candidate, `Could not mark the invoice as overdue: ${updateError.message}`)
      } else if (updated) {
        markedOverdue += 1
        candidate.invoice = { ...invoice, status: 'overdue' }
      } else {
        console.warn(
          `[invoice-reminders] Skipping overdue transition for invoice ${invoice.invoice_number}; state changed before update`
        )
      }
    }

    try {
      candidate.decision = decide(candidate, context)
    } catch (error) {
      addProblem(
        context,
        candidate,
        `The amounts on this invoice could not be read, so it was left alone: ${getErrorMessage(error)}`
      )
    }
  }

  // The rules already answer "reminders_off" for every invoice while the switch is unset, so no
  // decision can be "send". This is the belt to that brace: with no go-live date the send step
  // is never entered, whatever the rules say.
  if (goLiveDate) {
    const doneVendors = new Set<string>()
    const notReached: Candidate[] = []
    // Saved after every attempt, not only at the end. A run killed part way through the loop
    // would otherwise leave no record of the reminders it had already sent, and they would
    // never appear in any summary. The row stays "running" until the run finishes.
    const saveProgress = () =>
      saveRun(supabase, runId, 'running', {
        v: 1,
        sent: context.sent,
        problems: context.problems,
        needs_you_keys: [],
        summary: 'pending',
      })

    if (weekly) {
      // One email per client per run, covering every invoice of theirs that is due a reminder,
      // whatever its stage, each attached (owner decision, 29 October 2026).
      for (const group of groupByVendor(candidates)) {
        // Decided again with what this run has learned.
        const due: Candidate[] = []
        for (const candidate of group) {
          try {
            candidate.decision = decide(candidate, context)
          } catch {
            continue
          }
          if (candidate.decision.action === 'send') due.push(candidate)
        }
        if (due.length === 0) continue

        if (Date.now() - context.startedMs > SEND_TIME_BUDGET_MS) {
          notReached.push(...due)
          continue
        }

        if (await attemptClientReminder(context, due)) await saveProgress()
      }
    } else {
      for (const candidate of candidates) {
        // At most one reminder per client per run.
        if (doneVendors.has(candidate.vendorId)) continue

        // Decided again with what this run has learned: an earlier send to the same client, or
        // a fresh look at their recent emails.
        try {
          candidate.decision = decide(candidate, context)
        } catch {
          continue
        }
        if (candidate.decision.action !== 'send') continue

        if (Date.now() - context.startedMs > SEND_TIME_BUDGET_MS) {
          notReached.push(candidate)
          continue
        }

        if (await attemptClientReminder(context, [candidate])) {
          doneVendors.add(candidate.vendorId)
          await saveProgress()
        }
      }
    }

    if (notReached.length > 0) {
      addProblem(
        context,
        null,
        `The run ran out of time before it reached ${notReached.length === 1 ? 'one reminder' : `${notReached.length} reminders`} (${notReached
          .map((candidate) => candidate.invoice.invoice_number)
          .join(', ')}). Nothing was sent for ${notReached.length === 1 ? 'it' : 'them'}, and the next run will pick ${notReached.length === 1 ? 'it' : 'them'} up`
      )
    }
  }

  // A customer send that fails raises an alert as well as a line in the summary. The alert goes
  // to CRON_ALERT_EMAIL by the ordinary email route, so it still arrives when the fault is in
  // the invoice mailbox itself.
  if (context.sendFailures.length > 0) {
    const failures = context.sendFailures.length
    await reportCronFailure(
      INVOICE_REMINDERS_JOB,
      new Error(
        `${failures === 1 ? 'One invoice reminder' : `${failures} invoice reminders`} could not be sent, or may not have been. The daily summary says what to do about each`
      ),
      { run: today, invoices: context.sendFailures.join(', ') }
    )
  }

  // Needs you. An invoice drops off while it is held, as it does once it is paid or void.
  const needsYou: SummaryNeedsYouEntry[] = []
  for (const candidate of candidates) {
    const { invoice } = candidate
    if (heldToday(invoice, today)) continue

    const owed = candidate.balance !== null ? `${formatInvoiceMoney(candidate.balance)} owed. ` : ''
    if (candidate.blocked) {
      needsYou.push({
        invoiceId: invoice.id,
        reason: candidate.blocked.reason,
        invoiceNumber: invoice.invoice_number,
        clientName: candidate.clientName,
        detail: `${owed}${candidate.blocked.detail}`,
        url: invoiceUrl(context, invoice.id),
      })
    } else if (candidate.decision.action === 'needs_owner') {
      needsYou.push({
        invoiceId: invoice.id,
        reason: candidate.decision.reason,
        invoiceNumber: invoice.invoice_number,
        clientName: candidate.clientName,
        detail: `${owed}${describeNeedsOwner(candidate.decision)}`,
        url: invoiceUrl(context, invoice.id),
      })
    }
  }

  // Drafts dated today or earlier that were never emailed: an invoice somebody meant to send.
  const { data: drafts, error: draftsError } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, status, sent_at, reminders_held_until, client:invoice_vendors(name)')
    .eq('status', 'draft')
    .is('deleted_at', null)
    .is('sent_at', null)
    .lte('invoice_date', today)
    .order('invoice_date', { ascending: true })

  if (draftsError) {
    addProblem(context, null, `Could not check for unsent draft invoices: ${draftsError.message}`)
  }

  type DraftRow = {
    id?: string
    invoice_number?: string
    invoice_date?: string
    status?: string
    sent_at?: string | null
    reminders_held_until?: string | null
    client?: { name?: string | null } | Array<{ name?: string | null }> | null
  }
  for (const draft of (drafts ?? []) as DraftRow[]) {
    if (!draft.id || !draft.invoice_number || draft.status !== 'draft' || draft.sent_at) continue
    if (heldToday(draft, today)) continue
    const client = Array.isArray(draft.client) ? draft.client[0] : draft.client
    needsYou.push({
      invoiceId: draft.id,
      reason: 'draft_not_sent',
      invoiceNumber: draft.invoice_number,
      clientName: client?.name?.trim() || 'Unknown client',
      detail: `A draft dated ${formatInvoiceDate(draft.invoice_date)} that has not been emailed. Send it from the invoice page, or delete it`,
      url: invoiceUrl(context, draft.id),
    })
  }

  // Going next: what the rules say the next run would send, oldest first. Without weekly
  // chasers that is one per client; with them, every invoice the client's one email would cover.
  const goingNext: SummaryGoingNextEntry[] = []
  const forecastVendors = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.blocked || candidate.excludeFromForecast || candidate.balance === null) continue
    if (!weekly && forecastVendors.has(candidate.vendorId)) continue

    const reminderInvoice = toReminderInvoice(
      candidate.invoice,
      candidate.isPrivateHire,
      candidate.balance,
      candidate.bookingCancelled
    )
    const stage = isDueOnNextRun(reminderInvoice, {
      today,
      goLiveDate,
      lastClientEmailDate: context.lastEmailByVendor.get(candidate.vendorId) ?? null,
      weeklyFrom: context.weeklyFrom,
      lastClientChaserDate: context.lastChaserByVendor.get(candidate.vendorId) ?? null,
    })
    if (!stage) continue

    forecastVendors.add(candidate.vendorId)
    goingNext.push({
      invoiceNumber: candidate.invoice.invoice_number,
      clientName: candidate.clientName,
      stage,
      url: invoiceUrl(context, candidate.invoice.id),
    })
  }

  const earlier = await loadEarlierRuns(supabase, today)
  if (earlier.readFailed) {
    addProblem(
      context,
      null,
      'The records of earlier runs could not be read, so anything an earlier summary failed to report may be missing here'
    )
  }

  const summary = buildReminderSummary({
    today,
    remindersOn: Boolean(goLiveDate),
    sent: context.sent,
    goingNext,
    needsYou,
    problems: context.problems,
    previousNeedsYouKeys: earlier.previousNeedsYouKeys,
    carriedOver: earlier.carriedOver,
  })

  const keys = needsYouKeys(needsYou)
  // An undelivered summary's content has to reach the next run whole, including whatever this
  // run was itself carrying for an earlier one.
  const undelivered: Pick<ReminderRunState, 'sent' | 'problems'> = {
    sent: [...(earlier.carriedOver?.sent ?? []), ...context.sent],
    problems: [...(earlier.carriedOver?.problems ?? []), ...context.problems],
  }

  let delivery: SummaryDelivery = 'not_needed'
  let summaryError: string | undefined

  if (summary) {
    // Saved before the send, so a run that dies while sending still leaves its results.
    await saveRun(supabase, runId, 'running', { v: 1, ...undelivered, needs_you_keys: keys, summary: 'pending' })

    // By the ordinary email route, not the invoice sender: no invoice id, no PDF, and not
    // pinned to the invoice mailbox, so a fault there is still reported.
    const ownerEmail = process.env.MICROSOFT_USER_EMAIL || 'peter@orangejelly.co.uk'
    try {
      const result = await sendEmail({ to: ownerEmail, subject: summary.subject, text: summary.text })
      delivery = result.success ? 'accepted' : 'failed'
      if (!result.success) summaryError = result.error || 'the email was refused'
    } catch (error) {
      delivery = 'failed'
      summaryError = getErrorMessage(error)
    }

    if (delivery === 'failed') {
      console.error('[invoice-reminders] The daily summary could not be sent:', summaryError)
      await reportCronFailure(
        INVOICE_REMINDERS_JOB,
        new Error(`The daily summary could not be sent: ${summaryError}. Its content is saved on the run record and will be carried into the next summary`),
        { run: today, reminders_sent: context.sent.length, problems: context.problems.length }
      )
    }
  }

  const finalState: ReminderRunState = {
    v: 1,
    ...(delivery === 'failed' ? undelivered : { sent: context.sent, problems: context.problems }),
    needs_you_keys: keys,
    summary: delivery,
    ...(summaryError ? { error: summaryError } : {}),
  }

  // The run is complete whatever happened to the summary: the reminders have gone, and a
  // second trigger today must do nothing.
  const saved = await saveRun(supabase, runId, 'completed', finalState)
  if (!saved) {
    await reportCronFailure(
      INVOICE_REMINDERS_JOB,
      new Error('The run finished but its record could not be saved, so the next summary may repeat or miss entries'),
      { run: today }
    )
  }

  return {
    processed: candidates.length,
    marked_overdue: markedOverdue,
    reminders_sent: context.sent.length,
    going_next: goingNext.length,
    needs_you: needsYou.length,
    problems: context.problems.length,
    warnings: context.warnings,
    summary: delivery,
  }
}

/**
 * The whole job, from the weekday check to the saved run record. Called by the cron route once
 * it has authenticated the request. The response carries counts only, never a name or an
 * address: the manual trigger writes it to the audit log.
 */
export async function runInvoiceReminders(): Promise<ReminderRunResponse> {
  const today = getTodayIsoDate()

  // The schedule is weekdays in UTC. This is the belt to that brace, in London time, and it
  // also covers a manual trigger at the weekend.
  if (!isWeekday(today)) {
    return { status: 200, body: { success: true, skipped: true, reason: 'not_a_weekday', runKey: today } }
  }

  let supabase: AdminClient | null = null
  let runId: string | null = null
  const sent: SummarySentEntry[] = []
  const problems: SummaryProblemEntry[] = []

  try {
    supabase = createAdminClient()
    const run = await acquireRun(supabase, today)
    if (run.skip) {
      logger.info('[invoice-reminders] Nothing to do: the run for today already exists', {
        metadata: { runKey: today, reason: run.reason },
      })
      return { status: 200, body: { success: true, skipped: true, reason: run.reason, runKey: today } }
    }
    runId = run.runId

    // A failed attempt earlier today may already have emailed customers. What it recorded today
    // is part of today's results. Anything older it was carrying is found again, from the runs
    // it came from, when the summary is built.
    sent.push(...(run.earlierAttempt?.sent ?? []).filter((entry) => entry.date === today))
    problems.push(...(run.earlierAttempt?.problems ?? []).filter((entry) => entry.date === today))

    const goLiveDate = invoiceRemindersGoLiveDate()
    const weeklyFrom = invoiceWeeklyRemindersFrom()
    const results = await processRun(
      {
        supabase,
        today,
        goLiveDate,
        weeklyFrom,
        appUrl: getAppUrl(),
        startedMs: Date.now(),
        lastEmailByVendor: new Map(),
        lastChaserByVendor: new Map(),
        sent,
        problems,
        sendFailures: [],
        warnings: 0,
      },
      runId
    )

    logger.info('[invoice-reminders] Run completed', { metadata: { runKey: today, results } })

    return {
      status: 200,
      body: {
        success: true,
        runKey: today,
        reminders_on: Boolean(goLiveDate),
        weekly_chasers_on: Boolean(goLiveDate) && weeklyChasersOn({ today, weeklyFrom }),
        results,
      },
    }
  } catch (error) {
    console.error('[invoice-reminders] Fatal error:', error)
    await reportCronFailure(INVOICE_REMINDERS_JOB, error)
    if (supabase && runId) {
      // Whatever was sent before the failure is kept, so the next summary reports it.
      await saveRun(supabase, runId, 'failed', {
        v: 1,
        sent,
        problems,
        needs_you_keys: [],
        summary: 'pending',
        error: getErrorMessage(error),
      })
    }
    return {
      status: 500,
      body: { error: 'Failed to process invoice reminders', details: getErrorMessage(error) },
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The go-live preview
// ---------------------------------------------------------------------------------------------

interface PreviewLine {
  invoice_number: string
  client: string
  days_overdue: number | null
  balance: string | null
}

/**
 * What a run WOULD send with a given go-live date, without doing anything.
 *
 * READ ONLY. No run record, no invoice marked overdue, no claim, no email, no summary. This is
 * the list the owner is shown, and says yes to, before INVOICE_REMINDERS_GO_LIVE_DATE is set
 * (spec R2, "Go-live check"). It uses the same rules as the real run, and the same
 * one-reminder-per-client order. `asOf` lets it answer for a day other than today, with the
 * balances and emails as they stand now, so it is a forecast for any day but today.
 * `weeklyFrom` answers the same for INVOICE_WEEKLY_REMINDERS_FROM: with it, every invoice a
 * client's one email would cover is listed, and nothing waits for one-per-client.
 *
 * Addresses are not returned, only whether one exists: the output is for a person to read and
 * may be pasted into a message.
 */
export async function previewInvoiceReminders(input: {
  goLiveDate: string | null
  asOf?: string | null
  weeklyFrom?: string | null
}): Promise<ReminderRunResponse> {
  // A real calendar date: one that survives a round trip. The date parser rolls 31 February
  // over into March rather than refusing it.
  const isIsoDate = (value: string | null | undefined): value is string => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }

  if (!isIsoDate(input.goLiveDate)) {
    return { status: 400, body: { error: 'go_live must be a date written as YYYY-MM-DD' } }
  }
  if (input.asOf && !isIsoDate(input.asOf)) {
    return { status: 400, body: { error: 'as_of must be a date written as YYYY-MM-DD' } }
  }
  if (input.weeklyFrom && !isIsoDate(input.weeklyFrom)) {
    return { status: 400, body: { error: 'weekly_from must be a date written as YYYY-MM-DD' } }
  }

  const today = input.asOf || getTodayIsoDate()
  const goLiveDate = input.goLiveDate
  const weeklyFrom = input.weeklyFrom || null

  try {
    const supabase = createAdminClient()
    const context: RunContext = {
      supabase,
      today,
      goLiveDate,
      weeklyFrom,
      appUrl: getAppUrl(),
      startedMs: Date.now(),
      lastEmailByVendor: new Map(),
      lastChaserByVendor: new Map(),
      sent: [],
      problems: [],
      sendFailures: [],
      warnings: 0,
    }
    const weekly = weeklyChasersOn(context)

    const candidates = await loadCandidates(context)

    const wouldSend: Array<PreviewLine & { reminder: string; has_address: boolean }> = []
    const needsYou: Array<PreviewLine & { why: string }> = []
    const waiting: Array<PreviewLine & { why: string }> = []
    const unreadable: string[] = []
    const doneVendors = new Set<string>()

    for (const candidate of candidates) {
      const line = (): PreviewLine => ({
        invoice_number: candidate.invoice.invoice_number,
        client: candidate.clientName,
        days_overdue: daysBetween(String(candidate.invoice.due_date ?? '').slice(0, 10), today),
        balance: candidate.balance !== null ? formatInvoiceMoney(candidate.balance) : null,
      })

      try {
        candidate.decision = decide(candidate, context)
      } catch {
        unreadable.push(candidate.invoice.invoice_number)
        continue
      }
      const decision = candidate.decision

      if (decision.action === 'needs_owner') {
        needsYou.push({ ...line(), why: describeNeedsOwner(decision) })
      } else if (decision.action === 'wait') {
        waiting.push({ ...line(), why: decision.reason })
      } else if (decision.action === 'send') {
        if (!weekly && doneVendors.has(candidate.vendorId)) {
          waiting.push({ ...line(), why: 'one_reminder_per_client_per_run' })
          continue
        }
        let paymentWaiting: WaitingPayment | null = null
        try {
          paymentWaiting = await findWaitingClientPayment(supabase, candidate)
        } catch {
          unreadable.push(candidate.invoice.invoice_number)
          continue
        }
        if (paymentWaiting) {
          needsYou.push({ ...line(), why: describeWaitingPayment(paymentWaiting) })
          continue
        }
        let hasAddress = false
        try {
          const recipients = await resolveVendorInvoiceRecipients(
            supabase,
            candidate.vendorId,
            candidate.invoice.vendor?.email
          )
          hasAddress = !('error' in recipients) && Boolean(recipients.to)
        } catch {
          hasAddress = false
        }
        if (!hasAddress) {
          needsYou.push({ ...line(), why: 'No email address on the client record or its contacts: chase by hand' })
          continue
        }
        // The client's other invoices are reported as waiting for this reason, which says more
        // than "recent email" would.
        doneVendors.add(candidate.vendorId)
        wouldSend.push({ ...line(), reminder: stageWord(decision.stage), has_address: true })
      }
    }

    return {
      status: 200,
      body: {
        preview: true,
        nothing_was_sent_or_changed: true,
        as_of: today,
        go_live_date: goLiveDate,
        weekly_from: weeklyFrom,
        weekly_chasers_on: weekly,
        // With weekly chasers, a client's lines here all go in one email, each invoice attached.
        one_email_per_client: weekly,
        is_a_run_day: isWeekday(today),
        would_send: wouldSend,
        needs_you: needsYou,
        waiting,
        could_not_read: unreadable,
      },
    }
  } catch (error) {
    console.error('[invoice-reminders] Preview failed:', error)
    return { status: 500, body: { error: 'Failed to build the reminder preview', details: getErrorMessage(error) } }
  }
}
