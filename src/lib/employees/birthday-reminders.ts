import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/emailService';
import { escapeHtml } from '@/lib/email/escape-html';
import { getUpcomingBirthday, calculateAge } from '@/lib/employeeUtils';
import { displayName } from '@/lib/employees/display-name';
import { formatDateInLondon, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils';
import { STAFF } from '@/lib/brand/palette';
import { logAuditEvent } from '@/app/actions/audit';
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
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
  | { success: true; sent: number; message: string; error?: undefined }
  | { error: string; success?: undefined; sent?: undefined; message?: undefined };

export async function sendBirthdayRemindersInternal(daysAhead: number = 7): Promise<BirthdayReminderResult> {
  const supabase = createAdminClient();
  const runDateKey = getTodayIsoDate();
  const idempotencyKey = `cron:employee-birthday-reminder:${runDateKey}:${daysAhead}`;
  const requestHash = computeIdempotencyRequestHash({
    run_date: runDateKey,
    days_ahead: daysAhead
  });

  const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash, 24 * 3);
  if (claim.state === 'conflict') {
    return { error: 'Birthday reminder idempotency conflict' };
  }
  if (claim.state === 'in_progress' || claim.state === 'replay') {
    return {
      success: true,
      sent: 0,
      message: `Birthday reminders already processed for ${runDateKey}`
    };
  }

  let claimHeld = claim.state === 'claimed';

  try {
    // Get all active employees with date of birth
    const { data: employees, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name, job_title, date_of_birth, email_address')
      .in('status', ['Active', 'Started Separation'])
      .not('date_of_birth', 'is', null);

    if (error) {
      console.error('Error fetching employees:', error);
      throw new Error('Failed to fetch employees');
    }

    if (!employees || employees.length === 0) {
      const response = { success: true as const, sent: 0, message: 'No active employees with birthdays found' };
      await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, response, 24 * 3);
      claimHeld = false;
      return response;
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
      const response = {
        success: true as const,
        sent: 0,
        message: `No birthdays exactly ${daysAhead} day${daysAhead === 1 ? '' : 's'} away`
      };
      await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, response, 24 * 3);
      claimHeld = false;
      return response;
    }

    // Prepare email content
    const emailBody = generateBirthdayReminderEmail(upcomingBirthdays);

    // Send email to manager
    const managerEmail = process.env.MANAGER_EMAIL || 'manager@the-anchor.pub';
    const result = await sendEmail({
      to: managerEmail,
      subject: `Birthday Reminder: ${upcomingBirthdays.length} upcoming birthday${upcomingBirthdays.length > 1 ? 's' : ''} next week`,
      html: emailBody,
      text: generatePlainTextEmail(upcomingBirthdays)
    });

    if (!result.success) {
      throw new Error('Failed to send birthday reminder email');
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

    const response = {
      success: true as const,
      sent: upcomingBirthdays.length,
      message: `Birthday reminder sent for ${upcomingBirthdays.length} employee${upcomingBirthdays.length > 1 ? 's' : ''}`
    };
    await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, response, 24 * 3);
    claimHeld = false;
    return response;
  } catch (error) {
    if (claimHeld) {
      try {
        await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash);
      } catch (releaseError) {
        console.error('Failed to release birthday reminder idempotency claim:', releaseError);
      }
    }

    console.error('Error sending birthday reminders:', error);
    return { error: error instanceof Error ? error.message : 'An unexpected error occurred' };
  }
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
