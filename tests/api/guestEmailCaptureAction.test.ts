/**
 * The guest's own email-capture link.
 *
 * Two defects fixed here on 12 September 2026:
 *  - it reset `email_status` and left `email_deactivated_at` standing, which on its own keeps
 *    `isEmailUsable` refusing the brand new address for ever;
 *  - the tick box promised "your booking confirmations and reminders will still come by text",
 *    which email-first made untrue, and those exact words were stored as the consent text.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const checkGuestTokenThrottle = vi.hoisted(() => vi.fn())
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle }))

const lookupEmailCaptureToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/guest/email-capture-token', () => ({
  lookupEmailCaptureToken,
  isPlausibleEmail: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
}))

vi.mock('@/lib/guest/tokens', () => ({ hashGuestToken: (t: string) => `hash:${t}` }))

const recordConsent = vi.hoisted(() => vi.fn())
vi.mock('@/services/consent', () => ({ ConsentService: { recordConsent } }))

function buildAdmin() {
  const customerUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      is: vi.fn().mockResolvedValue({ error: null }),
    }),
  })
  // The main address write chains `.update(...).eq(...)` and awaits it, so the eq result has
  // to be both awaitable and carry `.is` for the marketing-text objection path.
  const customerUpdateEq = vi.fn()
  customerUpdate.mockReturnValue({ eq: customerUpdateEq })
  customerUpdateEq.mockImplementation(() => {
    const result: any = Promise.resolve({ error: null })
    result.is = vi.fn().mockResolvedValue({ error: null })
    return result
  })

  const tokenUpdateSecondEq = vi.fn().mockResolvedValue({ error: null })
  const tokenUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: tokenUpdateSecondEq }),
  })

  createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'customers') return { update: customerUpdate }
      if (table === 'guest_tokens') return { update: tokenUpdate }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })

  return { customerUpdate }
}

function request(body: Record<string, string>) {
  const form = new URLSearchParams(body)
  return new NextRequest('https://management.orangejelly.co.uk/g/tok/email-capture/action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'vitest' },
    body: form.toString(),
  })
}

describe('guest email capture action', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    checkGuestTokenThrottle.mockResolvedValue({ allowed: true })
    lookupEmailCaptureToken.mockResolvedValue({
      ok: true,
      alreadyDone: false,
      customer: { id: 'customer-1', firstName: 'Sam' },
    })
  })

  it('clears the whole address-level block, not just the status', async () => {
    const admin = buildAdmin()
    const { POST } = await import('@/app/g/[token]/email-capture/action/route')

    const response = await POST(request({ email: 'guest@example.com' }), {
      params: Promise.resolve({ token: 'tok' }),
    })

    expect(response.status).toBe(303)
    expect(admin.customerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'guest@example.com',
        email_status: 'unknown',
        email_deactivated_at: null,
        email_delivery_failures: 0,
        last_email_failure_reason: null,
        marketing_email_opt_in: true,
        marketing_email_opted_out_at: null,
      })
    )
  })

  it('stores the corrected tick-box wording under its own version', async () => {
    buildAdmin()
    const { GUEST_MARKETING_SMS_STOP_LABEL, GUEST_MARKETING_SMS_STOP_LABEL_VERSION } = await import(
      '@/lib/consent/constants'
    )
    const { POST } = await import('@/app/g/[token]/email-capture/action/route')

    await POST(request({ email: 'guest@example.com', stop_marketing_sms: 'yes' }), {
      params: Promise.resolve({ token: 'tok' }),
    })

    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sms',
        purpose: 'marketing',
        status: 'opted_out',
        consentText: GUEST_MARKETING_SMS_STOP_LABEL,
        consentTextVersion: GUEST_MARKETING_SMS_STOP_LABEL_VERSION,
      })
    )
  })

  it('no longer promises booking messages come by text', async () => {
    const { GUEST_MARKETING_SMS_STOP_LABEL } = await import('@/lib/consent/constants')

    expect(GUEST_MARKETING_SMS_STOP_LABEL).not.toContain('come by text')
    expect(GUEST_MARKETING_SMS_STOP_LABEL).toContain('will still reach you')
  })
})
