import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

// Vercel Cron: runs at 06:00 UTC daily (cron: "0 6 * * *")
// Cancels draft private bookings whose hold_expiry has passed.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // Fetch IDs of expired draft bookings so we can log the count before updating.
  const { data: expired, error: fetchError } = await supabase
    .from('private_bookings')
    .select('id')
    .eq('status', 'draft')
    .not('hold_expiry', 'is', null)
    .lt('hold_expiry', now);

  if (fetchError) {
    logger.error('private-bookings-expire-holds: fetch failed', {
      error: new Error(fetchError.message),
      metadata: { message: fetchError.message },
    });
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const ids = (expired ?? []).map((r) => r.id);

  if (ids.length === 0) {
    logger.info('private-bookings-expire-holds: no expired holds found');
    return NextResponse.json({ ok: true, cancelled: 0 });
  }

  const { error: updateError } = await supabase
    .from('private_bookings')
    .update({
      status: 'cancelled',
      cancellation_reason: 'Hold expired automatically',
    })
    .in('id', ids);

  if (updateError) {
    logger.error('private-bookings-expire-holds: update failed', {
      error: new Error(updateError.message),
      metadata: { message: updateError.message, ids },
    });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  logger.info('private-bookings-expire-holds: cancelled expired holds', { metadata: { count: ids.length, ids } });

  return NextResponse.json({ ok: true, cancelled: ids.length });
}
