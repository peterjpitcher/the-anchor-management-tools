/**
 * The automatic invoice reminder job (R2 of tasks/spec-2026-10-04-invoice-issuing-and-chasing.md).
 *
 * Runs once per London weekday. It marks invoices overdue, sends at most two reminders per
 * invoice in the owner's own voice, and then sends the owner ONE summary of the run in place
 * of an alert per reminder.
 *
 * What keeps a customer from being emailed wrongly, in the order it is checked:
 *   1. The switch. Without `INVOICE_REMINDERS_GO_LIVE_DATE` the send step is never entered.
 *   2. The rules (`reminder-rules.ts`), which fail closed and are re-run against a fresh read
 *      of the invoice immediately before each send.
 *   3. A claim per invoice and stage, taken before the send.
 *   4. The two columns on the invoice, written once the email is accepted. They are the
 *      lasting record: they do not expire and they survive a changed due date.
 *
 * SENT AND RECORDED ARE TWO DIFFERENT THINGS. Once the email is accepted, nothing here may
 * release the claim, whatever fails afterwards. A send that was definitely refused is released
 * so the next run can retry. A send whose outcome is unknown is kept, never retried, and
 * handed to the owner to check in Sent Items.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { getTodayIsoDate, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
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
  buildFirstReminderEmail,
  buildSecondReminderEmail,
  formatInvoiceDate,
  formatInvoiceMoney,
} from './email-copy'
import { countsAsCustomerInvoiceEmail } from './email-log-rules'
import { resolveInvoiceGreetingName } from './greeting'
import { invoiceRemindersGoLiveDate } from './release-switches'
import {
  QUIET_DAYS,
  daysBetween,
  decideReminder,
  describeNeedsOwner,
  isDueOnNextRun,
  isWeekday,
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
 * platform's time limit is an unknown outcome that stops that invoice's reminders for good.
 * Better to leave the rest for the next run.
 */
const SEND_TIME_BUDGET_MS = 200_000

/** How far back to look for emails to a client. One day more than the rule needs, for margin. */
const RECENT_EMAIL_LOOKBACK_DAYS = QUIET_DAYS + 1

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
 * Failure text that does NOT prove the email was refused. `sendInvoiceEmail` reports a dropped
 * connection the same way as a refusal (success false, with the error as text), so the text is
 * all there is to go on. Anything matching this may have reached the mailbox, and is treated
 * as an unknown outcome: kept, not retried.
 */
const AMBIGUOUS_FAILURE =
  /timed?[ -]?out|ETIMEDOUT|ECONNRESET|ECONNABORTED|EPIPE|EAI_AGAIN|socket hang up|fetch failed|network|aborted|terminated|UND_ERR|gateway|service unavailable|internal server error/i

function failureIsAmbiguous(error: string | null | undefined): boolean {
  const text = String(error ?? '').trim()
  // No reason given is no proof of refusal.
  return text === '' || AMBIGUOUS_FAILURE.test(text)
}

type BlockedReason = 'no_address' | 'reminder_outcome_unknown'

interface Candidate {
  invoice: InvoiceWithDetails
  vendorId: string
  clientName: string
  isPrivateHire: boolean
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
  appUrl: string
  startedMs: number
  /** London date of the latest email to each client, by client id. Updated as the run sends. */
  lastEmailByVendor: Map<string, string>
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
>

/**
 * An invoice row in the shape the rules take. Shared with the invoice page, so its "next
 * reminder" line is worked out from exactly what the job would see.
 */
export function toReminderInvoice(invoice: ReminderInvoiceRow, isPrivateHire: boolean, balance: number): ReminderInvoice {
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
  }
}

/** Decides one invoice against what is known now. Throws when its amounts cannot be read. */
function decide(candidate: Candidate, context: RunContext): ReminderDecision {
  const balance = invoiceBalanceDue(candidate.invoice)
  candidate.balance = balance
  return decideReminder(toReminderInvoice(candidate.invoice, candidate.isPrivateHire, balance), {
    today: context.today,
    goLiveDate: context.goLiveDate,
    lastClientEmailDate: context.lastEmailByVendor.get(candidate.vendorId) ?? null,
  })
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
    .select('id, status, started_at, error_message')
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
  // `error_message` is left alone: it holds what the earlier attempt recorded, and must
  // survive if this attempt dies too.
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

  return { skip: false, runId: existing.id, earlierAttempt: parseRunState(existing.error_message) }
}

