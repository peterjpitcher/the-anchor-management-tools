import { NextResponse } from 'next/server';
import { toZonedTime, format } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendRotaWeekEmails } from '@/lib/rota/send-rota-emails';

// Vercel Cron: runs at 21:00 Europe/London every Sunday
const TIMEZONE = 'Europe/London';

function nextMonday(from: Date): string {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() + (day === 0 ? 1 : 8 - day));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowUtc = new Date();
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);

  if (nowLocal.getDay() !== 0) {
    return NextResponse.json({ skipped: true, reason: 'Not Sunday' });
  }

  const weekStart = nextMonday(nowLocal);
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
