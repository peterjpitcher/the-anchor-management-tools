import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { queueManagerReportEmail } from '@/lib/manager-report/queue';
import { getRotaSettings } from '@/app/actions/rota-settings';
import { getTodayIsoDate, formatDateInLondon } from '@/lib/dateUtils';
import { displayName } from '@/lib/employees/display-name';
import {
  selectDueReminders,
  wasTruncated,
  type PendingRequest,
  type ReminderKind,
} from '@/lib/leave/pending-reminders';

/**
 * Collect pending holiday reminders for the Friday report. Queue keys suppress duplicates
 * while the delivery ledger records only reminders actually included in a sent report.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const todayIso = getTodayIsoDate();

  const result = {
    considered: 0,
    sent: 0,
    queued: 0,
    skippedAlreadySent: 0,
    truncated: false,
    errors: [] as string[],
  };

  try {
    const [{ data: pending, error: pendingError }, { data: ledger }, rotaSettings] = await Promise.all([
      supabase
        .from('leave_requests')
        .select('id, employee_id, start_date, end_date, created_at, status, leave_origin')
        .eq('status', 'pending'),
      supabase.from('leave_reminder_log').select('request_id, reminder_kind'),
      getRotaSettings(),
    ]);

    if (pendingError) throw pendingError;

    const requests = (pending ?? []) as PendingRequest[];
    result.considered = requests.length;

    const alreadySent = new Set(
      ((ledger ?? []) as Array<{ request_id: string; reminder_kind: string }>).map(
        row => `${row.request_id}:${row.reminder_kind}`,
      ),
    );

    const due = selectDueReminders(requests, alreadySent, todayIso);
    result.skippedAlreadySent = alreadySent.size;
    result.truncated = wasTruncated(due.length);

    const recipient = rotaSettings.managerEmail;
    if (!recipient) {
      // Not an error worth failing the run over, but it must be visible rather than silent.
      result.errors.push('No manager email configured in rota settings, nothing was sent.');
      return NextResponse.json(result);
    }

    const byId = new Map(requests.map(r => [r.id, r]));
    const employeeIds = [...new Set(due.map(d => byId.get(d.requestId)?.employee_id).filter(Boolean))];
    const { data: employees } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name')
      .in('employee_id', employeeIds as string[]);

    const nameFor = (employeeId: string) => {
      const employee = (employees ?? []).find(e => e.employee_id === employeeId);
      return employee ? displayName(employee, 'An employee') : 'An employee';
    };

    for (const reminder of due) {
      const leaveRequest = byId.get(reminder.requestId);
      if (!leaveRequest) continue;

      const who = nameFor(leaveRequest.employee_id);
      const dates = leaveRequest.start_date === leaveRequest.end_date
        ? formatDateInLondon(leaveRequest.start_date)
        : `${formatDateInLondon(leaveRequest.start_date)} to ${formatDateInLondon(leaveRequest.end_date)}`;

      const subject = reminder.kind === 'imminent'
        ? `Holiday starting soon still needs approving: ${who}`
        : `Holiday request waiting for you: ${who}`;

      const lead = reminder.kind === 'imminent'
        ? `${who} has holiday booked for ${dates}, starting in ${reminder.daysUntilStart} day${reminder.daysUntilStart === 1 ? '' : 's'}, and it still has not been approved.`
        : `${who} asked for holiday ${dates}. It has been waiting ${reminder.daysWaiting} days.`;

      const emailResult = await queueManagerReportEmail({
        section: 'holiday_reminders',
        key: `${reminder.requestId}:${reminder.kind}`,
        to: recipient,
        subject,
        html: buildReminderHtml(lead, who, dates),
        metadata: {
          leave_request_id: reminder.requestId,
          leave_reminder_kind: reminder.kind,
          summary: lead,
        },
      });

      if (!emailResult.success) {
        result.errors.push(`Queue failed for ${reminder.requestId}: ${emailResult.error ?? 'unknown'}`);
        continue;
      }
      result.queued += 1;
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[leave-approval-reminders] Run failed:', error);
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(result, { status: 500 });
  }
}

function buildReminderHtml(lead: string, who: string, dates: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk';
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111">
      <p>${lead}</p>
      <p style="margin:16px 0;padding:12px;background:#f6f6f6;border-radius:6px">
        <strong>${who}</strong><br>${dates}
      </p>
      <p><a href="${baseUrl}/rota/leave" style="color:#166534">Review it in the rota</a></p>
      <p style="color:#666;font-size:13px">
        You will only get one of these per request, so nothing here will nag you daily.
      </p>
    </div>
  `;
}
