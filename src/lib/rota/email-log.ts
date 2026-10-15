/**
 * Waits for a write to rota_email_log and reports it at error level when it fails.
 *
 * Every writer to the log used to `await` the insert and drop the result. From 18 August to
 * 13 October 2026 the daily unfilled shift cron wrote an email_type the table's check refused
 * (Postgres 23514): the email went out, the log row was refused, and nothing said so.
 *
 * The log is a record of an email that has already been sent (or has already failed), so a
 * failed write must never fail the action behind it. This never throws: it reports and carries
 * on, and returns false so a caller can count the failure if it wants to.
 *
 * Pass the insert itself, written out in place, so the payload stays readable at the call site:
 *
 *   await settleRotaEmailLogWrite(
 *     supabase.from('rota_email_log').insert({ email_type: 'staff_rota', ... }),
 *     { type: 'staff_rota', entityId: weekId },
 *   );
 *
 * tests/guards/rota-email-log-writes.test.ts fails on any write to the table that skips this.
 * The reporting itself is the shared settleWrite in src/lib/supabase/settle-write.ts.
 */

import { settleWrite, type SupabaseWriteError } from '@/lib/supabase/settle-write';

export interface RotaEmailLogWriteContext {
  /** The row's email_type. Named `type` so the email_type guard on writers does not read it as one. */
  type: string;
  entityId: string | null;
}

export async function settleRotaEmailLogWrite(
  write: PromiseLike<{ error: SupabaseWriteError | null }>,
  context: RotaEmailLogWriteContext,
): Promise<boolean> {
  return settleWrite(write, {
    table: 'rota_email_log',
    what: 'Log write',
    note: 'the email itself was not affected',
    ids: { emailType: context.type, entityId: context.entityId },
  });
}
