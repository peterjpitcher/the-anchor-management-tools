import { NextResponse } from 'next/server';
import { toZonedTime, format, fromZonedTime } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';

// Vercel Cron: runs at 05:00 UTC daily (cron: "0 5 * * *")
const TIMEZONE = 'Europe/London';

// Uses UTC arithmetic throughout so the result is server-timezone-independent.
function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowUtc = new Date();
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);
  const localHour = nowLocal.getHours();

  // Allow 04:00–06:00 local to handle DST transitions
  if (localHour < 4 || localHour > 6) {
    return NextResponse.json({
      skipped: true,
      reason: `Local hour ${localHour} is outside expected window`,
      localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
    });
  }

  const supabase = createAdminClient();

  // Find all open sessions (no clock-out)
  const { data: openSessions, error: fetchError } = await supabase
    .from('timeclock_sessions')
    .select('id, employee_id, work_date, linked_shift_id, rota_shifts(start_time, end_time, shift_date, is_overnight)')
    .is('clock_out_at', null);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const sessions = (openSessions ?? []) as Array<{
    id: string;
    employee_id: string;
    work_date: string;
    linked_shift_id: string | null;
    rota_shifts:
      | { start_time: string; end_time: string; shift_date: string; is_overnight: boolean }
      | { start_time: string; end_time: string; shift_date: string; is_overnight: boolean }[]
      | null;
  }>;

  let closed = 0;
  const errors: string[] = [];

  for (const session of sessions) {
    const shift = Array.isArray(session.rota_shifts)
      ? session.rota_shifts[0]
      : session.rota_shifts;

    let clockOutAt: string;
    let reason: string;

    if (shift) {
      // Build clock-out time from scheduled shift end (including overnight shifts).
      const startClock = shift.start_time.slice(0, 5);
      const endClock = shift.end_time.slice(0, 5);
      const overnightByClock = endClock <= startClock;
      const endsNextDay = shift.is_overnight || overnightByClock;
      const endDate = endsNextDay ? addDaysIso(shift.shift_date, 1) : shift.shift_date;
      const shiftEndUtc = fromZonedTime(`${endDate}T${endClock}:00`, TIMEZONE);
      clockOutAt = shiftEndUtc.toISOString();
      reason = 'scheduled_end';
    } else {
      // Fallback: use 23:59 local time on the work_date — more honest than cron
      // execution time (~05:00 UTC) which would inflate worked hours significantly.
      const workDate = session.work_date;
      const fallbackLocal = fromZonedTime(`${workDate}T23:59:00`, TIMEZONE);
      clockOutAt = fallbackLocal.toISOString();
      reason = 'fallback_end_of_day';
    }

    const { error: updateError } = await supabase
      .from('timeclock_sessions')
      .update({
        clock_out_at: clockOutAt,
        is_auto_close: true,
        auto_close_reason: reason,
      })
      .eq('id', session.id);

    if (updateError) {
      errors.push(`Session ${session.id}: ${updateError.message}`);
      continue;
    }

    closed++;

    // DEF-003: Invalidate any payroll approval that covers this work_date so the
    // auto-close is reflected if the manager re-approves payroll.
    const { data: periods } = await supabase
      .from('payroll_periods')
      .select('year, month')
      .lte('period_start', session.work_date)
      .gte('period_end', session.work_date);

    if (periods?.length) {
      await Promise.all(
        periods.map(period =>
          supabase
            .from('payroll_month_approvals')
            .delete()
            .eq('year', period.year)
            .eq('month', period.month),
        ),
      );
    }
  }

  return NextResponse.json({
    ok: true,
    closed,
    errors: errors.length ? errors : undefined,
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  });
}
