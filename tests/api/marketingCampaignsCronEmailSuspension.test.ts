import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// While an email kill switch is on, the marketing cron must not claim anyone. Each claim spends
// one of a recipient's attempts, and a recipient out of attempts is marked failed, so claiming
// through a suspension would drop people from campaigns for good.

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from '@/app/api/cron/marketing-campaigns/route'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'

const MANAGED_ENV = [
  'SUSPEND_ALL_EMAIL',
  'SUSPEND_ALL_COMMS',
  'MARKETING_SEND_ENABLED',
  'MARKETING_EMAIL_FROM_ADDRESS',
  'RESEND_API_KEY',
] as const

function cronRequest() {
  return new NextRequest('http://localhost/api/cron/marketing-campaigns', { method: 'GET' })
}

describe('marketing cron while email is suspended', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    for (const name of MANAGED_ENV) {
      saved[name] = process.env[name]
      delete process.env[name]
    }
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const name of MANAGED_ENV) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    warnSpy.mockRestore()
  })

  it.each(['SUSPEND_ALL_EMAIL', 'SUSPEND_ALL_COMMS'])(
    'holds the whole queue when %s is on: no claim, no send',
    async (envName) => {
      process.env[envName] = 'true'
      process.env.MARKETING_EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
      process.env.RESEND_API_KEY = 're_test'

      const response = await GET(cronRequest())

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ skipped: 'email_suspended', switch: envName })
      expect(createAdminClient).not.toHaveBeenCalled()
      expect(sendEmail).not.toHaveBeenCalled()
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain(envName)
    }
  )

  it('carries on to the next guard when both switches are off', async () => {
    process.env.SUSPEND_ALL_EMAIL = 'false'

    const response = await GET(cronRequest())
    const body = await response.json()

    // Marketing is not configured in this test, so the run stops at the configuration guard,
    // one step past the suspension guard.
    expect(body.skipped).toBe('not_configured')
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})
