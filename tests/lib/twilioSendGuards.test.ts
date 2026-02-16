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

import twilio from 'twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'

function mockCustomerLookup(result: { data: any; error: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
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

function mockCustomerResolutionLookupError() {
  const canonicalLimit = vi.fn().mockResolvedValue({
    data: null,
    error: { message: 'customer lookup unavailable' },
  })
  const canonicalOrder = vi.fn().mockReturnValue({ limit: canonicalLimit })
  const canonicalEq = vi.fn().mockReturnValue({ order: canonicalOrder })
  const select = vi.fn().mockReturnValue({ eq: canonicalEq })

  ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return { select }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
}

describe('sendSMS customer safety guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when customer eligibility lookup returns a DB error', async () => {
    mockCustomerLookup({
      data: null,
      error: { message: 'temporary db read failure' },
    })

    const result = await sendSMS('+447700900123', 'hello', {
      customerId: 'customer-1',
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      skipQuietHours: true,
    })

    expect(result).toEqual({
      success: false,
      error: 'SMS blocked by customer safety check',
      code: 'customer_lookup_failed',
    })
    expect(twilio as unknown as vi.Mock).not.toHaveBeenCalled()
  })

  it('fails closed when customer eligibility lookup affects no rows', async () => {
    mockCustomerLookup({
      data: null,
      error: null,
    })

    const result = await sendSMS('+447700900123', 'hello', {
      customerId: 'customer-2',
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      skipQuietHours: true,
    })

    expect(result).toEqual({
      success: false,
      error: 'SMS blocked by customer safety check',
      code: 'customer_lookup_failed',
    })
    expect(twilio as unknown as vi.Mock).not.toHaveBeenCalled()
  })

  it('blocks sends for known non-active SMS status values', async () => {
    mockCustomerLookup({
      data: {
        sms_status: 'opted_out',
        sms_opt_in: true,
        mobile_e164: '+447700900123',
        mobile_number: '+447700900123',
      },
      error: null,
    })

    const result = await sendSMS('+447700900123', 'hello', {
      customerId: 'customer-3',
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      skipQuietHours: true,
    })

    expect(result).toEqual({
      success: false,
      error: 'This number is not eligible to receive SMS messages',
    })
    expect(twilio as unknown as vi.Mock).not.toHaveBeenCalled()
  })

  it('blocks sends when customer sms_opt_in is false (legacy opt-out) even if sms_status is null', async () => {
    mockCustomerLookup({
      data: {
        sms_status: null,
        sms_opt_in: false,
        mobile_e164: '+447700900123',
        mobile_number: '+447700900123',
      },
      error: null,
    })

    const result = await sendSMS('+447700900123', 'hello', {
      customerId: 'customer-3b',
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      skipQuietHours: true,
    })

    expect(result).toEqual({
      success: false,
      error: 'This number is not eligible to receive SMS messages',
    })
    expect(twilio as unknown as vi.Mock).not.toHaveBeenCalled()
  })

  it('fails closed when provided customerId does not match the destination phone', async () => {
    mockCustomerLookup({
      data: {
        sms_status: 'active',
        sms_opt_in: true,
        mobile_e164: '+447700900111',
        mobile_number: '+447700900111',
      },
      error: null,
    })

    const result = await sendSMS('+447700900123', 'hello', {
      customerId: 'customer-4',
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      skipQuietHours: true,
    })

    expect(result).toEqual({
      success: false,
      error: 'SMS blocked by customer safety check',
      code: 'customer_phone_mismatch',
    })
    expect(twilio as unknown as vi.Mock).not.toHaveBeenCalled()
  })

  it('fails closed when customer resolution lookup errors before resolving customer context', async () => {
    mockCustomerResolutionLookupError()

    const result = await sendSMS('+447700900123', 'hello', {
      skipSafetyGuards: true,
      skipQuietHours: true,
    })

    expect(result).toEqual({
      success: false,
      error: 'SMS blocked by customer safety check',
      code: 'customer_lookup_failed',
    })
    expect(twilio as unknown as vi.Mock).not.toHaveBeenCalled()
  })
})
