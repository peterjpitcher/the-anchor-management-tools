import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: {
    enqueue: vi.fn(),
  },
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimiters: {
    bulk: vi.fn(),
  },
}))

vi.mock('@/lib/sms/bulk', () => ({
  sendBulkSms: vi.fn(),
}))

const { warn, error, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error,
    info,
  },
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { headers } from 'next/headers'
import { rateLimiters } from '@/lib/rate-limit'
import { sendBulkSms } from '@/lib/sms/bulk'
import { sendBulkSMSDirect } from '@/app/actions/sms-bulk-direct'

describe('sms bulk direct action fail-safe guards', () => {
  const previousEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.clearAllMocks()

    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
    ;(headers as unknown as vi.Mock).mockResolvedValue({
      get: vi.fn().mockReturnValue(null),
    })
    ;(rateLimiters.bulk as unknown as vi.Mock).mockResolvedValue(null)

    previousEnv.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
    previousEnv.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
    previousEnv.TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER

    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST'
    process.env.TWILIO_AUTH_TOKEN = 'auth-test'
    process.env.TWILIO_PHONE_NUMBER = '+447700900000'
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('returns success with logging_failed meta when the bulk helper aborts after persistence failure', async () => {
    ;(sendBulkSms as unknown as vi.Mock).mockResolvedValue({
      success: false,
      error:
        'Bulk SMS aborted due to safety failure (logging_failed): SMS sent but message persistence failed',
    })

    const result = await sendBulkSMSDirect(['customer-a', 'customer-b'], 'Hello from Anchor')

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        code: 'logging_failed',
        logFailure: true,
      })
    )
    expect(result).not.toHaveProperty('error')
  })
})

