'use server'

import { revalidateTag } from 'next/cache'
import { currentUserCanViewInsights } from '@/lib/insights/access'
import { INSIGHTS_REPORT_CACHE_TAG } from '@/lib/insights/cached-report'

/**
 * "Refresh now" on the Insights page: drops the cached report so the next render rebuilds it
 * from live data. Reads nothing and writes no records; it only clears the five-minute cache.
 * Same check as the page (super admins only); anyone else is refused and the cache is left alone.
 */
export async function refreshInsightsReport(): Promise<{ success?: boolean; error?: string }> {
  if (!(await currentUserCanViewInsights())) {
    throw new Error('Insufficient permissions')
  }
  revalidateTag(INSIGHTS_REPORT_CACHE_TAG)
  return { success: true }
}
