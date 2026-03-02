import { NextResponse } from 'next/server';
import { toZonedTime, format } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/emailService';
import { buildManagerAlertEmailHtml } from '@/lib/rota/email-templates';

// Vercel Cron: runs at 18:00 Europe/London every Sunday
const TIMEZONE = 'Europe/London';

function nextMonday(from: Date): string {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() + (day === 0 ? 1 : 8 - day));
  d.setHours(0, 0, 0, 0);
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

  // Check rota_weeks for the upcoming week
  const { data: week } = await supabase
    .from('rota_weeks')
    .select('id, status, has_unpublished_changes')
    .eq('week_start', weekStart)
    .single();

  const needsAlert = !week || week.status === 'draft' || week.has_unpublished_changes;
  if (!needsAlert) {
    return NextResponse.json({ ok: true, action: 'no_alert_needed', weekStart });
  }

  const reason: 'not_published' | 'unpublished_changes' =
    !week || week.status === 'draft' ? 'not_published' : 'unpublished_changes';

  const { data: managerEmailSetting } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'rota_manager_email')
    .single();
  const managerEmail =
    (managerEmailSetting?.value as { value: string } | null)?.value ||
    process.env.ROTA_MANAGER_EMAIL;
  if (!managerEmail) {
    return NextResponse.json({ ok: true, action: 'skipped_no_email', weekStart });
  }

  const emailResult = await sendEmail({
    to: managerEmail,
    subject: `Rota Alert: week of ${weekStart} needs attention`,
    html: buildManagerAlertEmailHtml(weekStart, reason),
  });

  await supabase.from('rota_email_log').insert({
    email_type: 'manager_alert',
    entity_type: 'rota_week',
    entity_id: week?.id ?? null,
    to_addresses: [managerEmail],
    subject: `Rota Alert: week of ${weekStart}`,
    status: emailResult.success ? 'sent' : 'failed',
    error_message: emailResult.success ? null : (emailResult.error ?? null),
  });

  return NextResponse.json({
    ok: true,
    action: 'alert_sent',
    weekStart,
    reason,
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  });
}
