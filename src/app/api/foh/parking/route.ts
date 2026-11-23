import { NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { resolveTradingDayNow } from '@/lib/business-hours/trading-day'
import { loadFohParkingView } from '@/lib/foh/parking-view'
import { logger } from '@/lib/logger'

/**
 * Parking for the till: who is arriving, on site and leaving today, and what is coming up in the
 * next 14 days. Read only. Gated like the FOH schedule (table_bookings view), because the shared
 * FOH login holds no parking permission and must not be given one. It returns no price, rate,
 * amount or payment record: only whether each booking is paid.
 */
export async function GET() {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  try {
    // The day being worked: the night before, until an after-midnight close.
    const tradingDay = (await resolveTradingDayNow(auth.supabase)).date
    const view = await loadFohParkingView(auth.supabase, tradingDay)
    return NextResponse.json({ success: true, data: view })
  } catch (error) {
    logger.error('FOH parking view could not be loaded', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Parking could not be loaded.' }, { status: 500 })
  }
}
