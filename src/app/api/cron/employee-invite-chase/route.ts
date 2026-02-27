import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendChaseEmail } from '@/lib/email/employee-invite-emails';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://manage.the-anchor.pub';

function buildOnboardingUrl(token: string): string {
  return `${BASE_URL}/onboarding/${token}`;
}

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
    errors: [] as string[],
  };

  try {
    // Fetch all pending tokens
    const { data: tokens, error: fetchError } = await supabase
      .from('employee_invite_tokens')
      .select('id, token, email, created_at, day3_chase_sent_at, day6_chase_sent_at')
      .is('completed_at', null)
      .gt('expires_at', nowIso);

    if (fetchError) {
      throw fetchError;
    }

    for (const row of tokens ?? []) {
      const createdAt = row.created_at;

      // Day 3 chase
      if (!row.day3_chase_sent_at && createdAt <= day3Threshold) {
        try {
          await sendChaseEmail(row.email, buildOnboardingUrl(row.token), 3);
          await supabase
            .from('employee_invite_tokens')
            .update({ day3_chase_sent_at: nowIso })
            .eq('id', row.id);
          result.day3ChasesSent++;
        } catch (emailError: any) {
          result.errors.push(`Day 3 chase failed for ${row.email}: ${emailError.message}`);
        }
        continue; // Don't also send day 6 in the same run
      }

      // Day 6 chase
      if (!row.day6_chase_sent_at && createdAt <= day6Threshold) {
        try {
          await sendChaseEmail(row.email, buildOnboardingUrl(row.token), 6);
          await supabase
            .from('employee_invite_tokens')
            .update({ day6_chase_sent_at: nowIso })
            .eq('id', row.id);
          result.day6ChasesSent++;
        } catch (emailError: any) {
          result.errors.push(`Day 6 chase failed for ${row.email}: ${emailError.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      ...result,
      processedAt: nowIso,
    });
  } catch (error: any) {
    console.error('[employee-invite-chase] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process employee invite chase' },
      { status: 500 }
    );
  }
}
