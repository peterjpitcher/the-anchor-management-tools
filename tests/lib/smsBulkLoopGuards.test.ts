import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { sendBulkSms } from '@/lib/sms/bulk'

describe('bulk SMS loop guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to safe chunk/concurrency values when request values are zero or negative', async () => {
    const customersIn = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Alex',
          last_name: null,
          mobile_number: '+447700900111',
          mobile_e164: '+447700900111',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
        {
          id: 'customer-2',
          first_name: 'Casey',
          last_name: null,
          mobile_number: '+447700900222',
          mobile_e164: '+447700900222',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
      ],
      error: null,
    })
    const customersSelect = vi.fn().mockReturnValue({ in: customersIn })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customersSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM123',
      deferred: false,
      suppressed: false,
    })

    const result = await sendBulkSms({
      customerIds: ['customer-1', 'customer-2'],
      message: 'Testing bulk send',
      chunkSize: 0,
      concurrency: 0,
      batchDelayMs: -10,
      bulkJobId: 'bulk-job-1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.sent).toBe(2)
      expect(result.failed).toBe(0)
    }
    expect(sendSMS).toHaveBeenCalledTimes(2)
  })

  it('blocks sends that exceed the configured bulk recipient cap', async () => {
    const previousLimit = process.env.BULK_SMS_MAX_RECIPIENTS
    process.env.BULK_SMS_MAX_RECIPIENTS = '1'

    try {
      const result = await sendBulkSms({
        customerIds: ['customer-1', 'customer-2'],
        message: 'Testing bulk send',
      })

      expect(result).toEqual({
        success: false,
        error: 'Bulk SMS recipient limit exceeded (2/1). Split this send into smaller batches.',
      })
      expect(createAdminClient).not.toHaveBeenCalled()
      expect(sendSMS).not.toHaveBeenCalled()
    } finally {
      if (previousLimit === undefined) {
        delete process.env.BULK_SMS_MAX_RECIPIENTS
      } else {
        process.env.BULK_SMS_MAX_RECIPIENTS = previousLimit
      }
    }
  })

  it('aborts the bulk send when sendSMS reports a fatal safety failure (logging_failed)', async () => {
    const customersIn = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Alex',
          last_name: null,
          mobile_number: '+447700900111',
          mobile_e164: '+447700900111',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
        {
          id: 'customer-2',
          first_name: 'Casey',
          last_name: null,
          mobile_number: '+447700900222',
          mobile_e164: '+447700900222',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
      ],
      error: null,
    })
    const customersSelect = vi.fn().mockReturnValue({ in: customersIn })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customersSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM123',
      deferred: false,
      suppressed: false,
      messageId: null,
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await sendBulkSms({
      customerIds: ['customer-1', 'customer-2'],
      message: 'Testing bulk send',
      chunkSize: 25,
      concurrency: 1,
      batchDelayMs: 0,
      bulkJobId: 'bulk-job-1',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('logging_failed')
    }
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('aborts the bulk send when sendSMS throws unexpectedly, preventing additional fanout', async () => {
    const customersIn = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Alex',
          last_name: null,
          mobile_number: '+447700900111',
          mobile_e164: '+447700900111',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
        {
          id: 'customer-2',
          first_name: 'Casey',
          last_name: null,
          mobile_number: '+447700900222',
          mobile_e164: '+447700900222',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
      ],
      error: null,
    })
    const customersSelect = vi.fn().mockReturnValue({ in: customersIn })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customersSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    ;(sendSMS as unknown as vi.Mock).mockRejectedValueOnce(new Error('messages table unavailable'))

    const result = await sendBulkSms({
      customerIds: ['customer-1', 'customer-2'],
      message: 'Testing bulk send',
      chunkSize: 25,
      concurrency: 1,
      batchDelayMs: 0,
      bulkJobId: 'bulk-job-throw',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('safety_unavailable')
      expect(result.error).toContain('messages table unavailable')
    }
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('forces single-flight dispatch even when higher concurrency is requested, preventing fatal fanout', async () => {
    const customersIn = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Alex',
          last_name: null,
          mobile_number: '+447700900111',
          mobile_e164: '+447700900111',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
        {
          id: 'customer-2',
          first_name: 'Casey',
          last_name: null,
          mobile_number: '+447700900222',
          mobile_e164: '+447700900222',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
        {
          id: 'customer-3',
          first_name: 'Jordan',
          last_name: null,
          mobile_number: '+447700900333',
          mobile_e164: '+447700900333',
          sms_opt_in: true,
          sms_status: 'active',
          marketing_sms_opt_in: true,
        },
      ],
      error: null,
    })
    const customersSelect = vi.fn().mockReturnValue({ in: customersIn })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customersSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM123',
      deferred: false,
      suppressed: false,
      messageId: null,
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await sendBulkSms({
      customerIds: ['customer-1', 'customer-2', 'customer-3'],
      message: 'Testing bulk send',
      chunkSize: 25,
      concurrency: 5,
      batchDelayMs: 0,
      bulkJobId: 'bulk-job-2',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('logging_failed')
    }
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })
})
