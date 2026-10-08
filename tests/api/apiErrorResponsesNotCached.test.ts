import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createApiResponse, createErrorResponse } from '@/lib/api/auth'

/**
 * An error from the API is never stored by a shared cache.
 *
 * createErrorResponse used to default to `public`, and a response built with no
 * method is treated as a GET, so every error went out as
 * `public, max-age=60, stale-while-revalidate=120`: a 404 for one person's
 * booking, a 401, a 503 during an outage. Site review of 7 October 2026,
 * findings MG-013 and PY-024.
 */
describe('API error responses', () => {
  it.each([
    [400, 'VALIDATION_ERROR'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'IDEMPOTENCY_KEY_CONFLICT'],
    [429, 'RATE_LIMIT_EXCEEDED'],
    [500, 'INTERNAL_ERROR'],
    [503, 'AUTH_UNAVAILABLE'],
  ])('a %i is marked no-store and has no ETag', async (status, code) => {
    const response = createErrorResponse('Something went wrong', code, status)

    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('ETag')).toBeNull()
    expect(await response.json()).toEqual({
      success: false,
      error: { code, message: 'Something went wrong' },
    })
  })

  it('leaves a successful public read cacheable, as before', () => {
    const response = createApiResponse({ items: [] })

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=120')
    expect(response.headers.get('ETag')).toBeTruthy()
  })
})
