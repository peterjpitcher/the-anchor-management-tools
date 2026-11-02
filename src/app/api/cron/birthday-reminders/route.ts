import { NextRequest, NextResponse } from 'next/server';
import { sendBirthdayRemindersInternal } from '@/lib/employees/birthday-reminders';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { reportCronFailure } from '@/lib/cron/alerting';
import { logger } from '@/lib/logger';

// Its own time limit rather than the 15-second project default (BK-212).
export const maxDuration = 60;

const NOT_SENT_OUTCOME =
  "The manager did not get this morning's birthday reminder. Tomorrow's run looks for birthdays exactly 7 days away, so anyone due a reminder today will not get one unless it is sent from the Birthdays page today.";
const MAY_HAVE_GONE_OUTCOME =
  "This morning's birthday reminder may have reached the manager, but the email service did not confirm it. Check with the manager before sending it again from the Birthdays page.";
const STOPPED_OUTCOME =
  "The birthday reminder job stopped part way. Check with the manager whether this morning's reminder arrived, and if not, send it from the Birthdays page today.";
const UNRECORDED_OUTCOME =
  "This morning's birthday reminder went to the manager, but the app could not record that it went. Do not send it again from the Birthdays page today, or the manager will get a second copy.";

/**
 * Emails CRON_ALERT_EMAIL about a run that went wrong, only then: a quiet day sends nothing.
 * A reminder that fails is lost for good (Vercel does not retry, and tomorrow's run looks for
 * birthdays exactly 7 days away, which today's people no longer are), and a 500 nobody reads
 * looked exactly like a day with no birthdays.
 */
async function alertBirthdayReminderFailure(error: unknown, outcome: string): Promise<void> {
  try {
    await reportCronFailure('birthday-reminders', error, { outcome });
  } catch (alertError) {
    console.error('[birthday-reminders] Failed to raise the failure alert:', alertError);
  }
}

export async function GET(request: NextRequest) {
  // Verify this is coming from Vercel Cron (in production)
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Send birthday reminders for employees with birthdays exactly 7 days away
    const result = await sendBirthdayRemindersInternal(7);

    if (result.error) {
      console.error('[birthday-reminders] Run failed:', result.error);
      await alertBirthdayReminderFailure(
        new Error(result.error),
        result.uncertain ? MAY_HAVE_GONE_OUTCOME : NOT_SENT_OUTCOME,
      );
      return NextResponse.json(
        { error: result.error, uncertain: result.uncertain === true },
        { status: 500 }
      );
    }

    if (result.warning) {
      // Another run holds today's reminder: it is being sent now, or it may have gone a few
      // minutes ago and kept its claim on purpose. This run sends nothing and raises no alert: a
      // send that may have gone raised its own alert, or warned the person who pressed.
      console.warn("[birthday-reminders] Another run holds today's reminder; nothing sent");
      return NextResponse.json({ success: true, sent: 0, skipped: true, message: result.warning });
    }

    if (result.unrecorded) {
      // Sent, so not a failed run, but a press of the Birthdays button later today would send a
      // second copy, and only an alert tells anyone not to.
      console.error('[birthday-reminders] Sent, but the run could not be recorded');
      await alertBirthdayReminderFailure(
        new Error('The birthday reminder was sent, but the app could not record that it went.'),
        UNRECORDED_OUTCOME,
      );
    }

    logger.info('Birthday reminders sent', {
      metadata: { sent: result.sent },
    });

    return NextResponse.json({
      success: true,
      sent: result.sent,
      message: result.message,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[birthday-reminders] Cron error:', error);
    await alertBirthdayReminderFailure(error, STOPPED_OUTCOME);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
