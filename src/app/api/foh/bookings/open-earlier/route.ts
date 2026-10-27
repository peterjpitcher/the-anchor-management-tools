import { NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTradingDayNow } from '@/lib/business-hours/trading-day'
import { loadOpenEarlierTableBookings } from '@/lib/table-bookings/open-outcomes'
import { logger } from '@/lib/logger'

/**
 * Table bookings from the last seven days that nobody marked as arrived, left or no-show (BK-130).
 * The FOH and BOH 'Still open from earlier' strip reads this.
 */
export async function GET() {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  try {
    // The day the floor is working: the night before, until an after-midnight close.
    const tradingDay = (await resolveTradingDayNow(createAdminClient())).date
    const bookings = await loadOpenEarlierTableBookings(auth.supabase, tradingDay)
    return NextResponse.json({ success: true, data: { tradingDay, bookings } })
  } catch (error) {
    logger.error('Failed to load table bookings still open from earlier days', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Failed to load bookings still open from earlier.' }, { status: 500 })
  }
}
