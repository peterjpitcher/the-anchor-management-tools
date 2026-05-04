import { NextRequest, NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { finalizeEmployeeSeparation } from '@/lib/employees/separation';

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
    .select('employee_id, first_name, last_name, employment_end_date')
    .eq('status', 'Started Separation')
    .not('employment_end_date', 'is', null)
    .lt('employment_end_date', today)
    .order('employment_end_date', { ascending: true });

  if (fetchError) {
    console.error('[employee-separations] Failed to load employees:', fetchError);
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
  };

  for (const employee of employees ?? []) {
    const name = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unknown';
    const finalizeResult = await finalizeEmployeeSeparation(employee.employee_id, {
      adminClient: supabase,
      todayIso: today,
      source: 'automatic',
      blockShiftsOnOrAfterToday: true,
    });

    if (finalizeResult.success) {
      result.finalized++;
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

  return NextResponse.json(result);
}
