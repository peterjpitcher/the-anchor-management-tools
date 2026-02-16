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

describe('bulk SMS marketing eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('only sends to customers with sms_opt_in + marketing_sms_opt_in and non-blocked sms_status', async () => {
    const customersIn = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Alex',
          last_name: null,
          mobile_e164: '+447700900111',
          mobile_number: '+447700900111',
          sms_opt_in: true,
          marketing_sms_opt_in: true,
          sms_status: 'active',
        },
        {
          id: 'customer-2',
          first_name: 'Blake',
          last_name: null,
          mobile_e164: '+447700900222',
          mobile_number: '+447700900222',
          sms_opt_in: true,
          marketing_sms_opt_in: false,
          sms_status: 'active',
        },
        {
          id: 'customer-3',
          first_name: 'Casey',
          last_name: null,
          mobile_e164: '+447700900333',
          mobile_number: '+447700900333',
          sms_opt_in: true,
          marketing_sms_opt_in: true,
          sms_status: 'opted_out',
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
      customerIds: ['customer-1', 'customer-2', 'customer-3'],
      message: 'Hello!',
      bulkJobId: 'bulk-job-1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.sent).toBe(1)
      expect(result.failed).toBe(0)
      expect(result.total).toBe(1)
    }

    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(sendSMS).toHaveBeenCalledWith(
      '+447700900111',
      'Hello!',
      expect.objectContaining({
        customerId: 'customer-1',
      }),
    )
  })

  it('fails closed when no customers are eligible for marketing SMS', async () => {
    const customersIn = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Alex',
          last_name: null,
          mobile_e164: '+447700900111',
          mobile_number: '+447700900111',
          sms_opt_in: true,
          marketing_sms_opt_in: false,
          sms_status: 'active',
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

    const result = await sendBulkSms({
      customerIds: ['customer-1'],
      message: 'Hello!',
    })

    expect(result).toEqual({
      success: false,
      error: 'No customers eligible for marketing SMS',
    })
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('fails closed when customer lookup errors', async () => {
    const customersIn = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db down' },
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

    const result = await sendBulkSms({
      customerIds: ['customer-1'],
      message: 'Hello!',
    })

    expect(result).toEqual({
      success: false,
      error: 'Failed to load customers for bulk SMS',
    })
    expect(sendSMS).not.toHaveBeenCalled()
  })
})

