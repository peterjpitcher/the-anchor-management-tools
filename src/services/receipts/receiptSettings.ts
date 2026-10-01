/**
 * Settings for the receipts section: the lock date and which keyword matcher the rules use.
 *
 * They live in `receipt_settings`, which only the service role can read or write, and not in
 * `system_settings`, which any manager can write through its row policies.
 *
 * @requires Callers of the write functions must verify the user is a super admin.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { isValidIsoDate } from '@/lib/dateUtils'
import type { RuleMatcherMode } from '@/lib/receipts/rule-matching'
import { DEFAULT_PAYROLL_REFERENCE } from '@/lib/receipts/payroll-recognition'
import type { AdminClient } from './types'

export type ReceiptSettings = {
  /** Payments dated on or before this are left alone by every automatic or bulk writer. */
  lockDate: string | null
  matcher: RuleMatcherMode
  /** The reference the payroll run puts on every wage payment. */
  payrollReference: string
}

const LOCK_KEY = 'locked_before'
const MATCHER_KEY = 'rule_matcher'
const PAYROLL_REFERENCE_KEY = 'payroll_reference'

/**
 * Throws when the settings cannot be read. A writer that cannot find out whether a period is
 * locked must not carry on as though nothing were.
 */
export async function loadReceiptSettings(supabase: AdminClient): Promise<ReceiptSettings> {
  const { data, error } = await (supabase as any)
    .from('receipt_settings')
    .select('key, value')
    .in('key', [LOCK_KEY, MATCHER_KEY, PAYROLL_REFERENCE_KEY])

  if (error) {
    throw new Error(`Failed to load receipt settings: ${error.message}`)
  }

  const rows = (data ?? []) as Array<{ key: string; value: Record<string, unknown> | null }>
  const lock = rows.find((row) => row.key === LOCK_KEY)?.value?.date
  const matcher = rows.find((row) => row.key === MATCHER_KEY)?.value?.mode
  const payrollReference = rows.find((row) => row.key === PAYROLL_REFERENCE_KEY)?.value?.text

  return {
    lockDate: typeof lock === 'string' && isValidIsoDate(lock) ? lock : null,
    matcher: matcher === 'word' ? 'word' : 'substring',
    payrollReference:
      typeof payrollReference === 'string' && payrollReference.trim() ? payrollReference.trim() : DEFAULT_PAYROLL_REFERENCE,
  }
}

export async function queryReceiptSettings(): Promise<ReceiptSettings> {
  return loadReceiptSettings(createAdminClient())
}

export async function performSetReceiptsLockDate(
  userId: string,
  date: string | null
): Promise<{ success?: boolean; error?: string; previous?: string | null; current?: string | null }> {
  if (date !== null && !isValidIsoDate(date)) {
    return { error: 'Enter a real date, or clear the lock.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await (supabase as any).rpc('set_receipts_locked_before', {
    p_date: date,
    p_user: userId,
  })

  if (error || !data) {
    console.error('Failed to set the receipts lock date:', error)
    return { error: 'The lock date could not be saved.' }
  }

  return {
    success: true,
    previous: (data.previous as string | null) ?? null,
    current: (data.current as string | null) ?? null,
  }
}

export async function performSetRuleMatcher(
  userId: string,
  matcher: RuleMatcherMode
): Promise<{ success?: boolean; error?: string; previous?: RuleMatcherMode }> {
  if (matcher !== 'substring' && matcher !== 'word') {
    return { error: 'That matcher is not recognised.' }
  }

  const supabase = createAdminClient()
  let previous: RuleMatcherMode
  try {
    previous = (await loadReceiptSettings(supabase)).matcher
  } catch (error) {
    console.error('Failed to read the receipts rule matcher:', error)
    return { error: 'The setting could not be read.' }
  }

  const { error } = await (supabase as any)
    .from('receipt_settings')
    .upsert(
      { key: MATCHER_KEY, value: { mode: matcher }, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )

  if (error) {
    console.error('Failed to set the receipts rule matcher:', error)
    return { error: 'The setting could not be saved.' }
  }

  return { success: true, previous }
}
