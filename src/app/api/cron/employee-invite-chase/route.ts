import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendChaseEmail, sendPortalInviteEmail } from '@/lib/email/employee-invite-emails';
import { reportCronFailure } from '@/lib/cron/alerting';
import { getAppUrl } from '@/lib/env';
import { inviteTokenProblem, type InviteKind } from '@/lib/employees/invite-token-rules';

// Its own time limit rather than the 15-second project default (BK-212).
export const maxDuration = 60;

function buildOnboardingUrl(token: string): string {
  return `${getAppUrl()}/onboarding/${token}`;
}

type ChaseEmployee = {
  employee_id: string;
  email_address: string | null;
  status: string | null;
  auth_user_id: string | null;
};

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const day3Threshold = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const day6Threshold = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

  const result = {
    day3ChasesSent: 0,
    day6ChasesSent: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    // Fetch all pending tokens
    const { data: tokens, error: fetchError } = await supabase
      .from('employee_invite_tokens')
      .select('id, token, email, employee_id, invite_type, created_at, expires_at, day3_chase_sent_at, day6_chase_sent_at')
      .is('completed_at', null)
      .gt('expires_at', nowIso);

    if (fetchError) {
      throw fetchError;
    }

    // An open link is not enough: the person it was sent to must still be able to use it. A
    // starter a manager made Active by hand, or whose email was corrected, used to keep getting
    // reminders to a link that would then refuse them. Same rules as validateInviteToken.
    const employeeIds = [...new Set((tokens ?? []).map((row) => row.employee_id).filter(Boolean))];
    const employeesById = new Map<string, ChaseEmployee>();
    if (employeeIds.length > 0) {
      const { data: employees, error: employeesError } = await supabase
        .from('employees')
        .select('employee_id, email_address, status, auth_user_id')
        .in('employee_id', employeeIds);
      if (employeesError) {
        throw employeesError;
      }
      for (const employee of (employees ?? []) as ChaseEmployee[]) {
        employeesById.set(employee.employee_id, employee);
      }
    }

    for (const row of tokens ?? []) {
      const inviteType = (row.invite_type ?? 'onboarding') as InviteKind;
      const employee = employeesById.get(row.employee_id);
      if (!employee || inviteTokenProblem({ inviteType, tokenEmail: row.email, employee })) {
        result.skipped++;
        continue;
      }

      // One reminder per link per run. A run that is late (or a link made just before a missed
      // run) used to send the day 3 and day 6 emails together. When both are due, only the day 6
      // one goes, because it carries the expiry, and the day 3 stamp is set with it so the day 3
      // email never follows the last reminder.
      const createdAt = row.created_at;
      const day6Due = !row.day6_chase_sent_at && createdAt <= day6Threshold;
      const day3Due = !row.day3_chase_sent_at && createdAt <= day3Threshold;
      if (!day6Due && !day3Due) continue;

      const dayNumber = day6Due ? 6 : 3;
      const label = `Day ${dayNumber}`;
      try {
        if (inviteType === 'portal_access') {
          await sendPortalInviteEmail(row.email, buildOnboardingUrl(row.token), row.expires_at);
        } else {
          await sendChaseEmail(row.email, buildOnboardingUrl(row.token), dayNumber, row.expires_at);
        }
        const stamp = day6Due
          ? { day6_chase_sent_at: nowIso, ...(row.day3_chase_sent_at ? {} : { day3_chase_sent_at: nowIso }) }
          : { day3_chase_sent_at: nowIso };
        const { error: updateError } = await supabase
          .from('employee_invite_tokens')
          .update(stamp)
          .eq('id', row.id);
        if (updateError) {
          console.error(`[employee-invite-chase] Failed to record ${label.toLowerCase()} timestamp for token:`, row.id, updateError);
          result.errors.push(`${label} timestamp update failed for ${row.email}: ${updateError.message}`);
        } else if (day6Due) {
          result.day6ChasesSent++;
        } else {
          result.day3ChasesSent++;
        }
      } catch (emailError: unknown) {
        const message = emailError instanceof Error ? emailError.message : String(emailError);
        result.errors.push(`${label} chase failed for ${row.email}: ${message}`);
      }
    }

    // A chase whose email failed is not stamped, so the next run tries it again. Nobody would
    // otherwise know the provider is refusing: a run that sent nothing looks exactly like a quiet
    // one, and the reminders these emails carry are what get a new starter onboarded.
    if (result.errors.length > 0) {
      try {
        await reportCronFailure(
          'employee-invite-chase',
          new Error(`${result.errors.length} invite chase email(s) did not go`),
          {
            failures: result.errors,
            day3_chases_sent: result.day3ChasesSent,
            day6_chases_sent: result.day6ChasesSent,
            outcome: 'The chases that failed are not recorded as sent, so the next run tries them again.',
          }
        );
      } catch (alertError) {
        console.error('[employee-invite-chase] Failed to raise the chase failure alert:', alertError);
      }
    }

    return NextResponse.json({
      success: true,
      ...result,
      processedAt: nowIso,
    });
  } catch (error: unknown) {
    console.error('[employee-invite-chase] Failed:', error);
    // The whole run failed (the tokens or employees could not be read), so no reminder went to
    // anyone. Say so, as the per-email failures above do: a 500 nobody reads looks like a quiet day.
    try {
      await reportCronFailure('employee-invite-chase', error, {
        day3_chases_sent: result.day3ChasesSent,
        day6_chases_sent: result.day6ChasesSent,
        outcome: 'No invite reminders were sent this run. The next run tries again.',
      });
    } catch (alertError) {
      console.error('[employee-invite-chase] Failed to raise the run failure alert:', alertError);
    }
    return NextResponse.json(
      { success: false, error: 'Failed to process employee invite chase' },
      { status: 500 }
    );
  }
}
