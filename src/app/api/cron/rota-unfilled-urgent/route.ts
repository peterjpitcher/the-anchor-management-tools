import { NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/emailService';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { resolveRotaManagerEmail } from '@/lib/rota/manager-email';
import {
  getUnfilledShifts,
  daysUntil,
  URGENT_UNFILLED_HORIZON_DAYS,
  type UnfilledShift,
} from '@/lib/rota/unfilled-shifts';
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils';

/**
 * Chases a shift with nobody on it inside the next week, every morning.
 *
 * The weekly manager alert runs at 18:00 on a Sunday and looks eight weeks
 * ahead, which is the right cadence for "the rota is not published yet" but the
 * wrong one for "nobody is cooking on Sunday". A gap that opens on a Tuesday
 * waited until the following Sunday evening to be mentioned, and a gap on the
 * Sunday itself was reported at 18:00 that day, after the shift had ended.
 *
 * This runs daily and only carries shifts inside a one week horizon, so it stays
 * short enough to read on a phone and rare enough to still mean something.
 */

const TIMEZONE = 'Europe/London';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "today", "tomorrow", or the weekday, whichever a manager reads fastest. */
function whenLabel(todayIso: string, shiftDate: string): string {
  const days = daysUntil(todayIso, shiftDate);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return formatDateInLondon(`${shiftDate}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' });
}

function shiftLine(todayIso: string, shift: UnfilledShift): string {
  const when = escapeHtml(whenLabel(todayIso, shift.date));
  const times = `${formatTime12Hour(shift.startTime)} to ${formatTime12Hour(shift.endTime)}`;
  const name = shift.templateName ? escapeHtml(shift.templateName) : escapeHtml(shift.department);
  const rejected = shift.rejectedByName
    ? `<br><span style="color:#666;font-size:13px">turned down by ${escapeHtml(shift.rejectedByName)}` +
      (shift.rejectionNote ? `: ${escapeHtml(shift.rejectionNote)}` : '') +
      '</span>'
    : '';
  return `<li style="margin-bottom:10px"><strong>${when}</strong>, ${escapeHtml(times)}: ${name} (${escapeHtml(shift.department)})${rejected}</li>`;
}

function buildUrgentUnfilledEmailHtml(todayIso: string, shifts: UnfilledShift[]): string {
  const soonest = daysUntil(todayIso, shifts[0]!.date);
  const lead = soonest <= 0
    ? 'A shift today still has nobody on it.'
    : soonest === 1
      ? 'A shift tomorrow still has nobody on it.'
      : `The soonest is in ${soonest} days.`;

  const href = `${APP_URL}/rota/reassign`;
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px">
      <h2 style="margin-bottom:4px">${shifts.length} unfilled ${shifts.length === 1 ? 'shift' : 'shifts'} in the next week</h2>
      <p style="margin-top:0;color:#666">${escapeHtml(lead)}</p>
      <ul style="padding-left:18px">${shifts.map(shift => shiftLine(todayIso, shift)).join('')}</ul>
      <p style="margin-top:20px">
        <a href="${escapeHtml(href)}" style="background:#16a34a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Fill these shifts</a>
      </p>
      <p style="color:#888;font-size:12px">Sent every morning while a shift inside the next week is unfilled.</p>
    </div>
  `;
}

export async function GET(request: Request): Promise<NextResponse> {
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowUtc = new Date();
  const todayIso = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd');
  const supabase = createAdminClient();

  const { shifts, failures } = await getUnfilledShifts(
    supabase,
    todayIso,
    URGENT_UNFILLED_HORIZON_DAYS,
  );

  // A failed query used to look exactly like "nothing to report". Say so loudly
  // instead, so a database fault cannot quietly stop the chasing.
  if (failures.length > 0) {
    return NextResponse.json({ ok: false, action: 'query_failed', failures }, { status: 500 });
  }

  if (shifts.length === 0) {
    return NextResponse.json({ ok: true, action: 'no_unfilled_shifts', todayIso });
  }

  const managerEmail = await resolveRotaManagerEmail(supabase);
  if ('error' in managerEmail) {
    console.error('[rota-unfilled-urgent] no manager email configured:', managerEmail.error);
    return NextResponse.json(
      { ok: false, action: 'no_manager_email', error: managerEmail.error, unfilled: shifts.length },
      { status: 500 },
    );
  }

  const soonest = daysUntil(todayIso, shifts[0]!.date);
  const urgency = soonest <= 0 ? 'today' : soonest === 1 ? 'tomorrow' : `in ${soonest} days`;
  const subject = `${shifts.length} unfilled ${shifts.length === 1 ? 'shift' : 'shifts'} this week, soonest ${urgency}`;

  const emailResult = await sendEmail({
    to: managerEmail.email,
    subject,
    html: buildUrgentUnfilledEmailHtml(todayIso, shifts),
  });

  await supabase.from('rota_email_log').insert({
    email_type: 'unfilled_urgent',
    entity_type: 'rota_shift',
    entity_id: shifts[0]!.id,
    to_addresses: [managerEmail.email],
    subject,
    status: emailResult.success ? 'sent' : 'failed',
    error_message: emailResult.success ? null : (emailResult.error ?? null),
  });

  if (!emailResult.success) {
    return NextResponse.json(
      { ok: false, action: 'email_failed', error: emailResult.error ?? null, unfilled: shifts.length },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    action: 'alert_sent',
    todayIso,
    unfilled: shifts.length,
    soonestInDays: soonest,
  });
}
