// The maintenance nav badge: what it counts, and how to clear its cache.
//
// A nav pill is a to-do list, so this counts only work a super-admin can act on
// now: an open item that is already overdue, or one falling due within the next
// seven days. An item with no target date is deliberately excluded, because
// nothing about it says today is the day to deal with it, and a badge that can
// never be worked down to zero teaches people to ignore every badge.
//
// Overdue and due-soon fold into a single comparison (target_date <= cutoff), so
// the list, the badge and the weekly email cannot drift apart over a boundary.

import { revalidateTag } from 'next/cache'
import { getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { isOpenMaintenanceStatus, type MaintenanceStatus } from '@/types/maintenance'

/** Overdue, plus this many days ahead. Seven days is one planning week. */
export const MAINTENANCE_DUE_SOON_DAYS = 7

/**
 * The latest target date the badge counts, as a London ISO date.
 *
 * Anything on or before this counts, so an item overdue by a year and one due in
 * seven days are both in, and one due in eight days is out. Due today is in and
 * is not overdue; that distinction belongs to the list, not to this count.
 */
export function maintenanceDueSoonCutoff(todayIsoDate: string = getTodayIsoDate()): string {
  const cutoff = shiftIsoDate(todayIsoDate, MAINTENANCE_DUE_SOON_DAYS)
  if (cutoff === null) {
    throw new Error(`maintenanceDueSoonCutoff needs a yyyy-mm-dd date, got: ${todayIsoDate}`)
  }
  return cutoff
}

/**
 * The badge predicate, pure so the boundaries can be tested without a database.
 * The query in getOutstandingCounts must stay equivalent to this.
 */
export function countsTowardsMaintenanceBadge(
  item: { status: MaintenanceStatus; targetDate: string | null },
  todayIsoDate: string = getTodayIsoDate()
): boolean {
  if (!isOpenMaintenanceStatus(item.status)) return false
  if (!item.targetDate) return false
  return item.targetDate <= maintenanceDueSoonCutoff(todayIsoDate)
}

/**
 * Clears the shared outstanding-counts cache so the badge reflects a maintenance
 * change straight away rather than after the 90 second window.
 *
 * Call this from every maintenance mutation. It is exported from here, rather
 * than inlined, so the tags stay in one place: they must match the tags on the
 * unstable_cache entry in src/actions/get-outstanding-counts.ts.
 */
export function revalidateMaintenanceCounts(): void {
  revalidateTag('outstanding-counts')
  revalidateTag('dashboard')
}
