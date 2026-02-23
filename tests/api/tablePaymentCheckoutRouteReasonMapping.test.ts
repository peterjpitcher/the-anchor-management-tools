import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  createTableCheckoutSessionByRawToken: vi.fn(),
}))

vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createTableCheckoutSessionByRawToken } from '@/lib/table-bookings/bookings'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import { POST } from '@/app/g/[token]/table-payment/checkout/route'

describe('table payment checkout blocked-reason mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(checkGuestTokenThrottle as unknown as vi.Mock).mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 60,
      remaining: 7,
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
  })

  async function callCheckoutRoute() {
    const request = new Request(
      'https://management.orangejelly.co.uk/g/token-123/table-payment/checkout',
      { method: 'POST' }
    )
    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    return POST(nextRequestLike as any, {
      params: Promise.resolve({ token: 'token-123' }),
    } as any)
  }

  it('maps Stripe expires_at validation errors to stripe_unavailable', async () => {
    ;(createTableCheckoutSessionByRawToken as unknown as vi.Mock).mockRejectedValue(
      new Error('The `expires_at` timestamp must be less than 24 hours from Checkout Session creation.')
    )

    const response = await callCheckoutRoute()
    const location = response.headers.get('location')

    expect(response.status).toBe(303)
    expect(location).toContain('/g/token-123/table-payment?state=blocked&reason=stripe_unavailable')
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to create Stripe checkout for table payment token',
      expect.objectContaining({
        metadata: expect.objectContaining({
          blockedReason: 'stripe_unavailable',
          error_name: 'Error',
          error_message: expect.stringContaining('expires_at'),
        }),
      })
    )
  })

  it('maps unknown errors to internal_error', async () => {
    ;(createTableCheckoutSessionByRawToken as unknown as vi.Mock).mockRejectedValue(new Error('unexpected failure'))

    const response = await callCheckoutRoute()
    const location = response.headers.get('location')

    expect(response.status).toBe(303)
    expect(location).toContain('/g/token-123/table-payment?state=blocked&reason=internal_error')
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to create Stripe checkout for table payment token',
      expect.objectContaining({
        metadata: expect.objectContaining({
          blockedReason: 'internal_error',
          error_name: 'Error',
          error_message: 'unexpected failure',
        }),
      })
    )
  })
})
