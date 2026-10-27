import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

/**
 * The deposit a table booking would owe, for the website to quote before the guest books (BK-186).
 *
 * Asked of resolve_table_booking_deposit, the same database function the booking function calls to
 * charge, so the figure quoted is the figure charged. The website used to work it out from its own
 * copy of the group rule (15 or more, GBP 10 a head) and must not do so any more.
 */
export type TableBookingDepositQuote = {
  party_size: number
  required: boolean
  amount: number
  rule: string | null
  reason: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parsePeriodId(value: string | null): string | null {
  return value && UUID.test(value) ? value : null
}

/** null when the figure cannot be worked out: the caller must not quote one then. */
export async function quoteTableBookingDeposit(
  supabase: SupabaseClient<any, 'public', any>,
  input: { date: string; partySize: number; periodId?: string | null; periodAnswer?: boolean | null }
): Promise<TableBookingDepositQuote | null> {
  const { data, error } = await supabase.rpc('resolve_table_booking_deposit', {
    p_party_size: input.partySize,
    p_booking_date: input.date,
    p_period_id: input.periodId ?? undefined,
    p_period_answer: input.periodId ? input.periodAnswer ?? false : undefined,
  })
  if (error) {
    logger.error('resolve_table_booking_deposit failed for a deposit quote', {
      error: new Error(error.message),
      metadata: { date: input.date, partySize: input.partySize },
    })
    return null
  }
  const result = (data ?? {}) as Record<string, unknown>
  const amount = Number(result.amount)
  if (result.ok !== true || !Number.isFinite(amount) || amount < 0) {
    return null
  }
  return {
    party_size: input.partySize,
    required: result.required === true,
    amount: Math.round(amount * 100) / 100,
    rule: typeof result.rule === 'string' ? result.rule : null,
    reason: typeof result.reason === 'string' ? result.reason : null,
  }
}
