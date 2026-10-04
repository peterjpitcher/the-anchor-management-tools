import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/app/actions/audit'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { reportCronFailure } from '@/lib/cron/alerting'
import { toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { currentEmailSuspensionReason } from '@/lib/email/suspension'
import { getErrorMessage } from '@/lib/errors'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import type { InvoiceWithDetails } from '@/types/invoices'
import { invoiceBalanceDue } from './balance'
import { buildReceiptEmail } from './email-copy'
import { resolveInvoiceGreetingName } from './greeting'
import { invoicePayPalReceiptsFrom } from './release-switches'

/**
 * The receipt a customer gets when a payment lands on an invoice: one email with the receipt
 * PDF attached, once per payment.
 *
 * SERVER ONLY, and it works on the ADMIN client it is handed. Row level security on
 * `invoice_email_logs`, and on the contact tables the recipients and the greeting come from,
 * lets super admins only through. While this lived in the record-payment action and used the
 * signed-in user's client, everyone else's duplicate check found nothing and their log insert
 * was refused. A PayPal notification, where nobody is signed in, could not have used it at all.
 *
 * Three callers: the Record Payment action, `applyInvoicePayPalCapture` straight after a PayPal
 * payment is recorded, and the sweep in the 15 minute PayPal reconciliation job.
 *
 * ONCE PER PAYMENT. Two guards, because either can be missing on its own:
 *  - a claim on the payment (`invoice-receipt:<payment id>`), which stops two callers sending
 *    at the same moment and remembers the result for thirty days;
 *  - a `sent` row in `invoice_email_logs` carrying the payment id, which is the lasting record.
 *
 * It never throws. A receipt is a courtesy on top of money already recorded, so nothing here
 * may fail the payment that called it.
 */

// The generated database types lag the migrations (`invoice_payments.source_kind` is missing
// from them), so this takes the untyped client, as greeting.ts and idempotency.ts do.
type AdminClient = SupabaseClient<any, 'public', any>

type ReceiptSkipReason =
  /** An emergency email switch is on. Nothing is recorded, so it can go once the switch is off. */
  | 'email_suspended'
  | 'email_not_configured'
  | 'invoice_not_found'
  | 'invoice_not_paid'
  | 'payment_not_found'
  | 'no_recipient'
  | 'already_sent'
  /** Another caller holds the claim and is sending it now. */
  | 'in_progress'
  /** An earlier attempt ended without an answer. Its claim is kept, so nothing retries it. */
  | 'outcome_unknown'

/**
 * What happened, in terms the caller can act on.
 *
 *  - sent:    the mail provider accepted it. `warning` is set when our own record of the email
 *             could not be saved. It has still gone, and it is never sent again for that reason.
 *  - skipped: nothing was sent and nothing should be (see the reason).
 *  - refused: definitely not sent. The claim is released, so it can be tried again.
 *             `attemptLogged` is true when the mail provider was asked and said no, and that
 *             failed attempt was written to `invoice_email_logs`. It is false when it never got
 *             as far as the provider (a lookup failed), which leaves no row behind.
 *  - unknown: it may or may not have gone (a timeout, a dropped connection). The claim is KEPT,
 *             nothing retries it, and a person has to look in Sent Items.
 */
export type InvoiceReceiptOutcome =
  | { outcome: 'sent'; invoiceNumber: string; warning?: string }
  | { outcome: 'skipped'; reason: ReceiptSkipReason; invoiceNumber?: string }
  | { outcome: 'refused'; error: string; attemptLogged: boolean; invoiceNumber?: string }
  | { outcome: 'unknown'; error: string; invoiceNumber?: string }

interface ReceiptRecipients {
  to: string | null
  cc: string[]
  /** True when INVOICE_REMITTANCE_TEST_RECIPIENT redirected the receipt away from the client. */
  forced: boolean
}

const RECEIPT_CLAIM_TTL_HOURS = 24 * 30

const RECORD_NOT_SAVED_WARNING = 'The receipt was sent, but the app could not save its record of the email.'

// The same embeds as InvoiceService.getInvoiceById, which is what the receipt PDF has always
// been drawn from. That service reads with the signed-in user's client, so it cannot be used
// from a webhook or a cron.
const RECEIPT_INVOICE_SELECT = `
  *,
  vendor:invoice_vendors(*),
  line_items:invoice_line_items(*),
  payments:invoice_payments(*),
  credits:credit_notes(status, amount_inc_vat)
`

/**
 * `sendInvoiceEmail` never throws: a failed send comes back as `success: false`. That is two
 * different things. `uncertain` marks the one where the request left and no answer came back
 * (a timeout, a dropped connection): the mailbox may have taken the email. That is treated as
 * unknown, which is the safe side: at worst a person checks Sent Items for an email that never
 * left, rather than a customer getting the same receipt twice. Every other failure is a
 * definite refusal and nothing was sent.
 */
type SendResult = Awaited<ReturnType<typeof sendInvoiceEmail>>

function classifySend(result: SendResult): 'accepted' | 'accepted_unrecorded' | 'refused' | 'unknown' {
  if (result.success) return 'accepted'
  // A provider message id means the provider took it. Only our own record of the send failed.
  if (result.messageId) return 'accepted_unrecorded'
  return result.uncertain ? 'unknown' : 'refused'
}

function receiptClaim(paymentId: string): { key: string; hash: string } {
  return {
    key: `invoice-receipt:${paymentId}`,
    // Fixed for the key. There is only ever one receipt per payment, so a second caller must
    // meet the first caller's claim and never a "conflict".
    hash: computeIdempotencyRequestHash({ kind: 'invoice_receipt', payment_id: paymentId }),
  }
}

function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return String(raw)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function forcedTestRecipient(): string | null {
  const candidate = process.env.INVOICE_REMITTANCE_TEST_RECIPIENT?.trim()
  if (!candidate || !candidate.includes('@')) return null
  return candidate
}

type VendorContactRow = {
  email: string | null
  is_primary: boolean | null
  receive_invoice_copy: boolean | null
}

/**
 * Who a receipt for this client goes to.
 *
 * To: the primary contact, else the first address on the client record, else the first contact.
 * Copied: the client record's other addresses, and every contact ticked "Receive invoice copy".
 * `INVOICE_REMITTANCE_TEST_RECIPIENT` replaces all of that with one address, for testing.
 */
export async function resolveReceiptRecipients(
  supabase: AdminClient,
  vendorId: string,
  vendorEmailRaw: string | null | undefined
): Promise<ReceiptRecipients | { error: string }> {
  const forced = forcedTestRecipient()
  if (forced) return { to: forced, cc: [], forced: true }

  const recipientsFromVendor = parseRecipientList(vendorEmailRaw)

  const { data: contacts, error } = await supabase
    .from('invoice_vendor_contacts')
    .select('email, is_primary, receive_invoice_copy')
    .eq('vendor_id', vendorId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    return { error: getErrorMessage(error) }
  }

  const contactEmails = ((contacts ?? []) as VendorContactRow[])
    .map((contact) => ({
      email: typeof contact?.email === 'string' ? contact.email.trim() : '',
      isPrimary: !!contact?.is_primary,
      cc: !!contact?.receive_invoice_copy,
    }))
    .filter((contact) => contact.email && contact.email.includes('@'))

  const primaryEmail = contactEmails.find((contact) => contact.isPrimary)?.email || null
  const firstVendorEmail = recipientsFromVendor[0] || null
  const to = primaryEmail || firstVendorEmail || contactEmails[0]?.email || null

  const ccRaw = [
    ...recipientsFromVendor.slice(firstVendorEmail ? 1 : 0),
    ...contactEmails.filter((contact) => contact.cc).map((contact) => contact.email),
  ]

  const seen = new Set<string>()
  const toLower = to ? to.toLowerCase() : null
  const cc = ccRaw
    .map((email) => email.trim())
    .filter((email) => email && email.includes('@') && email.toLowerCase() !== toLower)
    .filter((email) => {
      const key = email.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return { to, cc, forced: false }
}

/**
 * Sends the receipt for one payment and says what happened. See `InvoiceReceiptOutcome`.
 *
 * `sentByUserId` is the member of staff who recorded the payment, or nothing for a PayPal
 * payment, where no one is signed in.
 */
export async function sendInvoiceReceipt(
  admin: AdminClient,
  input: { invoiceId: string; paymentId: string; sentByUserId?: string | null }
): Promise<InvoiceReceiptOutcome> {
  const { invoiceId, paymentId } = input
  const sentBy = input.sentByUserId || null
  const claim = receiptClaim(paymentId)

  // How far it got, for the catch at the bottom: an error before the send is a plain refusal,
  // one during it is unknown, and one after the provider said yes must still report it as sent.
  let invoiceNumber: string | undefined
  let claimHeld = false
  let sendStarted = false
  let accepted = false
  let recipients: ReceiptRecipients | null = null
  let subject = ''
  let body = ''

  const settleClaim = async (state: 'sent' | 'unknown'): Promise<boolean> => {
    try {
      await persistIdempotencyResponse(
        admin,
        claim.key,
        claim.hash,
        { state, invoice_id: invoiceId, payment_id: paymentId, settled_at: new Date().toISOString() },
        RECEIPT_CLAIM_TTL_HOURS
      )
      return true
    } catch (error) {
      console.error(`[InvoiceReceipt] Could not save the receipt claim as ${state}:`, getErrorMessage(error))
      return false
    }
  }

  const releaseClaim = async (): Promise<void> => {
    try {
      await releaseIdempotencyClaim(admin, claim.key, claim.hash)
    } catch (error) {
      // Left in place it is treated as abandoned after ten minutes, so a retry is delayed, not lost.
      console.error('[InvoiceReceipt] Could not release the receipt claim:', getErrorMessage(error))
    }
    claimHeld = false
  }

  const writeLog = async (status: 'sent' | 'failed', errorMessage?: string): Promise<boolean> => {
    if (!recipients?.to) return false
    // A sent receipt is logged once per address, as invoices are. A failed one is logged once.
    const addresses = status === 'sent' ? [recipients.to, ...recipients.cc] : [recipients.to]
    try {
      const { error } = await admin.from('invoice_email_logs').insert(
        addresses.map((address) => ({
          invoice_id: invoiceId,
          payment_id: paymentId,
          sent_to: address,
          sent_by: sentBy,
          subject,
          body,
          status,
          ...(errorMessage ? { error_message: errorMessage } : {}),
        }))
      )
      if (error) {
        console.error('[InvoiceReceipt] Failed to write the receipt email log:', getErrorMessage(error))
        return false
      }
      return true
    } catch (error) {
      console.error('[InvoiceReceipt] Failed to write the receipt email log:', getErrorMessage(error))
      return false
    }
  }

  const audit = async (action: string, errorMessage?: string): Promise<void> => {
    try {
      await logAuditEvent({
        ...(sentBy ? { user_id: sentBy } : {}),
        operation_type: 'send',
        resource_type: 'invoice',
        resource_id: invoiceId,
        operation_status: errorMessage ? 'failure' : 'success',
        ...(errorMessage ? { error_message: errorMessage } : {}),
        additional_info: {
          action,
          invoice_number: invoiceNumber,
          payment_id: paymentId,
          recipient: recipients?.to ?? null,
          cc: recipients?.cc ?? [],
          receipt_test_override: recipients?.forced ? { forced_to: recipients.to } : null,
        },
      })
    } catch (error) {
      console.error('[InvoiceReceipt] Failed to write the receipt audit entry:', getErrorMessage(error))
    }
  }

  const keepAsUnknown = async (message: string): Promise<InvoiceReceiptOutcome> => {
    // Saved as an answer rather than left as a bare claim. An unanswered claim is treated as
    // abandoned after ten minutes and taken over, which is exactly the retry this must not get.
    await settleClaim('unknown')
    await writeLog('failed', `Outcome unknown, check Sent Items before resending: ${message}`)
    await audit('receipt_outcome_unknown', message)
    return { outcome: 'unknown', error: message, invoiceNumber }
  }

  try {
    // Checked first so a suspension leaves no claim and no failed attempt behind: the receipt
    // can still go, from the sweep, once the switch is off.
    if (currentEmailSuspensionReason()) {
      return { outcome: 'skipped', reason: 'email_suspended' }
    }
    if (!isGraphConfigured()) {
      return { outcome: 'skipped', reason: 'email_not_configured' }
    }

    const loaded = await admin
      .from('invoices')
      .select(RECEIPT_INVOICE_SELECT)
      .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .maybeSingle()

    if (loaded.error) {
      return {
        outcome: 'refused',
        error: `Could not load the invoice: ${getErrorMessage(loaded.error)}`,
        attemptLogged: false,
      }
    }
    const invoice = (loaded.data as InvoiceWithDetails | null) ?? null
    if (!invoice) {
      return { outcome: 'skipped', reason: 'invoice_not_found' }
    }
    invoiceNumber = invoice.invoice_number

    if (invoice.status !== 'paid' && invoice.status !== 'partially_paid') {
      return { outcome: 'skipped', reason: 'invoice_not_paid', invoiceNumber }
    }

    const payment = (invoice.payments ?? []).find((row) => row.id === paymentId)
    if (!payment) {
      return { outcome: 'skipped', reason: 'payment_not_found', invoiceNumber }
    }

    const existingLog = await admin
      .from('invoice_email_logs')
      .select('id')
      .eq('payment_id', paymentId)
      .eq('status', 'sent')
      .limit(1)

    if (existingLog.error) {
      // Not knowing whether it has gone is a reason to wait, not to send.
      return {
        outcome: 'refused',
        error: `Could not check for an earlier receipt: ${getErrorMessage(existingLog.error)}`,
        attemptLogged: false,
        invoiceNumber,
      }
    }
    if ((existingLog.data ?? []).length > 0) {
      return { outcome: 'skipped', reason: 'already_sent', invoiceNumber }
    }

    const resolved = await resolveReceiptRecipients(admin, invoice.vendor_id, invoice.vendor?.email ?? null)
    if ('error' in resolved) {
      console.error('[InvoiceReceipt] Failed to resolve receipt recipients:', resolved.error)
      return {
        outcome: 'refused',
        error: `Could not work out who to send it to: ${resolved.error}`,
        attemptLogged: false,
        invoiceNumber,
      }
    }
    if (!resolved.to) {
      return { outcome: 'skipped', reason: 'no_recipient', invoiceNumber }
    }
    recipients = resolved

    const claimed = await claimIdempotencyKey(admin, claim.key, claim.hash, RECEIPT_CLAIM_TTL_HOURS)
    if (claimed.state === 'replay') {
      const earlier = (claimed.response as { state?: string } | null)?.state
      return {
        outcome: 'skipped',
        reason: earlier === 'unknown' ? 'outcome_unknown' : 'already_sent',
        invoiceNumber,
      }
    }
    if (claimed.state !== 'claimed') {
      return { outcome: 'skipped', reason: 'in_progress', invoiceNumber }
    }
    claimHeld = true

    const paymentAmount = Number(payment.amount)
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      // A receipt for "£0.00" or "£NaN" must never reach a customer.
      await releaseClaim()
      return { outcome: 'refused', error: 'The payment has no usable amount', attemptLogged: false, invoiceNumber }
    }

    // The invoice was read after the payment was recorded, so this is what is left to pay now.
    const balance = invoiceBalanceDue(invoice)
    const firstName = await resolveInvoiceGreetingName(admin, invoice.vendor_id)
    const draft = buildReceiptEmail({
      firstName,
      invoiceNumber: invoice.invoice_number,
      paymentAmount,
      balance,
    })
    subject = draft.subject
    body = draft.body

    const settledInFull = invoice.status === 'paid' && balance === 0
    const pdfFilename = settledInFull
      ? `receipt-${invoice.invoice_number}.pdf`
      : `receipt-${invoice.invoice_number}-partial.pdf`

    sendStarted = true
    const result = await sendInvoiceEmail(invoice, resolved.to, subject, body, resolved.cc, undefined, {
      documentKind: 'remittance_advice',
      pdfFilename,
      remittance: {
        paymentDate: payment.payment_date || null,
        paymentAmount,
        paymentMethod: payment.payment_method || null,
        paymentReference: payment.reference || null,
      },
      emailKind: 'receipt',
    })

    const verdict = classifySend(result)

    if (verdict === 'accepted' || verdict === 'accepted_unrecorded') {
      accepted = true
      const logged = await writeLog('sent')
      // The claim is what stops a second send when the log row above could not be written.
      const settled = await settleClaim('sent')
      await audit('receipt_sent')
      const recordSaved = verdict === 'accepted' && logged && settled
      return {
        outcome: 'sent',
        invoiceNumber: invoice.invoice_number,
        ...(recordSaved ? {} : { warning: RECORD_NOT_SAVED_WARNING }),
      }
    }

    const errorMessage = result.error || 'Failed to send receipt'

    if (verdict === 'unknown') {
      return await keepAsUnknown(errorMessage)
    }

    const attemptLogged = await writeLog('failed', errorMessage)
    await releaseClaim()
    await audit('receipt_send_failed', errorMessage)
    return { outcome: 'refused', error: errorMessage, attemptLogged, invoiceNumber }
  } catch (error) {
    const message = getErrorMessage(error)
    console.error('[InvoiceReceipt] Receipt dispatch failed:', message)

    if (accepted) {
      await settleClaim('sent')
      return { outcome: 'sent', invoiceNumber: invoiceNumber ?? '', warning: RECORD_NOT_SAVED_WARNING }
    }
    if (sendStarted) {
      return await keepAsUnknown(message)
    }
    if (claimHeld) {
      await releaseClaim()
    }
    return { outcome: 'refused', error: message, attemptLogged: false, invoiceNumber }
  }
}

// ---------------------------------------------------------------------------
// PayPal payments
//
// Everything below is off unless INVOICE_PAYPAL_RECEIPTS_FROM holds a date.
// ---------------------------------------------------------------------------

const SWEEP_WINDOW_DAYS = 7
const SWEEP_CANDIDATES = 200
const SWEEP_SEND_CAP = 20
/**
 * Refused attempts before the sweep gives a payment up and asks a person to send it. Without a
 * limit an address on the block list would be tried, and logged as failed, every 15 minutes
 * for a week.
 */
const MAX_REFUSED_ATTEMPTS = 3

/**
 * Whether the switch covers a payment: recorded on or after the switch date, both as London
 * calendar dates. `created_at` is when the app recorded it, which is what "recorded" means
 * here. It is not the day PayPal took the money, which can be earlier when the 15 minute check
 * is what found the payment.
 */
function payPalReceiptIsDue(createdAt: string | null | undefined, switchDate: string): boolean {
  if (!createdAt) return false
  const recordedAt = new Date(createdAt)
  if (Number.isNaN(recordedAt.getTime())) return false
  return toLocalIsoDate(recordedAt) >= switchDate
}

async function alertReceiptNeedsAPerson(invoiceNumber: string | undefined, problem: string, path: string): Promise<void> {
  const invoiceLabel = invoiceNumber ? `invoice ${invoiceNumber}` : 'an invoice (number not known)'
  // Logged as well as emailed: the alert email is skipped when CRON_ALERT_EMAIL is not set.
  console.error(`[InvoiceReceipt] The receipt for ${invoiceLabel} needs a person to check it (${path})`)
  try {
    // The invoice number only. Never a customer's name or address: this goes to a shared inbox.
    // `reportCronFailure` also strips any address a provider put in its own error text.
    await reportCronFailure('invoice-paypal-receipt', new Error(`The receipt for ${invoiceLabel} ${problem}`), {
      invoice_number: invoiceNumber ?? 'not known',
      path,
    })
  } catch (error) {
    console.error('[InvoiceReceipt] Could not raise the receipt alert:', getErrorMessage(error))
  }
}

async function alertUnknownOutcome(invoiceNumber: string | undefined, path: string): Promise<void> {
  await alertReceiptNeedsAPerson(
    invoiceNumber,
    'may or may not have been sent. Check Sent Items in the Orange Jelly mailbox before sending a receipt by hand.',
    path
  )
}

/**
 * The receipt for a PayPal payment this request has just recorded.
 *
 * Never throws and returns nothing: the capture that called it has already answered. Anything
 * that stops it here is picked up by `sweepPayPalReceipts` within 15 minutes.
 */
export async function sendReceiptForPayPalCapture(
  admin: AdminClient,
  params: { invoiceId: string; captureId: string; source: string }
): Promise<void> {
  try {
    const switchDate = invoicePayPalReceiptsFrom()
    if (!switchDate) return

    // The payment RPC does not return the row it wrote. The capture id is its reference, and
    // is unique among PayPal payments.
    const { data: payment, error } = await admin
      .from('invoice_payments')
      .select('id, created_at')
      .eq('source_kind', 'paypal')
      .eq('reference', params.captureId.trim())
      .maybeSingle()

    if (error || !payment) {
      console.error(
        '[InvoiceReceipt] Could not find the PayPal payment to send its receipt; the sweep will retry:',
        error ? getErrorMessage(error) : 'no payment row for the capture'
      )
      return
    }

    const row = payment as { id: string; created_at: string | null }
    if (!payPalReceiptIsDue(row.created_at, switchDate)) return

    const outcome = await sendInvoiceReceipt(admin, { invoiceId: params.invoiceId, paymentId: row.id })

    if (outcome.outcome === 'unknown') {
      await alertUnknownOutcome(outcome.invoiceNumber, `after capture (${params.source})`)
    } else if (outcome.outcome === 'refused') {
      console.error('[InvoiceReceipt] PayPal receipt refused; the sweep will retry:', outcome.error)
    } else if (outcome.outcome === 'sent' && outcome.warning) {
      console.warn(`[InvoiceReceipt] ${outcome.warning} (invoice ${outcome.invoiceNumber})`)
    }
  } catch (error) {
    console.error('[InvoiceReceipt] PayPal receipt after capture failed; the sweep will retry:', getErrorMessage(error))
  }
}

export interface PayPalReceiptSweepResult {
  /** PayPal payments in the window with no receipt on record. */
  owed: number
  sent: number
  skipped: number
  refused: number
  unknown: number
}

/**
 * Sends the receipts that `sendReceiptForPayPalCapture` did not get to.
 *
 * If the process stops between a PayPal payment being recorded and its receipt being sent,
 * every later path finds the payment already recorded and would skip the receipt for good.
 * The payment row is the lasting record that a receipt is owed, so this looks for PayPal
 * payments from the last seven days, recorded on or after the switch date, with no `sent` row
 * in `invoice_email_logs`, and sends those. Nothing new is stored.
 *
 * Returns null, having queried nothing, when the switch is off. Stops starting new sends once
 * `deadline` (a `Date.now()` value) has passed, so it cannot run the job out of time.
 *
 * Throws only if one of its two reads fails. The caller must not let that fail its own work.
 */
export async function sweepPayPalReceipts(
  admin: AdminClient,
  options: { now?: Date; deadline?: number } = {}
): Promise<PayPalReceiptSweepResult | null> {
  const switchDate = invoicePayPalReceiptsFrom()
  if (!switchDate) return null

  const now = options.now ?? new Date()
  const windowStart = new Date(now.getTime() - SWEEP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const switchStart = whenLondonClockReaches(switchDate, '00:00')
  if (!switchStart) return null
  const since = switchStart > windowStart ? switchStart : windowStart

  const { data: payments, error: paymentsError } = await admin
    .from('invoice_payments')
    .select('id, invoice_id, created_at')
    .eq('source_kind', 'paypal')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })
    .limit(SWEEP_CANDIDATES)

  if (paymentsError) throw new Error(`Could not read PayPal payments: ${getErrorMessage(paymentsError)}`)

  const candidates = ((payments ?? []) as Array<{ id: string; invoice_id: string; created_at: string | null }>)
    .filter((payment) => payPalReceiptIsDue(payment.created_at, switchDate))

  const summary: PayPalReceiptSweepResult = { owed: 0, sent: 0, skipped: 0, refused: 0, unknown: 0 }
  if (candidates.length === 0) return summary

  const { data: logs, error: logsError } = await admin
    .from('invoice_email_logs')
    .select('payment_id, status')
    .in('payment_id', candidates.map((payment) => payment.id))
    .limit(1000)

  if (logsError) throw new Error(`Could not read receipt email logs: ${getErrorMessage(logsError)}`)

  const sentFor = new Set<string>()
  const failedAttempts = new Map<string, number>()
  for (const log of (logs ?? []) as Array<{ payment_id: string | null; status: string | null }>) {
    if (!log.payment_id) continue
    if (log.status === 'sent') sentFor.add(log.payment_id)
    if (log.status === 'failed') failedAttempts.set(log.payment_id, (failedAttempts.get(log.payment_id) ?? 0) + 1)
  }

  const owed = candidates.filter(
    (payment) => !sentFor.has(payment.id) && (failedAttempts.get(payment.id) ?? 0) < MAX_REFUSED_ATTEMPTS
  )
  summary.owed = owed.length

  // Oldest first. Only an email put to the provider counts towards the cap: a payment that is
  // looked at and left (a kept claim, a client with no address) must not use up a place every
  // run and hold newer receipts back.
  let attempts = 0
  for (const payment of owed) {
    if (attempts >= SWEEP_SEND_CAP) break
    if (options.deadline !== undefined && Date.now() > options.deadline) break

    const outcome = await sendInvoiceReceipt(admin, { invoiceId: payment.invoice_id, paymentId: payment.id })

    if (outcome.outcome === 'skipped') {
      summary.skipped += 1
      continue
    }
    attempts += 1

    if (outcome.outcome === 'sent') {
      summary.sent += 1
      if (outcome.warning) console.warn(`[InvoiceReceipt] ${outcome.warning} (invoice ${outcome.invoiceNumber})`)
    } else if (outcome.outcome === 'unknown') {
      summary.unknown += 1
      await alertUnknownOutcome(outcome.invoiceNumber, 'reconciliation sweep')
    } else {
      summary.refused += 1
      console.error(`[InvoiceReceipt] PayPal receipt refused for invoice ${outcome.invoiceNumber ?? 'unknown'}:`, outcome.error)
      // Only an attempt the provider turned down, and that reached the log, counts towards the
      // limit. A lookup that failed on our side leaves no row and is simply tried again.
      if (outcome.attemptLogged && (failedAttempts.get(payment.id) ?? 0) + 1 >= MAX_REFUSED_ATTEMPTS) {
        await alertReceiptNeedsAPerson(
          outcome.invoiceNumber,
          `was refused ${MAX_REFUSED_ATTEMPTS} times and will not be tried again. Send a receipt by hand. Last error: ${outcome.error}`,
          'reconciliation sweep'
        )
      }
    }
  }

  return summary
}
