import { NextRequest, NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { reportCronFailure } from '@/lib/cron/alerting';
import { getAppUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { displayName } from '@/lib/employees/display-name';
import { finalizeEmployeeSeparation } from '@/lib/employees/separation';

// Its own time limit rather than the 15-second project default (BK-212).
export const maxDuration = 60;

const TIMEZONE = 'Europe/London';

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 });
  }

  const today = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const supabase = createAdminClient();

  const { data: employees, error: fetchError } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name, preferred_name, employment_end_date')
    .eq('status', 'Started Separation')
    .not('employment_end_date', 'is', null)
    .lt('employment_end_date', today)
    .order('employment_end_date', { ascending: true });

  if (fetchError) {
    console.error('[employee-separations] Failed to load employees:', fetchError);
    try {
      await reportCronFailure('employee-separations', new Error('Could not load the staff whose last working day has passed'), {
        code: fetchError.code,
        outcome: 'Nobody was marked as Former tonight. The job tries again tomorrow.',
      });
    } catch (alertError) {
      console.error('[employee-separations] Failed to raise the load failure alert:', alertError);
    }
    return NextResponse.json({ success: false, error: 'Failed to load employees for separation' }, { status: 500 });
  }

  const result = {
    success: true,
    today,
    processedAt: new Date().toISOString(),
    finalized: 0,
    skipped: 0,
    candidates: employees?.length ?? 0,
    errors: [] as Array<{ employeeId: string; name: string; error: string; code?: string }>,
    warnings: [] as Array<{ employeeId: string; name: string; warning: string }>,
  };

  for (const employee of employees ?? []) {
    const name = displayName(employee, 'Unknown');
    const finalizeResult = await finalizeEmployeeSeparation(employee.employee_id, {
      adminClient: supabase,
      todayIso: today,
      source: 'automatic',
      blockShiftsOnOrAfterToday: true,
    });

    if (finalizeResult.success) {
      result.finalized++;
      if (finalizeResult.warning) {
        result.warnings.push({ employeeId: employee.employee_id, name, warning: finalizeResult.warning });
      }
      continue;
    }

    result.skipped++;
    result.errors.push({
      employeeId: employee.employee_id,
      name,
      error: finalizeResult.error,
      code: finalizeResult.code,
    });
  }

  // A leaver the job cannot finalise is skipped again every night until someone clears what is in
  // the way, so every skip is reported. The alert carries a link to each record rather than the
  // person's name, and the reason names the shifts or leave that block it.
  if (result.errors.length > 0 || result.warnings.length > 0) {
    const appUrl = getAppUrl();
    try {
      await reportCronFailure(
        'employee-separations',
        new Error(
          result.errors.length > 0
            ? `${result.errors.length} leaver(s) could not be marked as Former`
            : `${result.warnings.length} leaver(s) were marked as Former but need a follow-up`,
        ),
        {
          not_finalised: result.errors.map((entry) => ({
            record: `${appUrl}/employees/${entry.employeeId}`,
            reason: entry.error,
          })),
          needs_follow_up: result.warnings.map((entry) => ({
            record: `${appUrl}/employees/${entry.employeeId}`,
            reason: entry.warning,
          })),
          outcome: 'Each person not finalised stays in Started Separation and is tried again tomorrow. Clear what is named, or mark them as Former from their record.',
        },
      );
    } catch (alertError) {
      console.error('[employee-separations] Failed to raise the separation failure alert:', alertError);
    }
  }

  return NextResponse.json(result);
}
