import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendChaseEmail, sendPortalInviteEmail } from '@/lib/email/employee-invite-emails';
import { reportCronFailure } from '@/lib/cron/alerting';
import { getAppUrl } from '@/lib/env';
import { inviteTokenProblem, type InviteKind } from '@/lib/employees/invite-token-rules';
import { describeInviteEmailFailure } from '@/lib/employees/invite-email-failure';

// Its own time limit rather than the 15-second project default (BK-212).
export const maxDuration = 60;

function buildOnboardingUrl(token: string): string {
  return `${getAppUrl()}/onboarding/${token}`;
}

/** The chase stamps a reminder writes when it claims a link, or puts back when it did not go. */
type ChaseStamp = {
  day3_chase_sent_at?: string | null;
  day6_chase_sent_at?: string | null;
};

type ChaseEmployee = {
  employee_id: string;
  email_address: string | null;
  status: string | null;
  employment_end_date: string | null;
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
  // What this run's claims write. It doubles as this run's own mark on a link, so a claim that has
  // to be taken back can only take back this run's (see the claim below). nowIso alone is to the
  // millisecond, and two runs that start in the same millisecond would write the same value.
  // Postgres keeps timestamps to the microsecond, so three random microsecond digits are added: two
  // runs then share a stamp only if they start in the same millisecond and draw the same digits (a
  // one in a thousand chance on top). It is not a guarantee; only a claim column could give one.
  const claimStamp = `${nowIso.slice(0, -1)}${String(randomInt(1000)).padStart(3, '0')}Z`;

  const day3Threshold = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const day6Threshold = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

  const result = {
    day3ChasesSent: 0,
    day6ChasesSent: 0,
    skipped: 0,
    /** Older open links left alone because the same person has a newer one. */
    superseded: 0,
    /** Chases that did not go and are not stamped, so the next run tries them again. */
    errors: [] as string[],
    /** Chases the email service took without answering. They may have gone, so they stay stamped. */
    uncertain: [] as string[],
    /** Chases an overlapping run had already claimed, so this run left them to it. */
    claimedElsewhere: 0,
    /**
     * Chases that did not go whose stamp could not be cleared again: the email service refused
     * them, or their claim failed but may have been saved anyway. No run may send them, because
     * the link may still say they did.
     */
    missed: [] as string[],
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
        .select('employee_id, email_address, status, employment_end_date, auth_user_id')
        .in('employee_id', employeeIds);
      if (employeesError) {
        throw employeesError;
      }
      for (const employee of (employees ?? []) as ChaseEmployee[]) {
        employeesById.set(employee.employee_id, employee);
      }
    }

    // One reminder per person per run, on their newest link that still works. A resend or portal
    // invite that may have gone keeps the older links working beside the new one, and chasing
    // every open link sent the same person several reminders, each with a different link.
    type ChaseToken = NonNullable<typeof tokens>[number];
    const newestByEmployee = new Map<string, ChaseToken>();
    for (const row of tokens ?? []) {
      const inviteType = (row.invite_type ?? 'onboarding') as InviteKind;
      const employee = employeesById.get(row.employee_id);
      if (!employee || inviteTokenProblem({ inviteType, tokenEmail: row.email, employee })) {
        result.skipped++;
        continue;
      }
      const newest = newestByEmployee.get(row.employee_id);
      if (newest) {
        result.superseded++;
        if (Date.parse(row.created_at) <= Date.parse(newest.created_at)) continue;
      }
      newestByEmployee.set(row.employee_id, row);
    }

    for (const row of newestByEmployee.values()) {
      const inviteType = (row.invite_type ?? 'onboarding') as InviteKind;

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
      // `stamp` is what the claim writes; `unclaim` is what the row had, which a refused send
      // puts back. Day 3 is stamped whenever it is still empty, alongside day 6 or on its own.
      const stampsDay3 = !row.day3_chase_sent_at;
      const stamp: ChaseStamp = {
        ...(day6Due ? { day6_chase_sent_at: claimStamp } : {}),
        ...(stampsDay3 ? { day3_chase_sent_at: claimStamp } : {}),
      };
      const unclaim: ChaseStamp = {
        ...(day6Due ? { day6_chase_sent_at: row.day6_chase_sent_at } : {}),
        ...(stampsDay3 ? { day3_chase_sent_at: row.day3_chase_sent_at } : {}),
      };

      // Claimed before it is sent: a stamp written after the send could fail and leave a
      // reminder that went looking unsent, so the next run sent it again. The claim only lands
      // while every column it writes is still empty, so two overlapping runs cannot both send.
      let claim = supabase.from('employee_invite_tokens').update(stamp).eq('id', row.id);
      if (day6Due) claim = claim.is('day6_chase_sent_at', null);
      if (stampsDay3) claim = claim.is('day3_chase_sent_at', null);
      const { data: claimed, error: claimError } = await claim.select('id');
      if (claimError) {
        // Nothing went. But a claim can fail after it was saved: a dropped connection comes back
        // as an error (with an empty code) even when the update went through, and the next run
        // would then see the stamp and never send this reminder. So this run's claim is taken
        // back if it landed. The put-back matches only while every column it clears still holds
        // this run's own stamp, so it cannot undo another run's claim, and it matches nothing
        // when the claim never landed.
        console.error(`[employee-invite-chase] Failed to claim the ${label.toLowerCase()} chase for token:`, row.id, {
          code: claimError.code,
          message: claimError.message,
        });
        let putBack = supabase.from('employee_invite_tokens').update(unclaim).eq('id', row.id);
        if (day6Due) putBack = putBack.eq('day6_chase_sent_at', claimStamp);
        if (stampsDay3) putBack = putBack.eq('day3_chase_sent_at', claimStamp);
        const { error: putBackError } = await putBack;
        if (putBackError) {
          // The claim may be on the link, so no run may send this reminder: a person has to.
          console.error(`[employee-invite-chase] Failed to take back the ${label.toLowerCase()} chase claim for token:`, row.id, {
            code: putBackError.code,
            message: putBackError.message,
          });
          result.missed.push(
            `${label} chase for ${row.email} was not sent, because its link could not be marked first (${claimError.message}). The mark may have been saved anyway and could not be cleared, so no run may send it (token ${row.id}): ${putBackError.message}`,
          );
          continue;
        }
        // The link holds no claim from this run, so the next run trying again is safe.
        result.errors.push(
          `${label} chase for ${row.email} was not sent, because its link could not be marked first (token ${row.id}): ${claimError.message}`,
        );
        continue;
      }
      if (!claimed || claimed.length === 0) {
        result.claimedElsewhere++;
        continue;
      }

      try {
        if (inviteType === 'portal_access') {
          await sendPortalInviteEmail(row.email, buildOnboardingUrl(row.token), row.expires_at);
        } else {
          await sendChaseEmail(row.email, buildOnboardingUrl(row.token), dayNumber, row.expires_at);
        }
      } catch (emailError: unknown) {
        const failure = describeInviteEmailFailure(emailError);
        if (failure.uncertain) {
          // The email service took it and did not answer: the reminder may have arrived. The
          // stamp stays, because sending it again next run could give them two.
          result.uncertain.push(`${label} chase for ${row.email} may have gone, with no answer from the email service: ${failure.detail}`);
          continue;
        }

        // It definitely did not go, so the stamp comes off and the next run tries again.
        const { error: unclaimError } = await supabase
          .from('employee_invite_tokens')
          .update(unclaim)
          .eq('id', row.id);
        if (unclaimError) {
          console.error(`[employee-invite-chase] Failed to clear the ${label.toLowerCase()} chase stamp for token:`, row.id, {
            code: unclaimError.code,
            message: unclaimError.message,
          });
          result.missed.push(
            `${label} chase for ${row.email} did not go (${failure.detail}), and its link still says it did, so no run will send it (token ${row.id}): ${unclaimError.message}`,
          );
          continue;
        }
        result.errors.push(`${label} chase failed for ${row.email}: ${failure.detail}`);
        continue;
      }

      if (day6Due) {
        result.day6ChasesSent++;
      } else {
        result.day3ChasesSent++;
      }
    }

    // A chase whose email failed has its stamp cleared, so the next run tries it again. Nobody
    // would otherwise know the provider is refusing: a run that sent nothing looks exactly like a
    // quiet one, and the reminders these emails carry are what get a new starter onboarded. A
    // chase that may have gone keeps its stamp (sendEmail's rule for a cron: never retry an
    // unknown send). A chase that did not go but whose stamp could not be cleared (after a refused
    // send, or a failed claim that may have landed) is raised too: only a person can send it now.
    if (result.errors.length > 0 || result.uncertain.length > 0 || result.missed.length > 0) {
      const summary = [
        result.errors.length > 0 ? `${result.errors.length} invite chase email(s) did not go` : null,
        result.uncertain.length > 0 ? `${result.uncertain.length} invite chase email(s) may have gone` : null,
        result.missed.length > 0
          ? `${result.missed.length} invite chase email(s) did not go and will not be tried again`
          : null,
      ].filter(Boolean).join('; ');
      const outcome = [
        result.errors.length > 0
          ? 'The chases that failed are not recorded as sent, so the next run tries them again.'
          : null,
        result.uncertain.length > 0
          ? 'The chases that may have gone are recorded as sent, so they are not sent twice. Check with the person before sending them anything else.'
          : null,
        result.missed.length > 0
          ? 'The chases that will not be tried again did not go, but their links may still say they did. Resend the invite from the employee profile if they still need a reminder.'
          : null,
      ].filter(Boolean).join(' ');
      try {
        await reportCronFailure(
          'employee-invite-chase',
          new Error(summary),
          {
            failures: result.errors,
            ...(result.uncertain.length > 0 ? { may_have_gone: result.uncertain } : {}),
            ...(result.missed.length > 0 ? { missed: result.missed } : {}),
            day3_chases_sent: result.day3ChasesSent,
            day6_chases_sent: result.day6ChasesSent,
            outcome,
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
