'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'
import { isEmailUsable } from '@/lib/notifications/channel'
import { sendStaffOneOffEmail } from '@/lib/email/staff-one-off-email'
import {
  STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT,
  findSuppressedEmails,
  isStaffEmailOptionOn,
} from '@/lib/messaging/staff-email-option'

// Operational ("transactional") messaging for table-booking guests.
//
// This deliberately does NOT use the bulk-SMS path (`sendBulkMessages`), which
// requires marketing consent (`marketing_sms_opt_in`). A note about a guest's
// existing booking today is transactional, so eligibility is the operational
// gate only: a mobile number, `sms_opt_in = true`, and an active `sms_status`.
// Each send goes through `sendSMS`, which independently enforces that same gate
// plus idempotency, safety guards and message logging.

const TEMPLATE_KEY = 'table_booking_manual_message'
// email_messages.comm_type for the same message sent by email (P7).
const EMAIL_COMM_TYPE = 'table_booking_manual_message_email'
// Allowed booking statuses to message. Defaults to confirmed only.
const BOOKING_STATUSES = [
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'review_clicked',
  'visited_waiting_for_review',
] as const
const DEFAULT_STATUSES = ['confirmed'] as const
// Cap a single synchronous batch. Note: the global SMS safety guard (default
// 120/hour) is shared with ALL other outbound SMS (confirmations, reminders,
// etc.), so a large batch fired into an already-busy hour may be paused part-way
// — handled below by stopping early and reporting it, rather than failing blindly.
const MAX_RECIPIENTS = 100
const SEND_CONCURRENCY = 5
// sendSMS codes that mean "stop the whole batch", not just this recipient.
const SYSTEMIC_STOP_CODES = new Set(['global_rate_limit', 'sms_suspended'])

const previewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM').optional(),
  statuses: z.array(z.enum(BOOKING_STATUSES)).min(1).optional(),
})

const sendSchema = previewSchema.extend({
  message: z.string().trim().min(1, 'Message is required').max(1000, 'Message is too long'),
  // P7 (flag staff_message_email_option): 'email_first' emails guests with a usable address and
  // texts the rest. Ignored while the flag is off, so the send is exactly today's.
  channel: z.enum(['sms', 'email_first']).optional(),
  subject: z.string().trim().max(200, 'Subject is too long').optional(),
})

type GuestRow = {
  id: string
  booking_time: string
  status: string
  customer: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_e164: string | null
    sms_opt_in: boolean | null
    sms_status: string | null
    email?: string | null
    email_status?: string | null
    email_deactivated_at?: string | null
  } | null
}

type EligibleGuest = {
  customerId: string
  firstName: string | null
  lastName: string | null
  mobile: string
  bookingId: string
}

/** A guest reachable by email, text or both (the email-first send). */
type ReachableGuest = {
  customerId: string
  firstName: string | null
  lastName: string | null
  bookingId: string
  mobile: string | null
  email: string | null
}

export type PreviewResult = {
  availableTimes: Array<{ time: string; count: number }>
  total: number
  eligible: number
  unreachable: number
  noName: number
  /** Present while the email option is switched on (P7). */
  emailOption?: {
    /** Guests who would get an email. */
    emailable: number
    /** Guests with no usable address who would get a text. */
    textOnly: number
    /** Guests reachable either way, which is who an email-first send goes to. */
    reachable: number
    /** Of those, guests with no name on file. */
    noName: number
  }
}

export type SendResult = {
  success?: boolean
  error?: string
  sent?: number
  scheduled?: number
  skipped?: number
  failed?: number
  paused?: boolean
  /** Set on an email-first send: how many guests were emailed. */
  emailed?: number
  channel?: 'sms' | 'email_first'
}

function isSmsEligible(c: GuestRow['customer']): boolean {
  if (!c) return false
  if (!c.mobile_e164 || c.mobile_e164.trim().length === 0) return false
  if (c.sms_opt_in !== true) return false
  const status = c.sms_status ?? null
  if (status !== null && status !== 'active') return false
  return true
}

function hasRealName(firstName: string | null): boolean {
  // getSmartFirstName returns 'there' for empty/placeholder names.
  return getSmartFirstName(firstName) !== 'there'
}

function personalise(template: string, firstName: string | null, lastName: string | null): string {
  const smartFirst = getSmartFirstName(firstName)
  return template
    .replace(/\{\{\s*first_name\s*\}\}/gi, smartFirst)
    .replace(/\{\{\s*last_name\s*\}\}/gi, (lastName ?? '').trim())
}

/** All bookings for the date + statuses. Time narrowing is applied in JS so it
 *  is robust to any seconds component on the stored TIME value. */
async function fetchDay(params: { date: string; statuses: string[] }): Promise<GuestRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('table_bookings')
    .select(
      'id, booking_time, status, customer:customers!table_bookings_customer_id_fkey(id, first_name, last_name, mobile_e164, sms_opt_in, sms_status, email, email_status, email_deactivated_at)'
    )
    .eq('booking_date', params.date)
    .in('status', params.statuses)
  if (error) throw error
  return (data ?? []) as unknown as GuestRow[]
}

