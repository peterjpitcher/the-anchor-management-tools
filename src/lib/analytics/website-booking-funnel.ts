import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { Database } from '@/types/database.generated'

type FunnelRow = Database['public']['Functions']['website_booking_funnel']['Returns'][number]

/**
 * The weekly website table booking funnel (BK-097, customer bookings review of 24 October 2026).
 *
 * Website table bookings halved in October and the logs could not say whether that was fewer
 * visitors, "no tables" answers or a broken step. This reads website_booking_funnel, which
 * counts per London week: date checks (the booking form asking which period a date falls in),
 * searches (one availability answer per guest search), searches with no tables, searches that
 * could not be checked, refusals and failures on the table booking route, and bookings made on
 * the website. Only calls made with a key that can create bookings count, so a read-only test
 * or preview key is left out (BK-193). Server only: the counts come from service-role tables.
 */

export type WebsiteFunnelWeek = {
  weekStart: string
  dateChecks: number
  searches: number
  noTables: number
  couldNotCheck: number
  refused: number
  failed: number
  bookings: number
}

export type WebsiteFunnelResult = { weeks: WebsiteFunnelWeek[]; error: string | null }

function toCount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

export async function loadWebsiteBookingFunnel(weeks = 8): Promise<WebsiteFunnelResult> {
  try {
    const { data, error } = await createAdminClient().rpc('website_booking_funnel', { p_weeks: weeks })
    if (error) throw new Error(error.message)
    return {
      weeks: ((data ?? []) as FunnelRow[]).map((row) => ({
        weekStart: row.week_start,
        dateChecks: toCount(row.date_checks),
        searches: toCount(row.searches),
        noTables: toCount(row.no_tables),
        couldNotCheck: toCount(row.could_not_check),
        refused: toCount(row.refused),
        failed: toCount(row.failed),
        bookings: toCount(row.bookings),
      })),
      error: null,
    }
  } catch (error) {
    logger.error('Could not load the website booking funnel', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { weeks: [], error: 'The website funnel could not be loaded.' }
  }
}
