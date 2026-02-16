import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}))

vi.mock('@/lib/sms/safety', () => ({
  buildSmsDedupContext: vi.fn(() => null),
  claimSmsIdempotency: vi.fn(),
  evaluateSmsSafetyLimits: vi.fn(async () => {
    throw new Error('messages safety query failed')
  }),
  releaseSmsIdempotencyClaim: vi.fn(),
}))

import twilio from 'twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { evaluateSmsSafetyLimits } from '@/lib/sms/safety'
import { sendSMS } from '@/lib/twilio'

function mockEligibleCustomerLookup() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      sms_status: 'active',
      sms_opt_in: true,
      mobile_e164: '+447700900123',
      mobile_number: '+447700900123',
    },
    error: null,
  })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })

  ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return { select }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
}

describe('sendSMS unexpected pipeline safety metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns safety_unavailable when safety-limit evaluation throws unexpectedly', async () => {
    mockEligibleCustomerLookup()

    const result = await sendSMS('+447700900123', 'hello', {
      customerId: 'customer-1',
      createCustomerIfMissing: false,
      skipQuietHours: true,
      metadata: {
        template_key: 'bulk_sms_campaign',
        trigger_type: 'bulk_sms_campaign',
        stage: 'test-stage',
      },
    })

    expect(result).toEqual({
      success: false,
      error: 'Failed to send message',
      code: 'safety_unavailable',
    })
    expect(evaluateSmsSafetyLimits).toHaveBeenCalled()
    expect(twilio as unknown as vi.Mock).not.toHaveBeenCalled()
  })
})