function filterByTime(rows: GuestRow[], time?: string): GuestRow[] {
  if (!time) return rows
  return rows.filter((r) => (r.booking_time ?? '').slice(0, 5) === time)
}

/**
 * Dedupe scope rows to unique eligible customers (a guest may hold several
 * bookings on the same day).
 */
function dedupeEligible(rows: GuestRow[]): EligibleGuest[] {
  const byCustomer = new Map<string, EligibleGuest>()
  for (const row of rows) {
    const c = row.customer
    if (!c || !isSmsEligible(c)) continue
    if (byCustomer.has(c.id)) continue
    byCustomer.set(c.id, {
      customerId: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      mobile: c.mobile_e164 as string,
      bookingId: row.id,
    })
  }
  return [...byCustomer.values()]
}

function emailsOf(rows: GuestRow[]): string[] {
  return rows.map((row) => row.customer?.email?.trim() ?? '').filter(Boolean)
}

/**
 * The email-first scope (P7): every guest reachable by a usable email address or by text, deduped
 * by customer. A guest with a usable address is emailed; the rest are texted as before. If the
 * suppression list cannot be read, nobody is emailed and the send is text only.
 */
function dedupeReachable(rows: GuestRow[], suppressed: Set<string> | null): ReachableGuest[] {
  const byCustomer = new Map<string, ReachableGuest>()
  for (const row of rows) {
    const c = row.customer
    if (!c || byCustomer.has(c.id)) continue
    const email =
      suppressed !== null && isEmailUsable(c) && c.email && !suppressed.has(c.email.trim().toLowerCase())
        ? c.email.trim()
        : null
    const mobile = isSmsEligible(c) ? (c.mobile_e164 as string) : null
    if (!email && !mobile) continue
    byCustomer.set(c.id, {
      customerId: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      bookingId: row.id,
      mobile,
      email,
    })
  }
  return [...byCustomer.values()]
}

async function requirePermission(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }
  const allowed = await checkUserPermission('messages', 'send_transactional', user.id)
  if (!allowed) return { error: 'Insufficient permissions' }
  return { userId: user.id }
}

/**
 * Returns reachability counts for the guests in scope so the compose UI can show
 * who will (and won't) receive the message before sending.
 */
