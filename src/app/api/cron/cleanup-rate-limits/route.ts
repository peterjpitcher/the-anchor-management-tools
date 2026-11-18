import { NextResponse } from 'next/server';
import { cleanupRateLimits } from '@/lib/rate-limiter';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteExpiredIdempotencyKeys } from '@/lib/api/idempotency';
import { deleteOldCronJobRuns } from '@/lib/cron/cron-run-retention';

// Its own time limit rather than the 15-second project default (BK-212).
export const maxDuration = 60;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The cron run retention step stops between requests once this much of maxDuration has gone,
// leaving room to answer; anything left is deleted by the next night's run.
const RETENTION_BUDGET_MS = 40_000;

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authResult = authorizeCronRequest(request);

    if (!authResult.authorized) {
      console.error('Unauthorized request - invalid cron credentials', authResult.reason);
      return new NextResponse('Unauthorized', { status: 401 });
    }

    logger.info('Starting rate limit cleanup');

    // Clean up old rate limit entries
    await cleanupRateLimits();

    // Stored booking answers past their expiry (BK-189). Every reader already treats an expired
    // row as new, so this changes nothing a guest sees; it stops the table growing for ever.
    const supabase = createAdminClient();
    const expiredIdempotencyKeysDeleted = await deleteExpiredIdempotencyKeys(supabase);

    // cron_job_runs rows older than 90 days for three log-only jobs (spec D3, owner approval
    // 18 November 2026). The allowlist and the rules live in cron-run-retention.ts.
    const cronRunRetention = await deleteOldCronJobRuns(supabase, {
      deadlineMs: startedAtMs + RETENTION_BUDGET_MS,
    });

    logger.info('Rate limit cleanup completed successfully', {
      metadata: {
        expiredIdempotencyKeysDeleted,
        oldCronRunsDeleted: cronRunRetention.deleted,
        oldCronRunsComplete: cronRunRetention.complete,
        oldCronRunsCutoff: cronRunRetention.cutoff,
      },
    });

    return new NextResponse(
      JSON.stringify({
        success: true,
        message: 'Rate limit cleanup completed',
        expired_idempotency_keys_deleted: expiredIdempotencyKeysDeleted,
        old_cron_runs_deleted: cronRunRetention.deleted,
        old_cron_runs_complete: cronRunRetention.complete,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    logger.error('Error cleaning up rate limits, expired idempotency keys and old cron run records', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
