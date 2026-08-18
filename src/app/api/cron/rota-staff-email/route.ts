import { NextResponse } from 'next/server';
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendRotaWeekEmails } from '@/lib/rota/send-rota-emails';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { getRotaWeekReadiness, readinessWeekFromRow } from '@/lib/rota/week-readiness';
import type { PublishedShiftSnapshot, RotaPublishShift } from '@/lib/rota/publish-status';

// Vercel Cron: runs at 21:00 Europe/London every Sunday
const TIMEZONE = 'Europe/London';

function getNextMondayIso(nowUtc: Date): string {
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);
  const day = nowLocal.getDay(); // 0=Sun, 1=Mon...
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const nextMon = new Date(nowLocal.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  return formatInTimeZone(nextMon, TIMEZONE, 'yyyy-MM-dd');
}

export async function GET(request: Request): Promise<NextResponse> {
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowUtc = new Date();
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);

  if (nowLocal.getDay() !== 0) {
    return NextResponse.json({ skipped: true, reason: 'Not Sunday' });
  }

  const weekStart = getNextMondayIso(nowUtc);
  const localTime = format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE });
  const supabase = createAdminClient();

  // Only next week is emailed, and that is deliberate: staff need the week ahead,
  // not the planning horizon the manager alert covers.
  const { data: week, error: weekError } = await supabase
    .from('rota_weeks')
    .select('id, status, published_at')
    .eq('week_start', weekStart)
    .maybeSingle();

  if (weekError) {
    return NextResponse.json(
      { ok: false, action: 'week_lookup_failed', weekStart, error: weekError.message, localTime },
      { status: 500 },
    );
  }

  if (!week) {
    return NextResponse.json({ ok: true, action: 'skipped_no_week', weekStart, localTime });
  }

  // `status = 'published'` on its own is not enough to email 20 people their week.
  // It says a publish was once attempted, not that what staff would receive matches
  // the rota as it stands: a week can be marked published with no publish time at
  // all, or carry shifts added or deleted since. Readiness diffs the live rota
  // against the published snapshot and answers the question actually being asked.
  const [liveResult, publishedResult] = await Promise.all([
    supabase
      .from('rota_shifts')
      .select(
        'id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, reassignment_reason, created_at, updated_at',
      )
      .eq('week_id', week.id),
    supabase
      .from('rota_published_shifts')
      .select(
        'id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name',
      )
      .eq('week_id', week.id),
  ]);

  if (liveResult.error || publishedResult.error) {
    return NextResponse.json(
      {
        ok: false,
        action: 'readiness_check_failed',
        weekStart,
        error: liveResult.error?.message ?? publishedResult.error?.message ?? 'Unknown error',
        localTime,
      },
      { status: 500 },
    );
  }

  const readiness = getRotaWeekReadiness(
    readinessWeekFromRow(weekStart, week),
    (liveResult.data ?? []) as RotaPublishShift[],
    (publishedResult.data ?? []) as PublishedShiftSnapshot[],
  );

  // Emailing a rota we already know is wrong is worse than emailing nothing: staff
  // plan their week around it. The manager alert has flagged the same week three
  // hours earlier, so this is not a silent stop.
  if (readiness.state !== 'published_current') {
    return NextResponse.json({
      ok: true,
      action: 'skipped_not_current',
      weekStart,
      state: readiness.state,
      unpublishedCount: readiness.unpublishedCount,
      removedCount: readiness.removedCount,
      reasons: readiness.reasons,
      localTime,
    });
  }

  const { sent, errors } = await sendRotaWeekEmails(week.id, weekStart);

  return NextResponse.json({
    ok: true,
    action: 'emails_sent',
    weekStart,
    sent,
    errors,
    localTime,
  });
}
