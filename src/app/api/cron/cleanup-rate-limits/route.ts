import { NextResponse } from 'next/server';
import { cleanupRateLimits } from '@/lib/rate-limiter';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteExpiredIdempotencyKeys } from '@/lib/api/idempotency';

// Its own time limit rather than the 15-second project default (BK-212).
export const maxDuration = 60;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
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
    const expiredIdempotencyKeysDeleted = await deleteExpiredIdempotencyKeys(createAdminClient());

    logger.info('Rate limit cleanup completed successfully', {
      metadata: { expiredIdempotencyKeysDeleted },
    });

    return new NextResponse(
      JSON.stringify({
        success: true,
        message: 'Rate limit cleanup completed',
        expired_idempotency_keys_deleted: expiredIdempotencyKeysDeleted,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    logger.error('Error cleaning up rate limits and expired idempotency keys', {
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
