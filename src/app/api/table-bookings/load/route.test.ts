import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The route reads the purpose-aware booking rows directly via the admin client:
// from('table_bookings').select(...).eq('booking_date', date) -> { data, error }.
const kitchenRowsResult = { data: [] as unknown[], error: null as unknown }
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve(kitchenRowsResult)),
      })),
    })),
  })),
}))

// Keep createApiResponse / createErrorResponse real; only bypass the API-key layer.
vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn(
      (
        handler: (req: Request, apiKey: { id: string }) => Promise<Response>,
        _scopes: string[],
        req: Request
      ) => handler(req, { id: 'test-key' })
    ),
  }
})

vi.mock('@/lib/table-bookings/load', () => ({
  getBookingLoadForDate: vi.fn(),
  getPacingSettings: vi.fn(),
  toPublicPacingSettings: vi.fn((s) => ({
    busy_threshold_covers: s.busyThresholdCovers,
    filling_threshold_covers: s.fillingThresholdCovers,
    window_minutes: s.windowMinutes,
  })),
}))

vi.mock('@/lib/table-bookings/kitchen-pacing', () => ({
  getKitchenPacingSettings: vi.fn(),
  getKitchenPacingOverrideForDate: vi.fn(),
  resolveKitchenCeiling: vi.fn(),
  buildKitchenAvailabilitySlots: vi.fn(),
  isSundayDate: vi.fn(),
}))

vi.mock('@/services/business-hours', () => ({
  getKitchenWindowForDate: vi.fn(),
}))

import { GET } from './route'
import { withApiAuth } from '@/lib/api/auth'
import {
  getBookingLoadForDate,
  getPacingSettings,
} from '@/lib/table-bookings/load'
import {
  buildKitchenAvailabilitySlots,
  getKitchenPacingOverrideForDate,
  getKitchenPacingSettings,
  isSundayDate,
  resolveKitchenCeiling,
} from '@/lib/table-bookings/kitchen-pacing'
import { getKitchenWindowForDate } from '@/services/business-hours'

const PACING_SETTINGS = {
  busyThresholdCovers: 30,
  fillingThresholdCovers: 20,
  windowMinutes: 60,
}

const KITCHEN_SETTINGS = {
  enabled: true,
  windowMinutes: 30,
  paceCoversRegular: 25,
  paceCoversSunday: 20,
  walkInReserveRegular: 6,
  walkInReserveSunday: 6,
}

const BOOKINGS = [{ time: '19:00', covers: 4 }]
const SLOTS = [
  { time: '18:00', covers: 0, remaining: 19 },
  { time: '18:15', covers: 0, remaining: 19 },
  { time: '18:30', covers: 10, remaining: 9 },
]

function makeRequest(date: string | null) {
  const url =
    date === null
      ? 'http://localhost/api/table-bookings/load'
      : `http://localhost/api/table-bookings/load?date=${date}`
  return new NextRequest(url, { method: 'GET', headers: { 'X-API-Key': 'test-key' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPacingSettings).mockResolvedValue(PACING_SETTINGS)
  vi.mocked(getBookingLoadForDate).mockResolvedValue(BOOKINGS)
  vi.mocked(getKitchenPacingSettings).mockResolvedValue(KITCHEN_SETTINGS)
  vi.mocked(getKitchenPacingOverrideForDate).mockResolvedValue(null)
  vi.mocked(getKitchenWindowForDate).mockResolvedValue({ openMinutes: 18 * 60, closeMinutes: 21 * 60 })
  vi.mocked(resolveKitchenCeiling).mockReturnValue(19)
  vi.mocked(buildKitchenAvailabilitySlots).mockReturnValue(SLOTS)
  vi.mocked(isSundayDate).mockReturnValue(false)
})

describe('GET /api/table-bookings/load', () => {
  it('returns 400 for a missing/invalid date', async () => {
    const res = await GET(makeRequest(null))
    expect(res.status).toBe(400)
  })

  it('preserves the existing response fields unchanged', async () => {
    const res = await GET(makeRequest('2026-07-06'))
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.data.date).toBe('2026-07-06')
    expect(json.data.window_minutes).toBe(60)
    expect(json.data.busy_threshold_covers).toBe(30)
    expect(json.data.filling_threshold_covers).toBe(20)
    expect(json.data.bookings).toEqual(BOOKINGS)
  })

  it('enforces the read:table_bookings API scope and sets the 30s cache header', async () => {
    const res = await GET(makeRequest('2026-07-06'))
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=60')
    expect(vi.mocked(withApiAuth)).toHaveBeenCalledWith(
      expect.any(Function),
      ['read:table_bookings'],
      expect.anything()
    )
  })

  it('adds an additive capacity object and per-slot availability', async () => {
    const res = await GET(makeRequest('2026-07-06'))
    const json = await res.json()

    expect(json.data.capacity).toEqual({
      enabled: true,
      window_minutes: 30,
      ceiling_covers: 19,
      walk_in_reserve: 6,
    })
    expect(json.data.slots).toEqual(SLOTS)
  })

  it('uses the Sunday walk-in reserve on a Sunday', async () => {
    vi.mocked(isSundayDate).mockReturnValue(true)
    const res = await GET(makeRequest('2026-07-05'))
    const json = await res.json()
    expect(json.data.capacity.walk_in_reserve).toBe(6)
    // Sunday reserve is read from walkInReserveSunday, not walkInReserveRegular.
    expect(isSundayDate).toHaveBeenCalledWith('2026-07-05')
  })

  it('returns an empty slots array when there is no kitchen window', async () => {
    vi.mocked(getKitchenWindowForDate).mockResolvedValue(null)
    const res = await GET(makeRequest('2026-07-06'))
    const json = await res.json()
    expect(json.data.slots).toEqual([])
    expect(buildKitchenAvailabilitySlots).not.toHaveBeenCalled()
    // capacity object is still present even without a kitchen window.
    expect(json.data.capacity.enabled).toBe(true)
  })
})
