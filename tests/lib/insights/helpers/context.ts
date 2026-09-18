import { createSectionContext } from '@/lib/insights/engine'
import { computeWindows } from '@/lib/insights/windows'
import type { SectionContext } from '@/lib/insights/types'
import type { FakeDb } from './fake-db'

export const TEST_APP_URL = 'https://management.example.test'

/**
 * A section context over a fake database. `now` defaults to Friday 25 September 2026 at
 * 06:00 London (05:00 UTC), the first Friday the new report would send.
 */
export function makeContext(db: FakeDb, now: Date = new Date('2026-09-25T05:00:00Z')): SectionContext {
  return createSectionContext(db.asDb(), now, computeWindows(now), new AbortController().signal, new URL(TEST_APP_URL).origin)
}
