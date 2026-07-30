// Voucher reminder sender (spec 5.2, F17/F18/F19/F51).
//
// Cadence: two reminders per voucher, both counted back from the EXPIRY date -
// 'pre_expiry_7' (7 days before) and 'pre_expiry_3' (3 days before). Vouchers are
// normally valid one month from issue, so both land inside that window.
//
// Channel: email is preferred, SMS is the fallback for customers with no usable
// email address. A row with neither channel is marked 'skipped' with a reason.
//
// The DB owns the outbox: voucher_reminders_claim_due atomically claims due
// pending rows (one per customer per London day, attempts bumped, others
// deferred) and this module sends each one, then records the outcome via
// voucher_reminder_mark with the channel actually used. The claim + mark pair is
// the idempotency guard; nothing here writes reminder rows directly.

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email/emailService'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { countSmsSeptets, normaliseToGsm7, GSM7_SINGLE_SEGMENT_LIMIT } from '@/lib/sms/gsm7'
import { formatDateInLondon } from '@/lib/dateUtils'

const CLAIM_BATCH_SIZE = 50
// Hard safety cap per run: 10 claim batches. Anything beyond this waits for
// the next day's pass rather than risking an unbounded send loop.
const MAX_REMINDERS_PER_RUN = 500
const MAX_STORED_ERROR_LENGTH = 500
const TEMPLATE_KEY = 'voucher_reminder'
// Keeps the fixed part of the SMS bounded so the one-segment guarantee holds.
const SMS_MAX_FIRST_NAME_CHARS = 20

// Hard-negative email states, mirroring isEmailEligible in
// src/lib/notifications/notify.ts and isReviewEmailEligible in the
// event-guest-engagement cron. Anything in this set (or a set
// email_deactivated_at) means the address must not be used.
const BLOCKED_EMAIL_STATUSES = ['invalid', 'bounced', 'complained']
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type AdminClient = ReturnType<typeof createAdminClient>

// The reminder kinds this sender knows how to write copy for. The DB owns the
// reminder_kind enum; these are the two values it emits (see the 20260802
// migrations). Kept local so the copy switch stays exhaustive.
type ReminderCopyKind = 'pre_expiry_7' | 'pre_expiry_3'

export type VoucherReminderChannel = 'email' | 'sms'

// Exactly the fields voucher_reminders_claim_due returns.
interface ClaimedVoucherReminder {
  reminder_id: string
  voucher_id: string
  voucher_number: string
  reminder_kind: string
  scheduled_for: string
  customer_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  mobile_e164: string | null
  sms_opt_in: boolean | null
  marketing_email_opt_in: boolean | null
  expiry_date: string | null
  won_at_label: string | null
  prize_label: string | null
}

interface ClaimDueResponse {
  success?: boolean
  message?: string
  claimed?: ClaimedVoucherReminder[]
}

interface ReminderMarkResponse {
  success?: boolean
  error_code?: string
  message?: string
}

export interface VoucherReminderSendResult {
  claimed: number
  sentEmail: number
  sentSms: number
  skipped: number
  failed: number
}

interface ReminderCopyInput {
  kind: ReminderCopyKind
  firstName: string | null
  prizeLabel: string | null
  wonAtLabel: string | null
  expiryDate: string
  londonToday: string
}

