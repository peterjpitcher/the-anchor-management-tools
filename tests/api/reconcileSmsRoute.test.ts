import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/cron/reconcile-sms/route'

describe('reconcile-sms route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST'
    process.env.TWILIO_AUTH_TOKEN = 'AUTH_TEST'
  })

  it('returns a generic 500 payload when reconciliation throws unexpectedly', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createAdminClient as unknown as vi.Mock).mockImplementation(() => {
      throw new Error('sensitive internal database failure details')
    })

    const request = new Request('http://localhost/api/cron/reconcile-sms')
    const response = await GET(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Internal server error' })
    expect('message' in payload).toBe(false)
  })
})
