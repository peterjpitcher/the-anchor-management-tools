import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('twilio', () => ({
  default: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { importMissedMessages } from '@/app/actions/import-messages'

const mockedTwilio = twilio as unknown as vi.Mock
const mockedCreateClient = createClient as unknown as vi.Mock
const mockedCreateAdminClient = createAdminClient as unknown as vi.Mock
const mockedLogAuditEvent = logAuditEvent as unknown as vi.Mock

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

describe('importMissedMessages action safety hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              email: 'user@example.com',
            },
          },
        }),
      },
    })
  })

  it('fails closed when existing message SID lookup errors', async () => {
    const restoreEnv = withRequiredEnv()

    try {
      const mockEach = vi.fn().mockImplementation(async (_opts: any, cb: any) => {
        cb({
          sid: 'SM-1',
          direction: 'inbound',
          from: '+447700900111',
          to: '+447700106752',
          body: 'hello',
          status: 'delivered',
          dateCreated: new Date('2026-02-14T12:00:00Z'),
          dateSent: new Date('2026-02-14T12:00:00Z'),
        })
      })

      mockedTwilio.mockReturnValue({
        messages: {
          each: mockEach,
          list: vi.fn(),
        },
      })

      const messagesExistingIn = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'db down' } })
      const messagesSelect = vi.fn().mockReturnValue({ in: messagesExistingIn })
      const messagesUpsert = vi.fn()

      mockedCreateAdminClient.mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: messagesSelect,
              upsert: messagesUpsert,
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      })

      const result = await importMissedMessages('2026-02-13', '2026-02-15')

      expect(result).toEqual({ error: 'Failed to verify existing messages' })
      expect(messagesUpsert).not.toHaveBeenCalled()
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_status: 'failure',
          error_message: 'Failed to verify existing messages',
        }),
      )
    } finally {
      restoreEnv()
    }
  })

  it('creates placeholder customers with SMS deactivated defaults', async () => {
    const restoreEnv = withRequiredEnv()

    try {
      const phone = '+447700900222'
      const mockEach = vi.fn().mockImplementation(async (_opts: any, cb: any) => {
        cb({
          sid: 'SM-2',
          direction: 'inbound',
          from: phone,
          to: '+447700106752',
          body: 'hello again',
          status: 'delivered',
          dateCreated: new Date('2026-02-14T12:00:00Z'),
          dateSent: new Date('2026-02-14T12:00:00Z'),
        })
      })

      mockedTwilio.mockReturnValue({
        messages: {
          each: mockEach,
          list: vi.fn(),
        },
      })

      const messagesExistingIn = vi.fn().mockResolvedValue({ data: [], error: null })
      const messagesSelect = vi.fn().mockReturnValue({ in: messagesExistingIn })
      const messagesUpsertSelect = vi
        .fn()
        .mockResolvedValue({ data: [{ twilio_message_sid: 'SM-2' }], error: null })
      const messagesUpsert = vi.fn().mockReturnValue({ select: messagesUpsertSelect })

      const customersIn = vi
        .fn()
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({
          data: [
            {
              id: 'customer-1',
              first_name: 'Unknown',
              last_name: '0222',
              mobile_number: phone,
              mobile_e164: phone,
              mobile_number_raw: phone,
            },
          ],
          error: null,
        })
      const customersSelect = vi.fn().mockReturnValue({ in: customersIn })
      const customersUpsert = vi.fn().mockResolvedValue({ data: null, error: null })

      mockedCreateAdminClient.mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: messagesSelect,
              upsert: messagesUpsert,
            }
          }

          if (table === 'customers') {
            return {
              select: customersSelect,
              upsert: customersUpsert,
            }
          }

          throw new Error(`Unexpected table: ${table}`)
        }),
      })

      const result = await importMissedMessages('2026-02-13', '2026-02-15')

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            imported: 1,
            failed: 0,
          }),
        }),
      )

      expect(customersUpsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            first_name: 'Unknown',
            mobile_number: phone,
            mobile_e164: phone,
            sms_opt_in: false,
            marketing_sms_opt_in: false,
            sms_status: 'sms_deactivated',
            sms_deactivated_at: expect.any(String),
            sms_deactivation_reason: 'import_missed_messages_placeholder',
          }),
        ],
        expect.objectContaining({
          onConflict: 'mobile_e164',
          ignoreDuplicates: true,
        }),
      )
    } finally {
      restoreEnv()
    }
  })

  it('fails closed when customer lookup errors', async () => {
    const restoreEnv = withRequiredEnv()

    try {
      const phone = '+447700900333'
      const mockEach = vi.fn().mockImplementation(async (_opts: any, cb: any) => {
        cb({
          sid: 'SM-3',
          direction: 'inbound',
          from: phone,
          to: '+447700106752',
          body: 'hello',
          status: 'delivered',
          dateCreated: new Date('2026-02-14T12:00:00Z'),
          dateSent: new Date('2026-02-14T12:00:00Z'),
        })
      })

      mockedTwilio.mockReturnValue({
        messages: {
          each: mockEach,
          list: vi.fn(),
        },
      })

      const messagesExistingIn = vi.fn().mockResolvedValue({ data: [], error: null })
      const messagesSelect = vi.fn().mockReturnValue({ in: messagesExistingIn })
      const messagesUpsert = vi.fn()

      const customersIn = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'read error' },
      })
      const customersSelect = vi.fn().mockReturnValue({ in: customersIn })
      const customersUpsert = vi.fn()

      mockedCreateAdminClient.mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: messagesSelect,
              upsert: messagesUpsert,
            }
          }

          if (table === 'customers') {
            return {
              select: customersSelect,
              upsert: customersUpsert,
            }
          }

          throw new Error(`Unexpected table: ${table}`)
        }),
      })

      const result = await importMissedMessages('2026-02-13', '2026-02-15')

      expect(result).toEqual({ error: 'Failed to verify existing customers' })
      expect(customersUpsert).not.toHaveBeenCalled()
      expect(messagesUpsert).not.toHaveBeenCalled()
    } finally {
      restoreEnv()
    }
  })
})