export interface VoucherReminderEmailCopy {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// The DB enum only carries the two pre-expiry kinds. Anything unexpected is
// treated as the gentler 7-day copy rather than failing the send.
function toCopyKind(reminderKind: string): ReminderCopyKind {
  return reminderKind === 'pre_expiry_3' ? 'pre_expiry_3' : 'pre_expiry_7'
}

// '28 October', or '28 October 2027' when the expiry falls in a later year.
function formatExpiryForCopy(expiryDate: string, londonToday: string): string {
  const sameYear = expiryDate.slice(0, 4) === londonToday.slice(0, 4)
  return formatDateInLondon(
    expiryDate,
    sameYear
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' }
  )
}

function resolveCopyParts(input: ReminderCopyInput): {
  firstName: string
  prize: string
  origin: string
  expiry: string
} {
  const wonAt = input.wonAtLabel?.trim()
  return {
    firstName: getSmartFirstName(input.firstName) || 'there',
    prize: input.prizeLabel?.trim() || 'prize',
    origin: wonAt ? ` from ${wonAt}` : '',
    expiry: formatExpiryForCopy(input.expiryDate, input.londonToday)
  }
}

function composeSmsBody(
  kind: ReminderCopyKind,
  parts: { firstName: string; prize: string; origin: string; expiry: string }
): string {
  const { firstName, prize, origin, expiry } = parts
  return kind === 'pre_expiry_3'
    ? `Hi ${firstName}, just a few days left to use your ${prize} voucher${origin} at The Anchor. Show the card by ${expiry}. See you soon!`
    : `Hi ${firstName}, your ${prize} voucher${origin} is waiting at The Anchor. Show the card by ${expiry}. See you soon!`
}

// Always exactly one GSM-7 segment.
//
// Straight apostrophes only and no dashes: a single curly quote would force
// UCS-2 and halve the limit to 70 characters. prize_label and won_at_label are
// free text typed by staff, so length is not guaranteed. Rather than silently
// paying for a second segment we degrade: drop where it was won, then trim the
// prize. The first name is capped so the fixed part of the message is bounded
// and the last attempt always fits.
export function buildVoucherReminderSms(input: ReminderCopyInput): string {
  const parts = resolveCopyParts(input)
  const firstName = parts.firstName.slice(0, SMS_MAX_FIRST_NAME_CHARS).trimEnd() || 'there'
  const build = (prize: string, origin: string) =>
    normaliseToGsm7(composeSmsBody(input.kind, { firstName, prize, origin, expiry: parts.expiry }))
  const fits = (body: string) => countSmsSeptets(body) <= GSM7_SINGLE_SEGMENT_LIMIT

  const full = build(parts.prize, parts.origin)
  if (fits(full)) return full

  // Where it was won is nice to have, so it goes first.
  const withoutOrigin = build(parts.prize, '')
  if (fits(withoutOrigin)) return withoutOrigin

  const overhead = countSmsSeptets(build('', ''))
  const room = Math.max(0, GSM7_SINGLE_SEGMENT_LIMIT - overhead)
  const trimmedPrize = normaliseToGsm7(parts.prize).slice(0, room).trimEnd() || 'prize'
  return build(trimmedPrize, '')
}

export function buildVoucherReminderEmail(input: ReminderCopyInput): VoucherReminderEmailCopy {
  const { firstName, prize, origin, expiry } = resolveCopyParts(input)
  const finalNudge = input.kind === 'pre_expiry_3'

  const subject = finalNudge
    ? `Just a few days left to use your ${prize} voucher`
    : `Your ${prize} voucher is waiting at The Anchor`

  const opening = finalNudge
    ? `There are just a few days left to use your ${prize} voucher${origin} at The Anchor.`
    : `Your ${prize} voucher${origin} is still waiting for you at The Anchor.`
  const deadline = finalNudge ? `It runs out on ${expiry}.` : `It is valid until ${expiry}.`

  const lines = [
    `Hi ${firstName},`,
    opening,
    `${deadline} Just show the card at the bar and we will sort you out.`,
    'See you soon,',
    'The Anchor'
  ]

  return {
    subject,
    text: lines.join('\n\n'),
    html: [
      '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">',
      ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
      '</div>'
    ].join('')
  }
}

function trimStoredError(text: string | null | undefined, fallback: string): string {
  return (text?.trim() || fallback).slice(0, MAX_STORED_ERROR_LENGTH)
}

async function markReminderOutcome(
  supabase: AdminClient,
  reminderId: string,
  status: 'sent' | 'failed' | 'skipped',
  options: {
    messageSid?: string | null
    errorText?: string | null
    channel?: VoucherReminderChannel | null
  } = {}
): Promise<void> {
  const { data, error } = await supabase.rpc('voucher_reminder_mark', {
    p_id: reminderId,
    p_status: status,
    p_message_sid: options.messageSid ?? null,
    p_error: options.errorText ?? null,
    p_channel: options.channel ?? null
  })

  if (error) {
    logger.error('Voucher reminder mark failed', {
      error: new Error(error.message),
      metadata: { reminderId, status, channel: options.channel ?? null }
    })
    return
  }

  const payload = data as ReminderMarkResponse | null
  if (!payload?.success) {
    // NOT_PENDING means the row was cancelled or finalised while we held it
    // (redeem/cancel mid-run). The message may already be out; nothing to retry.
    logger.warn('Voucher reminder mark refused', {
      metadata: {
        reminderId,
        status,
        channel: options.channel ?? null,
        errorCode: payload?.error_code ?? 'unknown',
        message: payload?.message ?? null
      }
    })
  }
}

async function claimDueReminders(
  supabase: AdminClient,
  londonToday: string
): Promise<ClaimedVoucherReminder[]> {
  const { data, error } = await supabase.rpc('voucher_reminders_claim_due', {
    p_london_today: londonToday,
    p_limit: CLAIM_BATCH_SIZE
  })

  if (error) {
    throw new Error(`voucher_reminders_claim_due failed: ${error.message}`)
  }

  const payload = data as ClaimDueResponse | null
  if (!payload?.success) {
    throw new Error(payload?.message || 'voucher_reminders_claim_due returned failure')
  }

  return payload.claimed ?? []
}

// The claim RPC does not return email deliverability state, so load it for the
// batch in one query. A customer we cannot read is treated as email-ineligible
// and falls through to SMS.
async function loadEmailBlocks(
  supabase: AdminClient,
  customerIds: string[]
): Promise<Set<string>> {
  const blocked = new Set<string>()
  if (customerIds.length === 0) {
    return blocked
  }

  const { data, error } = await supabase
    .from('customers')
    .select('id, email_status, email_deactivated_at')
    .in('id', customerIds)

  if (error) {
    logger.warn('Voucher reminder email state lookup failed; falling back to SMS', {
      metadata: { customerCount: customerIds.length, error: error.message }
    })
    customerIds.forEach((id) => blocked.add(id))
    return blocked
  }

  const rows = (data ?? []) as Array<{
    id: string
    email_status: string | null
    email_deactivated_at: string | null
  }>
  const seen = new Set(rows.map((row) => row.id))

  rows.forEach((row) => {
    if (row.email_deactivated_at || BLOCKED_EMAIL_STATUSES.includes(row.email_status ?? 'unknown')) {
      blocked.add(row.id)
    }
  })
  customerIds.filter((id) => !seen.has(id)).forEach((id) => blocked.add(id))

  return blocked
}

function resolveChannel(
  row: ClaimedVoucherReminder,
  emailBlocked: Set<string>
): { channel: VoucherReminderChannel; to: string } | { channel: null; reason: string } {
  if (!row.customer_id) {
    return { channel: null, reason: 'no customer attached to the voucher' }
  }

  const email = row.email?.trim().toLowerCase() || null
  if (email && EMAIL_SHAPE.test(email) && !emailBlocked.has(row.customer_id)) {
    return { channel: 'email', to: email }
  }

  const mobile = row.mobile_e164?.trim() || null
  if (mobile && row.sms_opt_in === true) {
    return { channel: 'sms', to: mobile }
  }

  if (mobile) {
    return { channel: null, reason: 'customer has not opted in to SMS and has no usable email' }
  }
  return { channel: null, reason: 'no usable email address or mobile number on the customer record' }
}

async function sendOneReminder(
  supabase: AdminClient,
  row: ClaimedVoucherReminder,
  target: { channel: VoucherReminderChannel; to: string },
  londonToday: string,
  expiryDate: string
): Promise<VoucherReminderChannel | null> {
  const copyInput: ReminderCopyInput = {
    kind: toCopyKind(row.reminder_kind),
    firstName: row.first_name,
    prizeLabel: row.prize_label,
    wonAtLabel: row.won_at_label,
    expiryDate,
    londonToday
  }
  const metadata = {
    template_key: TEMPLATE_KEY,
    voucher_id: row.voucher_id,
    voucher_number: row.voucher_number,
    reminder_kind: row.reminder_kind
  }

  if (target.channel === 'email') {
    const copy = buildVoucherReminderEmail(copyInput)
    const result = await sendEmail({
      to: target.to,
      subject: copy.subject,
      html: copy.html,
      text: copy.text,
      commType: TEMPLATE_KEY,
      customerId: row.customer_id,
      metadata
    })

    if (result.success) {
      await markReminderOutcome(supabase, row.reminder_id, 'sent', {
        messageSid: result.messageId ?? null,
        channel: 'email'
      })
      return 'email'
    }

    await markReminderOutcome(supabase, row.reminder_id, 'failed', {
      errorText: trimStoredError(result.error, 'Email send failed'),
      channel: 'email'
    })
    return null
  }

  const result = await sendSMS(target.to, buildVoucherReminderSms(copyInput), {
    customerId: row.customer_id ?? undefined,
    metadata
  })

  if (result.success) {
    const sid = 'sid' in result && typeof result.sid === 'string' ? result.sid : null
    await markReminderOutcome(supabase, row.reminder_id, 'sent', {
      messageSid: sid,
      channel: 'sms'
    })
    return 'sms'
  }

  const sendError = 'error' in result && typeof result.error === 'string' ? result.error : null
  await markReminderOutcome(supabase, row.reminder_id, 'failed', {
    errorText: trimStoredError(sendError, 'SMS send failed'),
    channel: 'sms'
  })
  return null
}

export async function sendDueVoucherReminders(params: {
  londonToday: string
}): Promise<VoucherReminderSendResult> {
  const supabase = createAdminClient()
  const totals: VoucherReminderSendResult = {
    claimed: 0,
    sentEmail: 0,
    sentSms: 0,
    skipped: 0,
    failed: 0
  }

  while (totals.claimed < MAX_REMINDERS_PER_RUN) {
    const rows = await claimDueReminders(supabase, params.londonToday)
    if (rows.length === 0) break
    totals.claimed += rows.length

    const emailCandidateIds = Array.from(
      new Set(
        rows
          .filter((row) => row.customer_id && row.email?.trim())
          .map((row) => row.customer_id as string)
      )
    )
    const emailBlocked = await loadEmailBlocks(supabase, emailCandidateIds)

    for (const row of rows) {
      try {
        if (!row.expiry_date) {
          await markReminderOutcome(supabase, row.reminder_id, 'failed', {
            errorText: 'voucher has no expiry date'
          })
          totals.failed += 1
          continue
        }

        const target = resolveChannel(row, emailBlocked)
        if (target.channel === null) {
          await markReminderOutcome(supabase, row.reminder_id, 'skipped', {
            errorText: target.reason
          })
          totals.skipped += 1
          continue
        }

        const sentVia = await sendOneReminder(
          supabase,
          row,
          target,
          params.londonToday,
          row.expiry_date
        )

        if (sentVia === 'email') {
          totals.sentEmail += 1
        } else if (sentVia === 'sms') {
          totals.sentSms += 1
        } else {
          totals.failed += 1
        }
      } catch (rowError) {
        const messageText = rowError instanceof Error ? rowError.message : 'Unexpected reminder send error'
        logger.error('Voucher reminder send threw', {
          error: rowError instanceof Error ? rowError : new Error(messageText),
          metadata: { reminderId: row.reminder_id, voucherId: row.voucher_id }
        })
        await markReminderOutcome(supabase, row.reminder_id, 'failed', {
          errorText: trimStoredError(messageText, 'Unexpected reminder send error')
        })
        totals.failed += 1
      }
    }

    if (rows.length < CLAIM_BATCH_SIZE) break
  }

  return totals
}
