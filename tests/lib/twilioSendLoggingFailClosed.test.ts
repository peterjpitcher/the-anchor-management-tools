import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('sendSMS logging fail-closed behavior', () => {
  const previousTwilioAccountSid = process.env.TWILIO_ACCOUNT_SID
  const previousTwilioAuthToken = process.env.TWILIO_AUTH_TOKEN
  const previousTwilioPhone = process.env.TWILIO_PHONE_NUMBER

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST'
    process.env.TWILIO_AUTH_TOKEN = 'AUTH_TEST'
    process.env.TWILIO_PHONE_NUMBER = '+15555550123'
  })

  it('returns logging_failed when message persistence fails after a transport send', async () => {
    // Ensure env and module-level TWILIO_* constants are re-evaluated with the test env values.
    vi.resetModules()

    const { createAdminClient } = await import('@/lib/supabase/admin')
    const twilio = (await import('twilio')).default

    const twilioCreate = vi.fn().mockResolvedValue({
      sid: 'SM123',
      status: 'sent',
      from: '+15555550123',
    })

    ;(twilio as unknown as vi.Mock).mockReturnValue({
      messages: {
        create: twilioCreate,
      },
    })

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        sms_status: 'active',
        sms_opt_in: true,
        mobile_e164: '+447700900123',
        mobile_number: '+447700900123',
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const messageSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'insert failed' },
    })
    const messageSelect = vi.fn().mockReturnValue({ single: messageSingle })
    const messageInsert = vi.fn().mockReturnValue({ select: messageSelect })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        if (table === 'messages') {
          return { insert: messageInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const { sendSMS } = await import('@/lib/twilio')

    const result = await sendSMS('+447700900123', 'hello', {
      customerId: 'customer-1',
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      skipQuietHours: true,
    })

    expect(twilioCreate).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: true,
      code: 'logging_failed',
      logFailure: true,
      sid: 'SM123',
      customerId: 'customer-1',
    })
  })

  it('returns logging_failed when transport send succeeds but customer context is unavailable for logging', async () => {
    // Ensure env and module-level TWILIO_* constants are re-evaluated with the test env values.
    vi.resetModules()

    const { createAdminClient } = await import('@/lib/supabase/admin')
    const twilio = (await import('twilio')).default

    const twilioCreate = vi.fn().mockResolvedValue({
      sid: 'SM123',
      status: 'sent',
      from: '+15555550123',
    })

    ;(twilio as unknown as vi.Mock).mockReturnValue({
      messages: {
        create: twilioCreate,
      },
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn(),
    })

    const { sendSMS } = await import('@/lib/twilio')

    const result = await sendSMS('+447700900123', 'hello', {
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      skipQuietHours: true,
      metadata: {
        template_key: 'foh_food_order_alert',
        trigger_type: 'foh_food_order_alert',
        stage: 'test',
      },
    })

    expect(twilioCreate).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: true,
      code: 'logging_failed',
      logFailure: true,
      sid: 'SM123',
      customerId: null,
    })
  })

  afterEach(() => {
    if (previousTwilioAccountSid === undefined) {
      delete process.env.TWILIO_ACCOUNT_SID
    } else {
      process.env.TWILIO_ACCOUNT_SID = previousTwilioAccountSid
    }

    if (previousTwilioAuthToken === undefined) {
      delete process.env.TWILIO_AUTH_TOKEN
    } else {
      process.env.TWILIO_AUTH_TOKEN = previousTwilioAuthToken
    }

    if (previousTwilioPhone === undefined) {
      delete process.env.TWILIO_PHONE_NUMBER
    } else {
      process.env.TWILIO_PHONE_NUMBER = previousTwilioPhone
    }
  })
})