/**
 * Saves the run's results on its `cron_job_runs` row. The table has no column for results, so
 * they go in `error_message` as JSON. Nothing treats that column as an error unless the row's
 * status is "failed". Returns false when the save did not happen.
 */
async function saveRun(
  supabase: AdminClient,
  runId: string,
  status: 'running' | 'completed' | 'failed',
  state: ReminderRunState
): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = { status, error_message: serialiseRunState(state) }
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
    .select('run_key, status, error_message')
    .eq('job_name', INVOICE_REMINDERS_JOB)
    .lt('run_key', today)
    .order('run_key', { ascending: false })
    .limit(15)

  if (error) {
    console.error('[invoice-reminders] Could not read earlier runs:', error.message)
    return { previousNeedsYouKeys: null, carriedOver: null, readFailed: true }
  }

  const states = ((data ?? []) as Array<{ error_message?: string | null }>).map((row) =>
    parseRunState(row.error_message)
  )

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
 * The London date of the latest invoice email each client was sent, from two sources:
 *
 *  (a) the invoices' own columns (`sent_at` and the two reminder columns), across ALL of the
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
    .select('vendor_id, sent_at, reminder_first_sent_at, reminder_second_sent_at')
    .in('vendor_id', vendorIds)
    .or(`sent_at.gte.${since},reminder_first_sent_at.gte.${since},reminder_second_sent_at.gte.${since}`)

  if (stampedError) {
    throw new Error(`Could not read when each client was last emailed: ${stampedError.message}`)
  }

  for (const row of (stamped ?? []) as Array<Record<string, string | null | undefined>>) {
    note(row.vendor_id, row.sent_at)
    note(row.vendor_id, row.reminder_first_sent_at)
    note(row.vendor_id, row.reminder_second_sent_at)
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
  return stage === 'first' ? 'first' : 'second'
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

/**
 * Tries to send one reminder. Returns true when the client must be left alone for the rest of
 * this run: something was attempted, or the invoice could not be checked. Returns false when
 * nothing was attempted and the client's next invoice may be looked at.
 */
async function attemptReminder(context: RunContext, candidate: Candidate, stage: ReminderStage): Promise<boolean> {
  const { supabase, today } = context
  const word = stageWord(stage)

  // Everything is checked again against fresh data, so a payment, a hold or a chase entered
  // since the run started still counts.
  try {
    const fresh = await loadInvoiceFresh(supabase, candidate.invoice.id)
    const freshEmails = await loadLastClientEmailDates(supabase, [candidate.vendorId], today)
    const freshDate = freshEmails.get(candidate.vendorId)
    const knownDate = context.lastEmailByVendor.get(candidate.vendorId)
    if (freshDate && (!knownDate || freshDate > knownDate)) {
      context.lastEmailByVendor.set(candidate.vendorId, freshDate)
    }
    candidate.invoice = fresh
    candidate.decision = decide(candidate, context)
  } catch (error) {
    addProblem(
      context,
      candidate,
      `Could not re-check the invoice before sending, so nothing was sent: ${getErrorMessage(error)}`
    )
    return true
  }

  const decision = candidate.decision
  if (decision.action !== 'send' || decision.stage !== stage) {
    return false
  }

  const invoice = candidate.invoice
  const vendor = invoice.vendor
  let recipients: { to: string | null; cc: string[] }
  try {
    const resolved = await resolveVendorInvoiceRecipients(supabase, candidate.vendorId, vendor?.email)
    if ('error' in resolved) throw new Error(resolved.error)
    recipients = resolved
  } catch (error) {
    addProblem(context, candidate, `Could not read who to send to, so nothing was sent: ${getErrorMessage(error)}`)
    return true
  }

  const toAddress = recipients.to
  if (!toAddress) {
    candidate.blocked = {
      reason: 'no_address',
      detail: 'There is no email address on the client record or its contacts, so no reminder can be sent. Add one, or chase by hand',
    }
    return false
  }

  // Built before the claim is taken, so nothing between the claim and the send can fail.
  const firstName = await resolveInvoiceGreetingName(supabase, candidate.vendorId)
  const emailInput = {
    firstName,
    invoiceNumber: invoice.invoice_number,
    balance: candidate.balance ?? 0,
    paid: Number(invoice.paid_amount) || 0,
    dueDate: String(invoice.due_date ?? '').slice(0, 10),
  }
  const draft = stage === 'first' ? buildFirstReminderEmail(emailInput) : buildSecondReminderEmail(emailInput)

  // The old job's "cron:invoice-reminder:..." claims are ignored on purpose: they mixed owner
  // alerts with customer sends, so they prove nothing about what a customer received. The hash
  // covers the invoice and stage only, never the days overdue, so the key means the same thing
  // on every day of the window.
  const claimKey = `invoice-reminder:v2:${invoice.id}:${stage}`
  const claimHash = computeIdempotencyRequestHash({ invoice_id: invoice.id, stage })

  let claimState: string
  try {
    const claim = await claimIdempotencyKey(supabase, claimKey, claimHash, CLAIM_TTL_HOURS, CLAIM_NEVER_STALE_MS)
    claimState = claim.state
  } catch (error) {
    addProblem(context, candidate, `Could not take the send lock, so nothing was sent: ${getErrorMessage(error)}`)
    return true
  }

  if (claimState !== 'claimed') {
    // The stage's column is empty (the rules said send) yet a claim exists. An earlier attempt
    // either died part way or ended with an unknown outcome. Either way the customer may
    // already hold this reminder.
    candidate.blocked = {
      reason: 'reminder_outcome_unknown',
      detail: `An earlier attempt to send the ${word} reminder has an unknown outcome, so nothing more will be sent automatically. Check Sent Items before chasing`,
    }
    return false
  }

  const unknownOutcome = async (reason: string): Promise<void> => {
    await keepClaim(supabase, claimKey, claimHash, {
      state: 'outcome_unknown',
      invoice_id: invoice.id,
      stage,
      error: reason,
      attempted_at: new Date().toISOString(),
    })
    // The email may be in the customer's inbox, so the client counts as emailed today.
    context.lastEmailByVendor.set(candidate.vendorId, today)
    candidate.excludeFromForecast = true
    context.sendFailures.push(invoice.invoice_number)
    addProblem(
      context,
      candidate,
      `The ${word} reminder may or may not have been sent (${reason}). It will not be retried automatically. Check Sent Items before chasing`
    )
  }

  let result: Awaited<ReturnType<typeof sendInvoiceEmail>>
  try {
    result = await sendInvoiceEmail(invoice, toAddress, draft.subject, draft.body, recipients.cc, undefined, {
      emailKind: stage === 'first' ? 'reminder_first' : 'reminder_second',
    })
  } catch (error) {
    await unknownOutcome(getErrorMessage(error))
    return true
  }

  // A provider id is acceptance even when the sender reports a failure: that combination means
  // the email went and only its log row could not be written.
  const accepted = result.success === true || Boolean(result.messageId)

  if (!accepted) {
    if (failureIsAmbiguous(result.error)) {
      await unknownOutcome(String(result.error ?? '').trim() || 'no reason was given')
      return true
    }

    // Definitely refused: nothing left the building, so the next run may try again while the
    // window is open. This is the ONLY place a claim is released.
    let released = true
    try {
      await releaseIdempotencyClaim(supabase, claimKey, claimHash)
    } catch (error) {
      released = false
      console.error(`[invoice-reminders] Could not release claim ${claimKey}:`, getErrorMessage(error))
    }
    if (!released) candidate.excludeFromForecast = true
    context.sendFailures.push(invoice.invoice_number)
    addProblem(
      context,
      candidate,
      released
        ? `The ${word} reminder was refused and nothing was sent: ${result.error}. The next run will try again while the reminder is still due`
        : `The ${word} reminder was refused and nothing was sent: ${result.error}. It could not be queued to try again, so chase by hand`
    )
    return true
  }

  // ACCEPTED. From here the claim is never released, whatever fails.
  const acceptedAtIso = new Date().toISOString()
  context.lastEmailByVendor.set(candidate.vendorId, today)
  context.sent.push({
    invoiceNumber: invoice.invoice_number,
    clientName: candidate.clientName,
    to: toAddress,
    stage,
    date: today,
  })

  const column = stage === 'first' ? 'reminder_first_sent_at' : 'reminder_second_sent_at'
  let recordError: string | null = null
  try {
    // Only where it is still empty: the first accepted send is the one that counts.
    const { error } = await supabase
      .from('invoices')
      .update({ [column]: acceptedAtIso })
      .eq('id', invoice.id)
      .is(column, null)
      .select('id')
      .maybeSingle()
    if (error) recordError = error.message || 'the update failed'
  } catch (error) {
    recordError = getErrorMessage(error)
  }

  if (recordError) {
    await keepClaim(supabase, claimKey, claimHash, {
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
      `The ${word} reminder was sent to ${toAddress}, but the app could not record it (${recordError}). It will not be sent again, and no further automatic reminder will follow: chase by hand from here`
    )
  } else {
    candidate.invoice =
      stage === 'first'
        ? { ...invoice, reminder_first_sent_at: acceptedAtIso }
        : { ...invoice, reminder_second_sent_at: acceptedAtIso }
    await keepClaim(supabase, claimKey, claimHash, {
      state: 'processed',
      invoice_id: invoice.id,
      stage,
      accepted_at: acceptedAtIso,
    })
  }

  // The older per-recipient log, which the Chase Payment dialog's "recent reminder" warning
  // reads. A failure here loses a log line, not an email.
  try {
    const days = decision.daysOverdue
    const body = `${stage === 'first' ? 'First' : 'Second'} reminder, ${days} ${days === 1 ? 'day' : 'days'} overdue`
    const { error } = await supabase.from('invoice_email_logs').insert(
      [toAddress, ...recipients.cc].map((address) => ({
        invoice_id: invoice.id,
        sent_to: address,
        sent_by: 'system',
        subject: draft.subject,
        body,
        status: 'sent',
      }))
    )
    if (error) throw new Error(error.message)
  } catch (error) {
    context.warnings += 1
    console.warn(
      `[invoice-reminders] Reminder for ${invoice.invoice_number} was sent but its email log could not be written:`,
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

async function processRun(context: RunContext, runId: string): Promise<RunCounts> {
  const { supabase, today, goLiveDate } = context

  const invoices = await loadOverdueInvoices(supabase, today)
  const privateHireIds = await loadPrivateHireInvoiceIds(
    supabase,
    invoices.map((invoice) => invoice.id)
  )
  const vendorIds = [...new Set(invoices.map((invoice) => invoice.vendor_id).filter(Boolean))]
  for (const [vendorId, date] of await loadLastClientEmailDates(supabase, vendorIds, today)) {
    context.lastEmailByVendor.set(vendorId, date)
  }

  // Oldest due date first: that is the order reminders go in when a client has several.
  const candidates: Candidate[] = invoices
    .map((invoice) => ({
      invoice,
      vendorId: invoice.vendor_id,
      clientName: invoice.vendor?.name?.trim() || 'Unknown client',
      isPrivateHire: privateHireIds.has(invoice.id),
      decision: { action: 'none', reason: 'not_collectable' } as ReminderDecision,
      balance: null,
    }))
    .sort(
      (left, right) =>
        String(left.invoice.due_date).localeCompare(String(right.invoice.due_date)) ||
        String(left.invoice.invoice_number).localeCompare(String(right.invoice.invoice_number))
    )

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

      if (await attemptReminder(context, candidate, candidate.decision.stage)) {
        doneVendors.add(candidate.vendorId)
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

  // Going next: what the rules say the next run would send, one per client, oldest first.
  const goingNext: SummaryGoingNextEntry[] = []
  const forecastVendors = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.blocked || candidate.excludeFromForecast || candidate.balance === null) continue
    if (forecastVendors.has(candidate.vendorId)) continue

    const stage = isDueOnNextRun(toReminderInvoice(candidate.invoice, candidate.isPrivateHire, candidate.balance), {
      today,
      goLiveDate,
      lastClientEmailDate: context.lastEmailByVendor.get(candidate.vendorId) ?? null,
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
    const results = await processRun(
      {
        supabase,
        today,
        goLiveDate,
        appUrl: getAppUrl(),
        startedMs: Date.now(),
        lastEmailByVendor: new Map(),
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
      body: { success: true, runKey: today, reminders_on: Boolean(goLiveDate), results },
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
