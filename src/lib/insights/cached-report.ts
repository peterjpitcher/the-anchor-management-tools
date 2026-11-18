import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildWeeklyInsights } from './registry'
import type { InsightsReport } from './types'

/**
 * The Insights page's report, cached for five minutes (owner decision, 18 November 2026).
 *
 * One entry is shared by every viewer. That is safe because the page is for super admins only
 * (`currentUserCanViewInsights`, checked by the caller before this runs) and the report is
 * built with the admin client with no per-viewer filtering, so every viewer would see the same
 * figures anyway.
 *
 * Only the page uses this. The Friday email (`src/lib/manager-report/delivery.ts`) still builds
 * its own report from live data every time.
 */

export const INSIGHTS_REPORT_CACHE_TAG = 'insights-report'
export const INSIGHTS_REPORT_TTL_SECONDS = 300

/**
 * Thrown inside the cached function so a report with a section that was not checked (a timeout
 * or a failed read) is never stored: the next load retries it, as a reload did before the cache.
 * It carries nothing; the report goes back through a closure so it is never logged.
 */
class UncachedReport extends Error {
  constructor() {
    super('Insights report not cached: a section was not checked')
    this.name = 'UncachedReport'
  }
}

/**
 * Returns the report and keeps it for up to five minutes. `unstable_cache` serves an expired
 * entry straight away and rebuilds it in the background, which would show an hours-old report
 * after a quiet spell, so the key also carries the current five-minute slot of the clock: a new
 * slot is a new entry, built while the viewer waits. Figures are therefore never more than five
 * minutes old. "Refresh now" clears the tag, which drops every entry at once.
 *
 * The report is plain JSON (`generatedAt` is an ISO string), so the cache's JSON round trip
 * returns exactly what was built.
 */
export async function getCachedInsightsReport(appUrl: string): Promise<InsightsReport> {
  const slot = Math.floor(Date.now() / (INSIGHTS_REPORT_TTL_SECONDS * 1000))
  const held: { report: InsightsReport | null } = { report: null }
  const cached = unstable_cache(
    async (): Promise<InsightsReport> => {
      const report = await buildWeeklyInsights({
        createDb: (signal) => createAdminClient({ signal }),
        now: new Date(),
        appUrl,
      })
      if (report.notChecked.length > 0) {
        held.report = report
        throw new UncachedReport()
      }
      return report
    },
    ['insights-report', appUrl, String(slot)],
    { revalidate: INSIGHTS_REPORT_TTL_SECONDS, tags: [INSIGHTS_REPORT_CACHE_TAG] },
  )
  try {
    return await cached()
  } catch (error) {
    if (error instanceof UncachedReport && held.report) return held.report
    throw error
  }
}
