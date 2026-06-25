import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: vi.fn(),
}))

vi.mock('@/lib/turnstile', () => ({
  getClientIp: vi.fn(() => '203.0.113.10'),
  verifyTurnstileToken: vi.fn(),
}))

import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { guardPublicRecruitmentRequest } from '@/lib/recruitment/public-security'

describe('guardPublicRecruitmentRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 429 when the guest token throttle blocks the request', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
      remaining: 0,
    })

    const response = await guardPublicRecruitmentRequest(
      new Request('http://localhost/api/recruitment/booking/token-value', { method: 'POST' }),
      'token-value',
      { scope: 'claim', requireTurnstile: true }
    )

    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBe('120')
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
  })

  it('verifies Turnstile when required after throttle passes', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 900,
      remaining: 4,
    })
    vi.mocked(verifyTurnstileToken).mockResolvedValue({ success: true })

    const response = await guardPublicRecruitmentRequest(
      new Request('http://localhost/api/recruitment/booking/token-value', {
        method: 'POST',
        headers: { 'X-Turnstile-Token': 'header-token' },
      }),
      'token-value',
      { scope: 'claim', requireTurnstile: true }
    )

    expect(response).toBeNull()
    expect(verifyTurnstileToken).toHaveBeenCalledWith('header-token', '203.0.113.10')
  })

  it('returns 403 when Turnstile fails', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 900,
      remaining: 4,
    })
    vi.mocked(verifyTurnstileToken).mockResolvedValue({ success: false, error: 'Missing Turnstile verification token' })

    const response = await guardPublicRecruitmentRequest(
      new Request('http://localhost/api/recruitment/booking/token-value', { method: 'POST' }),
      'token-value',
      { scope: 'claim', requireTurnstile: true }
    )

    expect(response?.status).toBe(403)
    const payload = await response!.json()
    expect(payload.error.code).toBe('TURNSTILE_FAILED')
  })
})
