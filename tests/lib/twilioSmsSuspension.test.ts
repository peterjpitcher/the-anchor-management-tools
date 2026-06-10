import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'AC_TEST'
  process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'auth_test'
  process.env.TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+15555555555'
})

// sendSMS caches the Twilio client at module level, so every test must share
// one messages.create mock rather than swapping the factory's return value.
const { messagesCreateMock } = vi.hoisted(() => ({
  messagesCreateMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: messagesCreateMock,
    },
  })),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'

const TO = '+447700900123'

function mockActiveCustomerLookup() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      sms_status: 'active',
      sms_opt_in: true,
      mobile_e164: TO,
      mobile_number: TO,
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

const SEND_OPTIONS = {
  customerId: 'customer-1',
  createCustomerIfMissing: false,
  skipSafetyGuards: true,
  skipQuietHours: true,
  skipMessageLogging: true,
}

describe('sendSMS emergency suspension flags', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SUSPEND_ALL_SMS
    delete process.env.SUSPEND_EVENT_SMS
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    messagesCreateMock.mockResolvedValue({
      sid: 'SM-test',
      from: '+15555555555',
      status: 'queued',
    })
  })

  afterEach(() => {
    delete process.env.SUSPEND_ALL_SMS
    delete process.env.SUSPEND_EVENT_SMS
    warnSpy.mockRestore()
  })

  it('blocks every send when SUSPEND_ALL_SMS is enabled', async () => {
    process.env.SUSPEND_ALL_SMS = 'true'

    const result = await sendSMS(TO, 'hello', SEND_OPTIONS)

    expect(result).toEqual({
      success: false,
      error: 'SMS sending is currently suspended',
      code: 'sms_suspended',
      suspensionReason: 'all_sms',
    })
    expect(messagesCreateMock).not.toHaveBeenCalled()
    // Short-circuits before any customer resolution or DB side effects.
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('SUSPEND_ALL_SMS')
  })

  it('sends normally when no suspension flag is set', async () => {
    mockActiveCustomerLookup()

    const result = await sendSMS(TO, 'hello', SEND_OPTIONS)

    expect(result).toEqual(expect.objectContaining({
      success: true,
      sid: 'SM-test',
    }))
    expect(messagesCreateMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('blocks event-scoped sends when SUSPEND_EVENT_SMS is enabled', async () => {
    process.env.SUSPEND_EVENT_SMS = 'true'

    const result = await sendSMS(TO, 'hello', {
      ...SEND_OPTIONS,
      metadata: { event_id: 'event-1', template_key: 'event_reminder_1d' },
    })

    expect(result).toEqual({
      success: false,
      error: 'SMS sending is currently suspended',
      code: 'sms_suspended',
      suspensionReason: 'event_sms',
    })
    expect(messagesCreateMock).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('SUSPEND_EVENT_SMS')
  })

  it('still sends non-event messages when only SUSPEND_EVENT_SMS is enabled', async () => {
    process.env.SUSPEND_EVENT_SMS = 'true'
    mockActiveCustomerLookup()

    const result = await sendSMS(TO, 'hello', {
      ...SEND_OPTIONS,
      metadata: { template_key: 'general_broadcast' },
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      sid: 'SM-test',
    }))
    expect(messagesCreateMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
