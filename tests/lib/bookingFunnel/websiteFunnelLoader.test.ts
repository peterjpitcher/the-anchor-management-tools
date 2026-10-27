import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { loadWebsiteBookingFunnel } from '@/lib/analytics/website-booking-funnel'

describe('loadWebsiteBookingFunnel (BK-097)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the weekly funnel through the service-role function and maps it', async () => {
    const db = createFakeDb()
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    db.onRpc((name, args) => {
      calls.push({ name, args })
      return {
        data: [{ week_start: '2026-10-26', date_checks: 40, searches: '31', no_tables: 4, could_not_check: 2, refused: 3, failed: 1, bookings: 6 }],
        error: null,
      }
    })
    ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)

    const result = await loadWebsiteBookingFunnel(6)

    expect(calls).toEqual([{ name: 'website_booking_funnel', args: { p_weeks: 6 } }])
    expect(result).toEqual({
      weeks: [{ weekStart: '2026-10-26', dateChecks: 40, searches: 31, noTables: 4, couldNotCheck: 2, refused: 3, failed: 1, bookings: 6 }],
      error: null,
    })
  })

  it('returns an error to show, not zeros, when the function fails', async () => {
    const db = createFakeDb()
    db.onRpc(() => ({ data: null, error: { message: 'function website_booking_funnel does not exist' } }))
    ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)

    expect(await loadWebsiteBookingFunnel()).toEqual({ weeks: [], error: 'The website funnel could not be loaded.' })
  })
})
