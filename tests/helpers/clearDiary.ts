import { vi } from 'vitest'
import type * as Conflicts from '@/services/private-bookings/conflicts'
import type * as NightClashes from '@/services/private-bookings/night-clashes'

/**
 * A diary with nothing else in it: no other private hire in the rooms, and no diners, event
 * places or events that night. For tests about something else, now that the clash check fails
 * closed (review BK-070) instead of quietly letting a save through when it cannot read the diary.
 *
 *   vi.mock('@/services/private-bookings/conflicts', async (importOriginal) =>
 *     (await import('../helpers/clearDiary')).clearDiaryConflicts(importOriginal))
 *   vi.mock('@/services/private-bookings/night-clashes', async (importOriginal) =>
 *     (await import('../helpers/clearDiary')).clearDiaryNight(importOriginal))
 *
 * The checks themselves are tested in tests/services/privateHireNightClashes.test.ts and
 * src/services/private-bookings/__tests__/conflicts.test.ts.
 */
export async function clearDiaryConflicts(importOriginal: () => Promise<unknown>): Promise<typeof Conflicts> {
  const actual = (await importOriginal()) as typeof Conflicts
  return {
    ...actual,
    findBookingConflicts: vi.fn(async () => []),
    getBookingConflictSummary: vi.fn(async () => []),
    getBookingSpaceIds: vi.fn(async () => []),
  }
}

export async function clearDiaryNight(importOriginal: () => Promise<unknown>): Promise<typeof NightClashes> {
  const actual = (await importOriginal()) as typeof NightClashes
  return {
    ...actual,
    hireNightWarning: vi.fn(async () => null),
  }
}
