import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/emailService';
import { escapeHtml } from '@/lib/email/escape-html';
import { getUpcomingBirthday, calculateAge } from '@/lib/employeeUtils';
import { displayName } from '@/lib/employees/display-name';
import { formatDateInLondon, formatTimeInLondon, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils';
import { STAFF } from '@/lib/brand/palette';
import { errorLogFields } from '@/lib/errors';
import { logAuditEvent } from '@/app/actions/audit';
import {
  STALE_PROCESSING_MS,
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  lookupIdempotencyKey,
  markIdempotencyClaimCommitted,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency';

/**
 * The birthday reminder email to the manager, for employees whose birthday is exactly
 * `daysAhead` days away.
 *
 * A plain server module, deliberately not a 'use server' file: every export of one of those is a
 * server action anyone signed in can call from the browser. This sender has no permission check
 * of its own, and it used to be exported from src/app/actions/employee-birthdays.ts, so any login
 * could make the app email the manager. Two callers use it: the daily cron
 * (api/cron/birthday-reminders, behind the cron secret) and the sendBirthdayReminders action,
 * which checks employees:manage first.
 */

export interface EmployeeWithBirthday {
  employee_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  job_title: string | null;
  date_of_birth: string;
  email_address: string | null;
  days_until_birthday: number;
  turning_age: number;
}

export type BirthdayReminderResult =
  | {
      success: true;
      sent: number;
      message: string;
      /**
       * True when the reminder went but the app could not record that it did (see recordRun).
       * The cron raises an alert and the page shows a warning, because a press of the Birthdays
       * button after the claim goes stale would send the manager a second copy.
       */
      unrecorded?: boolean;
      error?: undefined;
      uncertain?: undefined;
      warning?: undefined;
    }
  | {
      /**
       * Another run holds today's reminder: it is being sent now, or it may have gone a few
       * minutes ago without a confirmation. Nothing was sent; the sentence says to check with
       * the manager and when the page can send it.
       */
      warning: string;
      success?: undefined;
      sent?: undefined;
      message?: undefined;
      unrecorded?: undefined;
      error?: undefined;
      uncertain?: undefined;
    }
  | {
      /** A fixed sentence for people. The database's or email service's own text is only logged. */
      error: string;
      /**
       * True when the email may have reached the manager: it was handed to the email service,
       * which did not confirm it. Nothing resends it automatically; a person checks with the
       * manager first.
       */
      uncertain?: boolean;
      success?: undefined;
      sent?: undefined;
      message?: undefined;
      unrecorded?: undefined;
      warning?: undefined;
    };

type BirthdayReminderSuccess = Extract<BirthdayReminderResult, { success: true }>;

/** What staff and the cron alert are told. Exported for the tests. */
export const BIRTHDAY_REMINDER_MESSAGES = {
  notStarted: "Today's birthday reminder could not be started, so it was not sent. Please try again later.",
  loadFailed: 'The staff list could not be loaded, so no birthday reminder was sent. Please try again later.',
  notSent: 'The birthday reminder email was not sent. Please try again later.',
  // No "try again later": it stays off until someone switches email back on (SUSPEND_ALL_EMAIL or
  // SUSPEND_ALL_COMMS, either of which makes sendEmail return 'email_suspended').
  suspended: 'Email sending is switched off at the moment, so the birthday reminder was not sent.',
  uncertain:
    'The birthday reminder email may have reached the manager, but the email service did not confirm it. Check with the manager before sending it again.',
  // No date in it: the run key is an ISO date, which is not for people.
  alreadyDone: "Today's birthday reminder has already been dealt with.",
  /** `sendFrom` is a London time, as HH:mm. */
  inProgress: (sendFrom: string) =>
    `Today's birthday reminder was started a few minutes ago and may already have reached the manager. Check with the manager before sending it again. If it did not arrive, you can send it from ${sendFrom}.`,
  unrecorded:
    'but the app could not record that it went. Do not send it again today, or the manager will get a second copy.',
} as const;

/** Logs a failure field by field, never the whole object. */
function logFailure(what: string, error: unknown): void {
  console.error(`[birthday-reminders] ${what}`, errorLogFields(error));
}

export async function sendBirthdayRemindersInternal(daysAhead: number = 7): Promise<BirthdayReminderResult> {
  const supabase = createAdminClient();
  const runDateKey = getTodayIsoDate();
  const idempotencyKey = `cron:employee-birthday-reminder:${runDateKey}:${daysAhead}`;
  const requestHash = computeIdempotencyRequestHash({
    run_date: runDateKey,
    days_ahead: daysAhead
  });

  const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash, 24 * 3).catch((claimError: unknown) => {
    logFailure('Could not claim the run', claimError);
    return null;
  });
  if (!claim) {
    return { error: BIRTHDAY_REMINDER_MESSAGES.notStarted };
  }
  if (claim.state === 'conflict') {
    console.error('[birthday-reminders] The run claim did not match an earlier one', { key: idempotencyKey });
    return { error: BIRTHDAY_REMINDER_MESSAGES.notStarted };
  }
  if (claim.state === 'replay') {
    return { success: true, sent: 0, message: BIRTHDAY_REMINDER_MESSAGES.alreadyDone };
  }
  if (claim.state === 'in_progress') {
    return heldByAnotherRun(supabase, idempotencyKey, requestHash);
  }

  let claimHeld = claim.state === 'claimed';
  // Once the email is handed over it may have gone, so a failure after that point is never
  // reported as "not sent".
  let sendAttempted = false;

  const fail = async (failure: { error: string; uncertain?: boolean }): Promise<BirthdayReminderResult> => {
    // A send that may have gone keeps its claim, so an overlapping run cannot send it again. Until
    // the claim goes stale after ten minutes (STALE_PROCESSING_MS in lib/api/idempotency.ts), a
    // press of the Birthdays button is warned and told when it can send (heldByAnotherRun); after
    // that, someone who has checked with the manager can send it from the page. Any other failure
    // frees the day straight away.
    if (claimHeld && !failure.uncertain) {
      try {
        await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash);
      } catch (releaseError) {
        logFailure('Could not release the run claim', releaseError);
      }
      claimHeld = false;
    }
    return failure.uncertain ? { error: failure.error, uncertain: true } : { error: failure.error };
  };

  // Saves today's answer so a later run is told it is done. A claim left as plain "processing"
  // goes stale after ten minutes and is handed to the next press, which would send a second copy,
  // so a failed save is written again into the claim itself (markIdempotencyClaimCommitted): a
  // later run replays that answer instead of sending, stale or not. Only when both writes fail is
  // the run unrecorded. It still counts as done, because the email went, but a sent reminder is
  // flagged so the cron raises an alert and the page warns the person who pressed.
  const recordRun = async (response: BirthdayReminderSuccess): Promise<BirthdayReminderResult> => {
    claimHeld = false;
    try {
      await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, response, 24 * 3);
      return response;
    } catch (persistError) {
      logFailure('The run finished but its record was not saved', persistError);
    }
    try {
      await markIdempotencyClaimCommitted(supabase, idempotencyKey, requestHash, response);
      return response;
    } catch (markError) {
      logFailure('The run finished but its claim could not be marked done either', markError);
    }
    // A run that sent nothing can safely run again: it finds the same people and sends nothing.
    if (response.sent === 0) return response;
    return {
      ...response,
      unrecorded: true,
      message: `${response.message}, ${BIRTHDAY_REMINDER_MESSAGES.unrecorded}`,
    };
  };

  try {
    // Get all active employees with date of birth
    const { data: employees, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name, job_title, date_of_birth, email_address')
      .in('status', ['Active', 'Started Separation'])
      .not('date_of_birth', 'is', null);

    if (error) {
      logFailure('Could not load employees', error);
      return await fail({ error: BIRTHDAY_REMINDER_MESSAGES.loadFailed });
    }

    if (!employees || employees.length === 0) {
      return await recordRun({ success: true, sent: 0, message: 'No active employees with birthdays found' });
    }

    // Find employees with upcoming birthdays
    const upcomingBirthdays: EmployeeWithBirthday[] = [];

    for (const employee of employees) {
      const birthday = getUpcomingBirthday(employee.date_of_birth, daysAhead);

      if (birthday.isUpcoming && birthday.daysUntil === daysAhead) {
        const age = calculateAge(employee.date_of_birth);
        upcomingBirthdays.push({
          ...employee,
          days_until_birthday: birthday.daysUntil,
          turning_age: (age || 0) + 1 // They'll be turning this age
        });
      }
    }

    if (upcomingBirthdays.length === 0) {
      return await recordRun({
        success: true,
        sent: 0,
        message: `No birthdays exactly ${daysAhead} day${daysAhead === 1 ? '' : 's'} away`
      });
    }

    // Prepare email content
    const emailBody = generateBirthdayReminderEmail(upcomingBirthdays);

    // Send email to manager
    const managerEmail = process.env.MANAGER_EMAIL || 'manager@the-anchor.pub';
    sendAttempted = true;
    const result = await sendEmail({
      to: managerEmail,
      subject: `Birthday Reminder: ${upcomingBirthdays.length} upcoming birthday${upcomingBirthdays.length > 1 ? 's' : ''} next week`,
      html: emailBody,
      text: generatePlainTextEmail(upcomingBirthdays)
    });

    if (!result.success) {
      console.error('[birthday-reminders] The reminder email was not confirmed as sent', {
        code: result.code ?? null,
        message: result.error ?? null,
        uncertain: result.uncertain === true,
      });
      return await fail(
        result.uncertain
          ? { error: BIRTHDAY_REMINDER_MESSAGES.uncertain, uncertain: true }
          : result.code === 'email_suspended'
            ? { error: BIRTHDAY_REMINDER_MESSAGES.suspended }
            : { error: BIRTHDAY_REMINDER_MESSAGES.notSent }
      );
    }

    // Log the action
    await logAuditEvent({
      operation_type: 'send_birthday_reminders',
      resource_type: 'employee',
      operation_status: 'success',
      additional_info: {
        employees_badge: upcomingBirthdays.length,
        sent_to: managerEmail,
        employee_names: upcomingBirthdays.map(e => displayName(e)).join(', ')
      }
    });

    return await recordRun({
      success: true,
      sent: upcomingBirthdays.length,
      message: `Birthday reminder sent for ${upcomingBirthdays.length} employee${upcomingBirthdays.length > 1 ? 's' : ''}`
    });
  } catch (error) {
    logFailure(sendAttempted ? 'Failed after handing the email over' : 'Failed before sending', error);
    return await fail(
      sendAttempted
        ? { error: BIRTHDAY_REMINDER_MESSAGES.uncertain, uncertain: true }
        : { error: BIRTHDAY_REMINDER_MESSAGES.notSent }
    );
  }
}

