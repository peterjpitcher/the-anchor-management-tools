import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => vi.fn().mockResolvedValue(null)),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn().mockResolvedValue({ ok: true, userId: 'user-1' }),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

import { sendSMS } from '@/lib/twilio'
import { POST } from '@/app/api/foh/food-order-alert/route'

describe('foh food order alert route safety signals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces logging_failed safety signals without returning a retry-triggering 500', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM1',
      code: 'logging_failed',
      logFailure: true,
    })

    const response = await POST(new Request('http://localhost/api/foh/food-order-alert', { method: 'POST' }) as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('fails safe when the SMS transport may have succeeded but message logging failed', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: false,
      sid: 'SM1',
      code: 'logging_failed',
      logFailure: true,
      error: 'Outbound message logging failed',
    })

    const response = await POST(new Request('http://localhost/api/foh/food-order-alert', { method: 'POST' }) as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })
})
