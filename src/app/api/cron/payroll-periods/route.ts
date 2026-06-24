import { NextResponse } from 'next/server';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { PAYROLL_PERIOD_FUTURE_MONTHS } from '@/lib/rota/payroll-periods';
import { ensurePayrollPeriodsAheadRecords } from '@/lib/rota/payroll-period-store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = getTodayIsoDate();
    const periods = await ensurePayrollPeriodsAheadRecords(today, PAYROLL_PERIOD_FUTURE_MONTHS);

    return NextResponse.json({
      success: true,
      today,
      futureMonths: PAYROLL_PERIOD_FUTURE_MONTHS,
      periods: periods.map(period => ({
        year: period.year,
        month: period.month,
        period_start: period.period_start,
        period_end: period.period_end,
      })),
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[payroll-periods] Failed to ensure payroll periods:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to ensure payroll periods' },
      { status: 500 },
    );
  }
}
