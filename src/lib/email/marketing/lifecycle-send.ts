import type { SupabaseClient } from '@supabase/supabase-js'

import { loadDayHours } from '@/lib/business-hours/day-hours'
import { getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'

import type { RecipientMergeFields } from './merge'

/**
 * The send-time half of a return-visit campaign, used by the marketing cron
 * (spec tasks/spec-2026-11-02-table-booking-return-visits.md, sections 9.2 and 9.3).
 *
 * Kept out of the route file because a Next.js route may only export its handlers, and so the
 * tests can drive each decision without a provider.
 */

// `any` because the admin client and the test fakes share no exported type (as day-hours.ts).
type Db = SupabaseClient<any, 'public', any>

/** Days looked ahead for the closure gate: a voucher is valid for 30 days by default. */
export const CLOSURE_GATE_WINDOW_DAYS = 30
/**
 * More closed days than this in the window shuts the gate. The kitchen closes every Monday,
 * which is four or five days in thirty, so ordinary weeks pass and a holiday closure does not.
 */
export const CLOSURE_GATE_MAX_CLOSED_DAYS = 7

export interface LifecycleGate {
  open: boolean
  /** Days in the window with the kitchen closed or the hours unknown. */
  closedDays: number
  /** Set when the hours could not be read; the gate is then shut. */
  error?: string
}

/**
 * Whether return-visit emails may go out today. A voucher for food is no use if the kitchen is
 * shut for much of its life, so a long closure holds the campaign rather than wasting the
 * guest's voucher. Unknown hours count as closed, and a failed lookup shuts the gate: the cost
 * of a held day is one day's emails, the cost of a wrong send is a voucher that cannot be used.
 */
export async function evaluateLifecycleGate(db: Db, today: string = getTodayIsoDate()): Promise<LifecycleGate> {
  const end = shiftIsoDate(today, CLOSURE_GATE_WINDOW_DAYS - 1)
  if (!end) return { open: false, closedDays: CLOSURE_GATE_WINDOW_DAYS, error: `Bad date ${today}` }

  try {
    const hours = await loadDayHours(today, end, db)
    let closedDays = 0
    for (const day of hours.values()) {
      if (!day.known || day.kitchenClosed) closedDays++
    }
    // A date missing from the map is as unknown as one with no rows.
    closedDays += Math.max(0, CLOSURE_GATE_WINDOW_DAYS - hours.size)
    return { open: closedDays <= CLOSURE_GATE_MAX_CLOSED_DAYS, closedDays }
  } catch (error) {
    return {
      open: false,
      closedDays: CLOSURE_GATE_WINDOW_DAYS,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export type LifecyclePreparation =
  | { kind: 'send'; fields: RecipientMergeFields; voucherNumber: string }
  | { kind: 'skipped' }
  | { kind: 'release'; failureClass: 'retryable' | 'terminal'; error: string }

/**
 * Marks a claimed return-visit row skipped because the venue is closed. The row was claimed,
 * so it is guarded on 'sending'; the guest's cap reservation is cleared because nothing went
 * out. A skipped row does not block re-entry, so the guest comes back on a later send day.
 */
async function skipForClosure(db: Db, recipientId: string, customerId: string | null): Promise<boolean> {
  const { data, error } = await db
    .from('marketing_campaign_recipients')
    .update({
      status: 'skipped',
      skip_reason: 'venue_closed',
      claimed_at: null,
      lease_expires_at: null,
    })
    .eq('id', recipientId)
    .eq('status', 'sending')
    .select('id')
    .maybeSingle()

  if (error || !data) return false

  if (customerId) {
    const { error: reserveError } = await db
      .from('customers')
      .update({ marketing_reserved_until: null })
      .eq('id', customerId)
    if (reserveError) {
      // The reservation lapses with the lease, so this only delays the guest's next email.
      logger.error('Could not clear a marketing reservation after a closure skip', {
        error: new Error(reserveError.message),
        metadata: { recipientId },
      })
    }
  }
  return true
}

/**
 * Readies one claimed return-visit row: issues its voucher (or finds the one a previous
 * attempt issued) and returns the values to merge. Called only after the email kill switches
 * have been checked, so a suspended send never issues a voucher.
 */
export async function prepareLifecycleRecipient(
  db: Db,
  row: { id: string; customer_id: string | null; merge_fields?: unknown },
  gate: LifecycleGate,
  today: string = getTodayIsoDate(),
): Promise<LifecyclePreparation> {
  if (!gate.open) {
    if (await skipForClosure(db, row.id, row.customer_id)) return { kind: 'skipped' }
    return { kind: 'release', failureClass: 'retryable', error: 'Venue closure gate shut and the skip did not save' }
  }

  const { data, error } = await db.rpc('issue_lifecycle_voucher', {
    p_recipient_id: row.id,
    p_london_today: today,
  })
  if (error) {
    return { kind: 'release', failureClass: 'retryable', error: `Voucher issue failed: ${error.message}` }
  }

  const result = (data ?? {}) as {
    success?: boolean
    error_code?: string
    message?: string
    voucher_number?: string
    voucher_status?: string
    merge_fields?: RecipientMergeFields | null
  }

  if (!result.success) {
    // Every refusal is about the row or the campaign's set-up, and none clears on a retry.
    return {
      kind: 'release',
      failureClass: 'terminal',
      error: `Voucher not issued: ${result.error_code ?? 'unknown'}${result.message ? ` (${result.message})` : ''}`,
    }
  }
  if (result.voucher_status !== 'issued' || !result.voucher_number) {
    // A replay found a voucher that has since been cancelled or used. Sending it would put a
    // dead voucher in front of the guest.
    return {
      kind: 'release',
      failureClass: 'terminal',
      error: `Voucher ${result.voucher_number ?? '(none)'} is ${result.voucher_status ?? 'missing'}, not issued`,
    }
  }

  return { kind: 'send', fields: result.merge_fields ?? {}, voucherNumber: result.voucher_number }
}

/**
 * After a return-visit row is released, cancels its voucher if the row has ended up failed.
 * A retryable release keeps the voucher, because the retry sends that same voucher; only a
 * guest who will never get the email loses it, so the ledger does not show a live voucher
 * nobody holds.
 */
export async function cancelVoucherIfRecipientFailed(db: Db, recipientId: string): Promise<void> {
  // Two reads rather than an embed: vouchers and recipients point at each other, and an
  // embed across a double foreign key is ambiguous to PostgREST.
  const { data: recipient, error } = await db
    .from('marketing_campaign_recipients')
    .select('status, voucher_id')
    .eq('id', recipientId)
    .maybeSingle()

  if (error) {
    logger.error('Could not check a failed return-visit row for its voucher', {
      error: new Error(error.message),
      metadata: { recipientId },
    })
    return
  }

  const row = recipient as { status: string; voucher_id: string | null } | null
  if (!row || row.status !== 'failed' || !row.voucher_id) return

  const { data: voucherData, error: voucherError } = await db
    .from('vouchers')
    .select('voucher_number, status')
    .eq('id', row.voucher_id)
    .maybeSingle()
  const voucher = voucherData as { voucher_number: string; status: string } | null
  if (voucherError || !voucher) {
    logger.error('Could not read the voucher of a failed return-visit row', {
      error: new Error(voucherError?.message ?? 'voucher missing'),
      metadata: { recipientId },
    })
    return
  }
  if (voucher.status !== 'issued' && voucher.status !== 'generated') return

  const { data: cancelled, error: cancelError } = await db.rpc('voucher_cancel', {
    p_voucher_number: voucher.voucher_number,
    p_reason: 'email_failed',
    p_user_id: null,
    p_employee_id: null,
    p_actor_name: 'Return visit email',
    p_source: 'system',
    p_idempotency_key: `return-visit-email-failed:${recipientId}`,
  })

  const outcome = cancelled as { success?: boolean; error_code?: string } | null
  if (cancelError || !outcome?.success) {
    logger.error('Could not cancel the voucher of a return-visit email that failed', {
      error: new Error(cancelError?.message ?? outcome?.error_code ?? 'unknown'),
      metadata: { recipientId, voucherNumber: voucher.voucher_number },
    })
  }
}
