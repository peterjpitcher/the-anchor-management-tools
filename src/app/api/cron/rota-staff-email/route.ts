import { NextResponse } from 'next/server';
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendRotaWeekEmails } from '@/lib/rota/send-rota-emails';
import { authorizeCronRequest } from '@/lib/cron-auth';

// Vercel Cron: runs at 21:00 Europe/London every Sunday
const TIMEZONE = 'Europe/London';

function getNextMondayIso(nowUtc: Date): string {
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);
  const day = nowLocal.getDay(); // 0=Sun, 1=Mon...
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const nextMon = new Date(nowLocal.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  return formatInTimeZone(nextMon, TIMEZONE, 'yyyy-MM-dd');
}

export async function GET(request: Request) {
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
  const supabase = createAdminClient();

  const { data: week } = await supabase
    .from('rota_weeks')
    .select('id, status')
    .eq('week_start', weekStart)
    .single();

  if (!week || week.status !== 'published') {
    return NextResponse.json({
      ok: true,
      action: 'skipped_unpublished',
      weekStart,
      localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
    });
  }

  const { sent, errors } = await sendRotaWeekEmails(week.id, weekStart);

  return NextResponse.json({
    ok: true,
    action: 'emails_sent',
    weekStart,
    sent,
    errors,
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  });
}
