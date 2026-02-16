import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('twilio', () => ({
  default: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

import twilio from 'twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { diagnoseMessages } from '@/app/actions/diagnose-messages'

const mockedTwilio = twilio as unknown as vi.Mock
const mockedCreateAdminClient = createAdminClient as unknown as vi.Mock
const mockedCheckUserPermission = checkUserPermission as unknown as vi.Mock

const REQUIRED_ENV_KEYS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

function withRequiredEnv() {
  const previous = new Map<string, string | undefined>()
  for (const key of REQUIRED_ENV_KEYS) {
    previous.set(key, process.env[key])
    process.env[key] = `test-${key.toLowerCase()}`
  }
  return () => {
    for (const key of REQUIRED_ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe('diagnoseMessages action safety hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCheckUserPermission.mockResolvedValue(true)
  })

  it('fails closed when messages table query errors', async () => {
    const restoreEnv = withRequiredEnv()

    try {
      const list = vi.fn().mockResolvedValue([
        {
          sid: 'SM-1',
          direction: 'outbound-api',
          from: '+447700900111',
          to: '+447700106752',
          body: 'hello',
          dateSent: new Date('2026-02-14T12:00:00Z'),
        },
      ])

      mockedTwilio.mockReturnValue({
        messages: { list },
      })

      const messagesIn = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'db down' },
      })
      const messagesSelect = vi.fn().mockReturnValue({ in: messagesIn })

      const from = vi.fn((table: string) => {
        if (table === 'messages') {
          return { select: messagesSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      mockedCreateAdminClient.mockReturnValue({ from })

      const result = await diagnoseMessages('2026-02-14')

      expect(result).toEqual({ error: 'Failed to check messages in database' })
      expect(list).toHaveBeenCalledTimes(1)
      expect(from).toHaveBeenCalledWith('messages')
    } finally {
      restoreEnv()
    }
  })

  it('returns a clean empty result when Twilio returns no messages', async () => {
    const restoreEnv = withRequiredEnv()

    try {
      const list = vi.fn().mockResolvedValue([])

      mockedTwilio.mockReturnValue({
        messages: { list },
      })

      const from = vi.fn()
      mockedCreateAdminClient.mockReturnValue({ from })

      const result = await diagnoseMessages('2026-02-14')

      expect(result).toEqual({
        success: true,
        summary: {
          date: '2026-02-14',
          twilioTotal: 0,
          inDatabase: 0,
          missing: 0,
          missingOutbound: 0,
          missingInbound: 0,
        },
        missingMessages: [],
      })
      expect(from).not.toHaveBeenCalled()
    } finally {
      restoreEnv()
    }
  })
})

