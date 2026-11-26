import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { nextSeriesOccurrence, resolveSeriesOccurrences } from '@/lib/events/series'
import { loadEventSeries, loadSeriesClosedDays } from '@/lib/events/series-data'
import { logger } from '@/lib/logger'

/** The occurrences window the website gets: the next 8 weeks. */
const WINDOW_DAYS = 56
/** How far ahead "next occurrence" may look (a run with a long gap still has a next date). */
const NEXT_HORIZON_DAYS = 400

/**
 * Repeating events for the website (spec docs/superpowers/specs/2026-11-26-repeating-events.md,
 * section 9). API key with read:events, like the other event routes.
 *
 * Only active series with a date still to come. Skipped dates are the ones the website may name
 * ("no darts night on Thursday 24 December"): skipped by hand or the pub closed. A date made into a
 * full event is left out, because that event shows in its own right.
 */
export async function GET(request: NextRequest) {
  return withApiAuth(async () => {
    try {
      const db = createAdminClient()
      const now = new Date()
      const today = getTodayIsoDate()
      const windowEnd = shiftIsoDate(today, WINDOW_DAYS - 1) ?? today
      const horizon = shiftIsoDate(today, NEXT_HORIZON_DAYS) ?? today

      const [series, closedDays] = await Promise.all([
        loadEventSeries(db, { statuses: ['active'] }),
        loadSeriesClosedDays(db, today, horizon),
      ])

      const payload = []
      for (const s of series) {
        const next = nextSeriesOccurrence(s, s.skips, closedDays, now, NEXT_HORIZON_DAYS)
        if (!next) continue

        const { occurrences, skipped } = resolveSeriesOccurrences(s, s.skips, closedDays, today, windowEnd)
        payload.push({
          id: s.id,
          slug: s.slug,
          name: s.name,
          weekday: s.weekday,
          startTime: s.startTime,
          endTime: s.endTime,
          shortDescription: s.shortDescription,
          pagePath: s.pagePath,
          isFree: s.isFree,
          audienceNote: s.audienceNote,
          startsOn: s.startsOn,
          endsOn: s.endsOn,
          nextOccurrence: next,
          occurrences: occurrences.filter((o) => new Date(o.endsAt).getTime() > now.getTime()),
          skippedDates: skipped
            .filter((skip) => skip.kind !== 'replaced')
            .map((skip) => ({ date: skip.date, kind: skip.kind })),
        })
      }

      return createApiResponse({
        series: payload,
        meta: { total: payload.length, windowStart: today, windowEnd, lastUpdated: now.toISOString() },
      })
    } catch (error) {
      logger.error('Failed to load repeating events for the API', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return createErrorResponse('Failed to fetch repeating events', 'DATABASE_ERROR', 500)
    }
  }, ['read:events'], request)
}

export async function OPTIONS() {
  return createApiResponse({}, 200)
}
