import { describe, expect, it, vi } from 'vitest'

// revalidateTag is a Next.js server function; the module imports it at the top
// level, so it has to exist even for the pure helpers below.
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

import {
  MAINTENANCE_DUE_SOON_DAYS,
  countsTowardsMaintenanceBadge,
  maintenanceDueSoonCutoff,
} from '@/lib/maintenance/counts'
import type { MaintenanceStatus } from '@/types/maintenance'

const TODAY = '2026-08-17'

function item(status: MaintenanceStatus, targetDate: string | null) {
  return { status, targetDate }
}

describe('maintenanceDueSoonCutoff', () => {
  it('is today plus seven days', () => {
    expect(MAINTENANCE_DUE_SOON_DAYS).toBe(7)
    expect(maintenanceDueSoonCutoff(TODAY)).toBe('2026-08-24')
  })

  it('crosses a month end without slipping', () => {
    expect(maintenanceDueSoonCutoff('2026-08-28')).toBe('2026-09-04')
  })

  it('crosses the end of British Summer Time without losing or gaining a day', () => {
    // The clocks go back on 2026-10-25. Anchored in UTC, so seven days is seven
    // calendar days whichever side of the change the run happens on.
    expect(maintenanceDueSoonCutoff('2026-10-22')).toBe('2026-10-29')
    expect(maintenanceDueSoonCutoff('2026-10-25')).toBe('2026-11-01')
  })

  it('crosses the start of British Summer Time without slipping', () => {
    // The clocks go forward on 2026-03-29.
    expect(maintenanceDueSoonCutoff('2026-03-26')).toBe('2026-04-02')
  })
})

describe('countsTowardsMaintenanceBadge', () => {
  it('counts an overdue item', () => {
    expect(countsTowardsMaintenanceBadge(item('reported', '2026-08-16'), TODAY)).toBe(true)
    expect(countsTowardsMaintenanceBadge(item('reported', '2025-01-01'), TODAY)).toBe(true)
  })

  it('counts an item due today', () => {
    // Due today is not overdue, but it is certainly work for today, so it counts.
    expect(countsTowardsMaintenanceBadge(item('reported', TODAY), TODAY)).toBe(true)
  })

  it('counts the last day of the seven day window and stops the day after', () => {
    expect(countsTowardsMaintenanceBadge(item('scheduled', '2026-08-24'), TODAY)).toBe(true)
    expect(countsTowardsMaintenanceBadge(item('scheduled', '2026-08-25'), TODAY)).toBe(false)
  })

  it('ignores an item with no target date', () => {
    // Nothing about an undated item says today is the day to deal with it, and a
    // badge that can never be worked down to zero teaches people to ignore badges.
    expect(countsTowardsMaintenanceBadge(item('reported', null), TODAY)).toBe(false)
  })

  it('counts every open status, on_hold included', () => {
    const open: MaintenanceStatus[] = [
      'reported',
      'quoting',
      'awaiting_landlord',
      'scheduled',
      'in_progress',
      'on_hold',
    ]
    for (const status of open) {
      expect(countsTowardsMaintenanceBadge(item(status, TODAY), TODAY), status).toBe(true)
    }
  })

  it('ignores done and cancelled items however overdue they were', () => {
    expect(countsTowardsMaintenanceBadge(item('done', '2025-01-01'), TODAY)).toBe(false)
    expect(countsTowardsMaintenanceBadge(item('cancelled', '2025-01-01'), TODAY)).toBe(false)
  })
})
