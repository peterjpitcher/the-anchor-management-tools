import type { createAdminClient } from '@/lib/supabase/admin';
import { formatDateInLondon } from '@/lib/dateUtils';
import { reportWriteError, settleWrite } from '@/lib/supabase/settle-write';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Deletes every frozen payroll month-approval whose pay period covers `workDate`, so the next
 * payroll read recomputes from the changed shift or clock session instead of showing stale
 * approved figures.
 *
 * Shared by the three paths that change pay from outside the payroll screen: a shift premium
 * edit (rota.ts), a clock event or manager session edit (timeclock.ts) and the overnight
 * auto-close (api/cron/rota-auto-close).
 *
 * Returns true when every covering approval was cleared, or none existed. Returns false when the
 * pay period lookup failed (nobody knows which approvals cover the date, so none were cleared) or
 * any delete was refused. Both are already logged at error level; the caller decides how the
 * person or the owner hears about it.
 */
export async function clearPayrollApprovalsForDate(
  client: AdminClient,
  workDate: string,
  ids?: Record<string, string | number | boolean | null | undefined>,
): Promise<boolean> {
  const { data: periods, error } = await client
    .from('payroll_periods')
    .select('year, month')
    .lte('period_start', workDate)
    .gte('period_end', workDate);

  if (error) {
    reportWriteError(error, {
      table: 'payroll_periods',
      what: 'Finding the pay periods whose approval must be cleared',
      ids: { workDate, ...ids },
      note: 'no payroll approval was cleared',
    });
    return false;
  }

  if (!periods?.length) return true;

  const results = await Promise.all(
    periods.map(period =>
      settleWrite(
        client
          .from('payroll_month_approvals')
          .delete()
          .eq('year', period.year)
          .eq('month', period.month),
        {
          table: 'payroll_month_approvals',
          what: 'Clearing the payroll approval',
          ids: { year: period.year, month: period.month, ...ids },
        },
      ),
    ),
  );

  return results.every(Boolean);
}

/**
 * The warning for a manager change that saved while the payroll approval covering its date could
 * not be cleared. It says the change stands, so nobody repeats it believing it was lost.
 */
export function payrollApprovalNotClearedWarning(saved: string, workDate: string): string {
  const dateLabel = formatDateInLondon(`${workDate}T12:00:00Z`, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${saved}, but the payroll approval covering ${dateLabel} could not be cleared, so the approved payroll figures are now out of date. Please re-approve payroll for that month, or tell the developer if this keeps happening.`;
}
