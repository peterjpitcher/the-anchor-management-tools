import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWithApiAuth = vi.fn()
const mockGetPacingSettings = vi.fn()
const mockGetBookingLoadForDate = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: (...args: unknown[]) => mockWithApiAuth(...args),
  createApiResponse: (
    data: unknown,
    status = 200,
    headers: Record<string, string> = {}
  ) => Response.json({ success: true, data }, { status, headers }),
  createErrorResponse: (message: string, code: string, status = 400) =>
    Response.json({ success: false, error: { code, message } }, { status }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/table-bookings/load', () => ({
  getPacingSettings: (...args: unknown[]) => mockGetPacingSettings(...args),
  getBookingLoadForDate: (...args: unknown[]) => mockGetBookingLoadForDate(...args),
  toPublicPacingSettings: (settings: any) => ({
    busy_threshold_covers: settings.busyThresholdCovers,
    filling_threshold_covers: settings.fillingThresholdCovers,
    window_minutes: settings.windowMinutes,
  }),
}))

describe('GET /api/table-bookings/load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockWithApiAuth.mockImplementation((handler, _permissions, request) => handler(request))
    mockGetPacingSettings.mockResolvedValue({
      busyThresholdCovers: 30,
      fillingThresholdCovers: 20,
      windowMinutes: 60,
    })
    mockGetBookingLoadForDate.mockResolvedValue([{ time: '13:00', covers: 25 }])
  })

  it('requires the existing underscore table-booking read scope', async () => {
    const { GET } = await import('@/app/api/table-bookings/load/route')
    const request = new Request('http://localhost/api/table-bookings/load?date=2026-06-21')

    await GET(request as any)

    expect(mockWithApiAuth).toHaveBeenCalledWith(expect.any(Function), ['read:table_bookings'], request)
  })

  it('returns load data with a 30 second cache header', async () => {
    const { GET } = await import('@/app/api/table-bookings/load/route')
    const response = await GET(
      new Request('http://localhost/api/table-bookings/load?date=2026-06-21') as any
    )
    const body = await response.json()

    expect(response.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=60')
    expect(body.data).toEqual({
      date: '2026-06-21',
      window_minutes: 60,
      busy_threshold_covers: 30,
      filling_threshold_covers: 20,
      bookings: [{ time: '13:00', covers: 25 }],
    })
  })

  it('rejects malformed dates', async () => {
    const { GET } = await import('@/app/api/table-bookings/load/route')
    const response = await GET(
      new Request('http://localhost/api/table-bookings/load?date=2026-99-99') as any
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(mockGetBookingLoadForDate).not.toHaveBeenCalled()
  })
})
