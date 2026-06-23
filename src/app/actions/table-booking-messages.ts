'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'

// Operational ("transactional") messaging for table-booking guests.
//
// This deliberately does NOT use the bulk-SMS path (`sendBulkMessages`), which
// requires marketing consent (`marketing_sms_opt_in`). A note about a guest's
// existing booking today is transactional, so eligibility is the operational
// gate only: a mobile number, `sms_opt_in = true`, and an active `sms_status`.
// Each send goes through `sendSMS`, which independently enforces that same gate
// plus idempotency, safety guards and message logging.

const TEMPLATE_KEY = 'table_booking_manual_message'
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
  } | null
}

type EligibleGuest = {
  customerId: string
  firstName: string | null
  lastName: string | null
  mobile: string
  bookingId: string
}

export type PreviewResult = {
  availableTimes: Array<{ time: string; count: number }>
  total: number
  eligible: number
  unreachable: number
  noName: number
}

export type SendResult = {
  success?: boolean
  error?: string
  sent?: number
  scheduled?: number
  skipped?: number
  failed?: number
  paused?: boolean
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
      'id, booking_time, status, customer:customers!table_bookings_customer_id_fkey(id, first_name, last_name, mobile_e164, sms_opt_in, sms_status)'
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

    return {
      data: {
        availableTimes,
        total: uniqueCustomers.size,
        eligible: eligibleGuests.length,
        unreachable: uniqueCustomers.size - eligibleGuests.length,
        noName: eligibleGuests.filter((g) => !hasRealName(g.firstName)).length,
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

  let recipients: EligibleGuest[]
  try {
    const rows = filterByTime(await fetchDay({ date, statuses }), time)
    recipients = dedupeEligible(rows)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load guests' }
  }

  if (recipients.length === 0) {
    return { error: 'No eligible guests to message (none have a mobile number and SMS opt-in).' }
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
  // Set when we must stop the batch: 'logging' (fatal — logging broke, so safety
  // guards are blind) or a systemic SMS code (rate limit / suspended).
  let abortReason: 'logging' | string | null = null

  for (let i = 0; i < recipients.length && !abortReason; i += SEND_CONCURRENCY) {
    const window = recipients.slice(i, i + SEND_CONCURRENCY)
    const outcomes = await Promise.all(
      window.map(async (r) => {
        try {
          const body = personalise(message, r.firstName, r.lastName)
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
      if (o.kind === 'sent') sent += 1
      else if (o.kind === 'scheduled') scheduled += 1
      else if (o.kind === 'skipped') skipped += 1
      else failed += 1
      if (!abortReason && 'fatal' in o && o.fatal) abortReason = o.fatal
      if (!abortReason && 'stop' in o && o.stop) abortReason = o.stop
    }
  }

  const notAttempted = recipients.length - sent - scheduled - skipped - failed

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'table_booking.bulk_sms_sent',
    resource_type: 'table_booking',
    operation_status: failed > 0 && sent === 0 && scheduled === 0 ? 'failure' : 'success',
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

  // A systemic rate-limit/suspension stopped the batch early; the rest were not sent.
  if (abortReason) {
    return { success: true, paused: true, sent, scheduled, skipped, failed }
  }

  return { success: true, sent, scheduled, skipped, failed }
}
