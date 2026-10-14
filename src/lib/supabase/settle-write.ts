/**
 * Waits for a Supabase write and reports it at error level when it fails.
 *
 * supabase-js never throws on a refused write: it returns `{ error }`. Code that awaited an
 * insert, upsert, update or delete and dropped the result lost every refusal (a check
 * constraint, a missing column, RLS, a foreign key) without a trace. rota_email_log went eight
 * weeks like that in 2026. A try/catch around the write does not help, and `logger.warn` prints
 * nothing in production, so the report goes to console.error, field by field.
 *
 * This never throws. It returns false when the write failed, so a caller whose user would
 * otherwise be told "saved" can turn that into an error or a warning:
 *
 *   const cleared = await settleWrite(
 *     supabase.from('payroll_month_approvals').delete().eq('year', year).eq('month', month),
 *     { table: 'payroll_month_approvals', what: 'Clearing the payroll approval', ids: { year, month } },
 *   );
 *   if (!cleared) return { error: '...' };
 *
 * tests/guards/discarded-write-errors.test.ts fails on any write whose result is thrown away.
 */

export interface SupabaseWriteError {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface SettleWriteContext {
  /** The table written to. Prefixes the report so a log search by table finds it. */
  table: string;
  /** What the write was doing, read as "<what> failed". */
  what: string;
  /** Ids that locate the row. Never names, phone numbers, emails or other personal data. */
  ids?: Record<string, string | number | boolean | null | undefined>;
  /** Appended to the report, for example what the failure did not affect. */
  note?: string;
}

/**
 * Reports a write error already in hand, for a write whose returned rows are still needed:
 *
 *   const { data, error } = await supabase.from('signing_documents').update(...).select('id');
 *   if (error) reportWriteError(error, { table: 'signing_documents', what: 'Voiding older versions' });
 */
export function reportWriteError(error: SupabaseWriteError, context: SettleWriteContext): void {
  const suffix = context.note ? `; ${context.note}` : '';
  // Field by field: a PostgrestError serialises to {} when passed whole to some loggers.
  console.error(`[${context.table}] ${context.what} failed${suffix}`, {
    ...context.ids,
    code: error.code ?? null,
    message: error.message,
    details: error.details ?? null,
    hint: error.hint ?? null,
  });
}

export async function settleWrite(
  write: PromiseLike<{ error: SupabaseWriteError | null }>,
  context: SettleWriteContext,
): Promise<boolean> {
  try {
    const { error } = await write;
    if (!error) return true;
    reportWriteError(error, context);
    return false;
  } catch (thrown) {
    const suffix = context.note ? `; ${context.note}` : '';
    console.error(`[${context.table}] ${context.what} threw${suffix}`, {
      ...context.ids,
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
    return false;
  }
}