/**
 * A run found today's claim held by another. That run is sending now, or it handed the email over
 * in the last few minutes without a confirmation and kept the claim on purpose, so that nothing
 * sends it again automatically. Nothing is sent here either. The person is warned it may have
 * gone, to check with the manager, and given the London time the claim goes stale
 * (STALE_PROCESSING_MS), from which the page will send it.
 *
 * A claim carrying the run's answer (recordRun) means the reminder went: that is reported as done.
 */
async function heldByAnotherRun(
  supabase: ReturnType<typeof createAdminClient>,
  idempotencyKey: string,
  requestHash: string
): Promise<BirthdayReminderResult> {
  let claimedAtMs: number | null = null;
  try {
    const current = await lookupIdempotencyKey(supabase, idempotencyKey, requestHash);
    if (current.state === 'replay') {
      const response = current.response as { state?: unknown; claimed_at?: unknown; committed_response?: unknown } | null;
      if (response?.state !== 'processing' || (response.committed_response ?? null) !== null) {
        return { success: true, sent: 0, message: BIRTHDAY_REMINDER_MESSAGES.alreadyDone };
      }
      const parsed = typeof response.claimed_at === 'string' ? Date.parse(response.claimed_at) : NaN;
      claimedAtMs = Number.isFinite(parsed) ? parsed : null;
    }
  } catch (lookupError) {
    logFailure('Could not read the claim held by another run', lookupError);
  }

  // Without the claim's own time, now is the latest it can have been taken, so the time given is
  // never too early. Rounded up to the next whole minute, because HH:mm drops the seconds.
  const staleAtMs = (claimedAtMs ?? Date.now()) + STALE_PROCESSING_MS;
  const sendFrom = new Date((Math.floor(staleAtMs / 60_000) + 1) * 60_000);
  return { warning: BIRTHDAY_REMINDER_MESSAGES.inProgress(formatTimeInLondon(sendFrom)) };
}

