// Voucher SMS reminder sender (spec 5.2, F17/F18/F19/F51).
// The DB owns the outbox: voucher_reminders_claim_due atomically claims due
// pending rows (one per customer per London day, attempts bumped, others
// deferred) and this module sends each one through the canonical sendSMS path,
// then records the outcome via voucher_reminder_mark. The claim + mark pair is
// the idempotency guard; nothing here writes reminder rows directly except the
// consent/mobile skip, which the mark RPC deliberately does not accept.

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { normaliseToGsm7 } from '@/lib/sms/gsm7'
import { formatDateInLondon } from '@/lib/dateUtils'
import type { ReminderKind } from '@/types/vouchers'

const CLAIM_BATCH_SIZE = 50
// Hard safety cap per run: 10 claim batches. Anything beyond this waits for
// the next day's pass rather than risking an unbounded send loop.
const MAX_REMINDERS_PER_RUN = 500
const MAX_STORED_ERROR_LENGTH = 500

type AdminClient = ReturnType<typeof createAdminClient>

interface ClaimedVoucherReminder {
  reminder_id: string
  voucher_id: string
  reminder_kind: ReminderKind
  scheduled_for: string
  attempts: number
  voucher_number: string
  type_id: string
  display_title: string | null
  prize: string | null
  won_at_label: string | null
  expiry_date: string | null
  customer_id: string | null
  customer_first_name: string | null
  customer_mobile: string | null
  sms_opt_in: boolean | null
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
  sent: number
  skipped: number
  failed: number
}

// Copy per spec 5.2. GSM-7 safe: straight apostrophes only, then normalised as
// a belt-and-braces guard so a future copy edit cannot silently double the
// per-segment cost.
export function buildVoucherReminderMessage(params: {
  firstName: string | null
  prize: string | null
  displayTitle: string | null
  wonAtLabel: string | null
  expiryDate: string
  londonToday: string
}): string {
  const firstName = getSmartFirstName(params.firstName) || 'there'
  const prize = params.prize?.trim() || params.displayTitle?.trim().toLowerCase() || 'prize'
  const sameYear = params.expiryDate.slice(0, 4) === params.londonToday.slice(0, 4)
  const expiry = formatDateInLondon(
    params.expiryDate,
    sameYear
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' }
  )
  const wonAt = params.wonAtLabel?.trim()
  const origin = wonAt ? ` from ${wonAt}` : ''
  return normaliseToGsm7(
    `Hi ${firstName}, your ${prize} voucher${origin} is waiting for you at The Anchor. Just show the card before ${expiry}. See you soon!`
  )
}

function trimStoredError(text: string | null | undefined): string {
  return (text?.trim() || 'SMS send failed').slice(0, MAX_STORED_ERROR_LENGTH)
}

async function markReminderOutcome(
  supabase: AdminClient,
  reminderId: string,
  status: 'sent' | 'failed',
  messageSid: string | null,
  errorText: string | null
): Promise<void> {
  const { data, error } = await supabase.rpc('voucher_reminder_mark', {
    p_id: reminderId,
    p_status: status,
    p_message_sid: messageSid,
    p_error: errorText
  })

  if (error) {
    logger.error('Voucher reminder mark failed', {
      error: new Error(error.message),
      metadata: { reminderId, status }
    })
    return
  }

  const payload = data as ReminderMarkResponse | null
  if (!payload?.success) {
    // NOT_PENDING means the row was cancelled or finalised while we held it
    // (redeem/cancel mid-run). The SMS may already be out; nothing to retry.
    logger.warn('Voucher reminder mark refused', {
      metadata: {
        reminderId,
        status,
        errorCode: payload?.error_code ?? 'unknown',
        message: payload?.message ?? null
      }
    })
  }
}

// Consent and missing-mobile skips are terminal but are not failures, and
// voucher_reminder_mark only accepts 'sent' or 'failed', so the skip is a
// direct status write with the same pending-only guard the RPC applies.
async function markReminderSkipped(
  supabase: AdminClient,
  reminderId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from('voucher_reminders')
    .update({
      status: 'skipped',
      last_error: reason,
      updated_at: new Date().toISOString()
    })
    .eq('id', reminderId)
    .eq('status', 'pending')

  if (error) {
    logger.error('Voucher reminder skip update failed', {
      error: new Error(error.message),
      metadata: { reminderId, reason }
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

export async function sendDueVoucherReminders(params: {
  londonToday: string
}): Promise<VoucherReminderSendResult> {
  const supabase = createAdminClient()
  const totals: VoucherReminderSendResult = { claimed: 0, sent: 0, skipped: 0, failed: 0 }

  while (totals.claimed < MAX_REMINDERS_PER_RUN) {
    const rows = await claimDueReminders(supabase, params.londonToday)
    if (rows.length === 0) break
    totals.claimed += rows.length

    for (const row of rows) {
      try {
        if (!row.customer_id || !row.customer_mobile?.trim()) {
          await markReminderSkipped(supabase, row.reminder_id, 'no mobile number on customer record')
          totals.skipped += 1
          continue
        }

        if (row.sms_opt_in === false) {
          await markReminderSkipped(supabase, row.reminder_id, 'customer has not opted in to SMS')
          totals.skipped += 1
          continue
        }

        if (!row.expiry_date) {
          await markReminderOutcome(supabase, row.reminder_id, 'failed', null, 'voucher has no expiry date')
          totals.failed += 1
          continue
        }

        const message = buildVoucherReminderMessage({
          firstName: row.customer_first_name,
          prize: row.prize,
          displayTitle: row.display_title,
          wonAtLabel: row.won_at_label,
          expiryDate: row.expiry_date,
          londonToday: params.londonToday
        })

        const result = await sendSMS(row.customer_mobile, message, {
          customerId: row.customer_id,
          metadata: {
            template_key: 'voucher_reminder',
            voucher_id: row.voucher_id,
            voucher_number: row.voucher_number,
            reminder_kind: row.reminder_kind
          }
        })

        if (result.success) {
          const sid = 'sid' in result && typeof result.sid === 'string' ? result.sid : null
          await markReminderOutcome(supabase, row.reminder_id, 'sent', sid, null)
          totals.sent += 1
        } else {
          const sendError = 'error' in result && typeof result.error === 'string' ? result.error : null
          await markReminderOutcome(supabase, row.reminder_id, 'failed', null, trimStoredError(sendError))
          totals.failed += 1
        }
      } catch (rowError) {
        const messageText = rowError instanceof Error ? rowError.message : 'Unexpected reminder send error'
        logger.error('Voucher reminder send threw', {
          error: rowError instanceof Error ? rowError : new Error(messageText),
          metadata: { reminderId: row.reminder_id, voucherId: row.voucher_id }
        })
        await markReminderOutcome(supabase, row.reminder_id, 'failed', null, trimStoredError(messageText))
        totals.failed += 1
      }
    }

    if (rows.length < CLAIM_BATCH_SIZE) break
  }

  return totals
}