export async function previewTableBookingGuests(
  input: z.infer<typeof previewSchema>
): Promise<{ data?: PreviewResult; error?: string }> {
  const parsed = previewSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const auth = await requirePermission()
  if ('error' in auth) return { error: auth.error }

  const statuses = parsed.data.statuses ?? [...DEFAULT_STATUSES]

  try {
    const dayRows = await fetchDay({ date: parsed.data.date, statuses })

    // Distinct times across the whole date for the dropdown.
    const timeCounts = new Map<string, number>()
    for (const r of dayRows) {
      const t = (r.booking_time ?? '').slice(0, 5)
      if (t) timeCounts.set(t, (timeCounts.get(t) ?? 0) + 1)
    }
    const availableTimes = [...timeCounts.entries()]
      .map(([time, count]) => ({ time, count }))
      .sort((a, b) => a.time.localeCompare(b.time))

    const scopeRows = filterByTime(dayRows, parsed.data.time)
    const eligibleGuests = dedupeEligible(scopeRows)
    const uniqueCustomers = new Set(scopeRows.map((r) => r.customer?.id).filter(Boolean) as string[])

    let emailOption: PreviewResult['emailOption']
    if (await isStaffEmailOptionOn()) {
      const reachable = dedupeReachable(scopeRows, await findSuppressedEmails(emailsOf(scopeRows)))
      const emailable = reachable.filter((guest) => guest.email).length
      emailOption = {
        emailable,
        textOnly: reachable.length - emailable,
        reachable: reachable.length,
        noName: reachable.filter((guest) => !hasRealName(guest.firstName)).length,
      }
    }

    return {
      data: {
        availableTimes,
        total: uniqueCustomers.size,
        eligible: eligibleGuests.length,
        unreachable: uniqueCustomers.size - eligibleGuests.length,
        noName: eligibleGuests.filter((g) => !hasRealName(g.firstName)).length,
        ...(emailOption ? { emailOption } : {}),
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load guests' }
  }
}

/**
 * Sends a personalised operational SMS to every eligible guest in scope.
 * Use {{first_name}} / {{last_name}} in the message for personalisation.
 */
export async function messageTableBookingGuests(
  input: z.infer<typeof sendSchema>
): Promise<SendResult> {
  const parsed = sendSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const auth = await requirePermission()
  if ('error' in auth) return { error: auth.error }

  const statuses = parsed.data.statuses ?? [...DEFAULT_STATUSES]
  const { date, time, message } = parsed.data
  // Email first only when staff chose it and the option is switched on; otherwise exactly today.
  const emailFirst = parsed.data.channel === 'email_first' && (await isStaffEmailOptionOn())
  const subject = parsed.data.subject?.trim() || STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT

  let recipients: ReachableGuest[]
  try {
    const rows = filterByTime(await fetchDay({ date, statuses }), time)
    recipients = emailFirst
      ? dedupeReachable(rows, await findSuppressedEmails(emailsOf(rows)))
      : dedupeEligible(rows).map((guest) => ({ ...guest, email: null }))
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load guests' }
  }

  if (recipients.length === 0) {
    return {
      error: emailFirst
        ? 'No guests to message (none have a usable email address or a mobile number with SMS opt-in).'
        : 'No eligible guests to message (none have a mobile number and SMS opt-in).',
    }
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return {
      error: `Too many guests in scope (${recipients.length}). Narrow by time slot to send (max ${MAX_RECIPIENTS} at once).`,
    }
  }

  let sent = 0
  let scheduled = 0
  let skipped = 0
  let failed = 0
  let emailed = 0
  // Set when we must stop the batch: 'logging' (fatal — logging broke, so safety
  // guards are blind) or a systemic SMS code (rate limit / suspended).
  let abortReason: 'logging' | string | null = null

  for (let i = 0; i < recipients.length && !abortReason; i += SEND_CONCURRENCY) {
    const window = recipients.slice(i, i + SEND_CONCURRENCY)
    const outcomes = await Promise.all(
      window.map(async (r) => {
        try {
          const body = personalise(message, r.firstName, r.lastName)
          if (r.email) {
            const emailResult = await sendStaffOneOffEmail({
              to: r.email,
              subject,
              body,
              customerId: r.customerId,
              commType: EMAIL_COMM_TYPE,
              tableBookingId: r.bookingId,
              withBookingSignature: true,
              metadata: { source: 'boh_message_guests', booking_date: date },
            })
            if (emailResult.success) return { kind: 'emailed' as const }
            // The email failed: the guest still gets the message, by text if they can be texted.
            if (!r.mobile) return { kind: 'failed' as const }
          }
          if (!r.mobile) return { kind: 'failed' as const }
          const res = await sendSMS(r.mobile, body, {
            customerId: r.customerId,
            metadata: {
              template_key: TEMPLATE_KEY,
              trigger_type: 'table_booking_manual_message',
              table_booking_id: r.bookingId,
            },
          })
          const { code, logFailure } = extractSmsSafetyInfo(res)
          // Logging failed after the SMS may have been sent: the safety guards
          // depend on the messages table, so this is fatal for the batch.
          if (logFailure) return { kind: 'failed' as const, fatal: 'logging' as const }
          if (res.success) {
            if (res.suppressed) return { kind: 'skipped' as const }
            if (res.deferred || res.status === 'scheduled') return { kind: 'scheduled' as const }
            return { kind: 'sent' as const }
          }
          if (code && SYSTEMIC_STOP_CODES.has(code)) return { kind: 'failed' as const, stop: code }
          return { kind: 'failed' as const }
        } catch {
          return { kind: 'failed' as const }
        }
      })
    )
    for (const o of outcomes) {
      if (o.kind === 'emailed') emailed += 1
      else if (o.kind === 'sent') sent += 1
      else if (o.kind === 'scheduled') scheduled += 1
      else if (o.kind === 'skipped') skipped += 1
      else failed += 1
      if (!abortReason && 'fatal' in o && o.fatal) abortReason = o.fatal
      if (!abortReason && 'stop' in o && o.stop) abortReason = o.stop
    }
  }

  const notAttempted = recipients.length - emailed - sent - scheduled - skipped - failed

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'table_booking.bulk_sms_sent',
    resource_type: 'table_booking',
    operation_status: failed > 0 && sent === 0 && scheduled === 0 && emailed === 0 ? 'failure' : 'success',
    additional_info: {
      booking_date: date,
      booking_time: time ?? null,
      statuses,
      recipient_count: recipients.length,
      sent,
      scheduled,
      skipped,
      failed,
      not_attempted: notAttempted,
      abort_reason: abortReason,
      message_length: message.length,
      ...(emailFirst ? { channel: 'email_first', emailed, subject_length: subject.length } : {}),
    },
  })

  if (abortReason === 'logging') {
    return {
      success: false,
      error:
        'Sending stopped: message logging failed after some texts were sent. Do not retry blindly — contact support.',
      sent,
      scheduled,
      skipped,
      failed,
    }
  }

  const emailCounts = emailFirst ? { emailed, channel: 'email_first' as const } : {}

  // A systemic rate-limit/suspension stopped the batch early; the rest were not sent.
  if (abortReason) {
    return { success: true, paused: true, sent, scheduled, skipped, failed, ...emailCounts }
  }

  return { success: true, sent, scheduled, skipped, failed, ...emailCounts }
}