/**
 * The day the employee's next birthday falls on, as "Friday 25 September". Counted from today's
 * London date with the same day count that picked them for the reminder, so the email names the
 * day it was sent for (a 29 February birthday falls on 1 March in other years).
 */
function formatUpcomingBirthday(emp: EmployeeWithBirthday): string {
  const birthdayIso = shiftIsoDate(getTodayIsoDate(), emp.days_until_birthday) ?? getTodayIsoDate();
  return formatDateInLondon(birthdayIso, { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * The HTML body. Names and job titles are typed by staff, so they are escaped: they went into
 * the markup raw before 2 November 2026.
 */
function generateBirthdayReminderEmail(birthdays: EmployeeWithBirthday[]): string {
  const birthdayList = birthdays
    .map(emp => {
      return `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid ${STAFF.border};">
            <strong>${escapeHtml(displayName(emp))}</strong><br>
            <span style="color: ${STAFF.textMuted}; font-size: 14px;">${escapeHtml(emp.job_title || 'No title')}</span>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid ${STAFF.border}; text-align: center;">
            ${formatUpcomingBirthday(emp)}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid ${STAFF.border}; text-align: center;">
            Turning ${emp.turning_age}
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Birthday Reminder</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: ${STAFF.bg};">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: ${STAFF.surface}; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); padding: 32px;">
          <h1 style="color: ${STAFF.text}; font-size: 24px; margin-top: 0;">🎂 Upcoming Birthday Reminder</h1>

          <p style="color: ${STAFF.textMuted}; margin: 20px 0;">
            The following employee${birthdays.length > 1 ? 's have birthdays' : ' has a birthday'} coming up next week:
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: ${STAFF.surfaceHover};">
                <th style="padding: 12px; text-align: left; font-weight: 600; color: ${STAFF.text};">Employee</th>
                <th style="padding: 12px; text-align: center; font-weight: 600; color: ${STAFF.text};">Birthday</th>
                <th style="padding: 12px; text-align: center; font-weight: 600; color: ${STAFF.text};">Age</th>
              </tr>
            </thead>
            <tbody>
              ${birthdayList}
            </tbody>
          </table>

          <div style="margin-top: 32px; padding: 16px; background-color: ${STAFF.warningSoft}; border-radius: 6px;">
            <p style="margin: 0; color: ${STAFF.warningFg}; font-size: 14px;">
              <strong>Reminder:</strong> Consider organizing a celebration or sending a birthday card to make their day special!
            </p>
          </div>

          <hr style="margin: 32px 0; border: none; border-top: 1px solid ${STAFF.border};">

          <p style="color: ${STAFF.textMuted}; font-size: 12px; margin: 0;">
            This is an automated reminder from The Anchor Management System.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generatePlainTextEmail(birthdays: EmployeeWithBirthday[]): string {
  let text = `Birthday Reminder\n\n`;
  text += `The following employee${birthdays.length > 1 ? 's have birthdays' : ' has a birthday'} coming up next week:\n\n`;

  birthdays.forEach(emp => {
    text += `• ${displayName(emp)} (${emp.job_title || 'No title'})\n`;
    text += `  Birthday: ${formatUpcomingBirthday(emp)}\n`;
    text += `  Turning: ${emp.turning_age}\n\n`;
  });

  text += `\nReminder: Consider organizing a celebration or sending a birthday card to make their day special!\n\n`;
  text += `--\nThis is an automated reminder from The Anchor Management System.`;

  return text;
}
