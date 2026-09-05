// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const { query, load, limit } = vi.hoisted(() => ({ query: vi.fn(), load: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ in: query }) }) }) }))
vi.mock('@/lib/business-hours/effective', () => ({ loadPublishedVersions: load }))
vi.mock('@/lib/distributed-rate-limit', () => ({ applyDistributedRateLimit: limit }))
import { GET } from '@/app/api/business/screening-hours/route'
const request = (params: string) => new NextRequest(`https://management.orangejelly.co.uk/api/business/screening-hours${params}`)
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-05T08:00:00Z'))
  limit.mockReset().mockResolvedValue(null)
  query.mockReset().mockResolvedValue({ data: [], error: null })
  load.mockReset().mockResolvedValue([{ effectiveFrom: '2026-01-01', rows: [{ day_of_week: 6, opens: '12:00', closes: '23:00', kitchen_opens: null, kitchen_closes: null, is_closed: false }] }])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('serves the real resolver through the exact GET with a no-store envelope', async () => {
  const response = await GET(request('?dates=2026-11-07'))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.has('ETag')).toBe(false)
  expect(await response.json()).toMatchObject({ success: true, data: { schemaVersion: 1, timezone: 'Europe/London', days: [{ date: '2026-11-07', state: 'open', bar: { startAt: '2026-11-07T12:00:00.000Z' } }] } })
})
it.each(['', '?dates=2026-02-30', '?dates=2026-09-04', '?dates=2028-01-01', '?dates=2026-11-07&dates=2026-11-08'])('rejects invalid request %s before hours reads', async params => {
  const response = await GET(request(params))
  expect(response.status).toBe(400)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(load).not.toHaveBeenCalled()
})
it('returns 503 when exact-date exceptions fail, never weekly fallback', async () => {
  query.mockRejectedValue(new Error('credentials must not be echoed'))
  const response = await GET(request('?dates=2026-11-07'))
  expect(response.status).toBe(503)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ success: false, error: { code: 'HOURS_UNAVAILABLE' } })
  expect(console.error).toHaveBeenCalledWith('[Screening hours] Operating hours dependency unavailable')
})
it('preserves the rate limiter response and does not query hours', async () => {
  limit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } }))
  const response = await GET(request('?dates=2026-11-07'))
  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).toBe('60')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(load).not.toHaveBeenCalled()
})
