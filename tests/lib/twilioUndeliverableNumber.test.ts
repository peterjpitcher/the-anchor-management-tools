import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * sendSMS stops texting a number the first time Twilio refuses it outright. These refusals come
 * back from the send request itself, so no delivery status callback ever reports them. Before this
 * the customer row never learnt, and every later send tried the dead number again.
 */

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

function twilioRefusal(code: number, message: string): Error {
  return Object.assign(new Error(message), { code, status: 400 })
}

async function sendThroughRefusal(refusal: Error) {
  // Re-evaluate the module-level TWILIO_* constants with the test env values.
  vi.resetModules()

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const twilio = (await import('twilio')).default

  const twilioCreate = vi.fn().mockRejectedValue(refusal)
  ;(twilio as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ messages: { create: twilioCreate } })

  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: { sms_status: 'active', sms_opt_in: true, mobile_e164: '+447700900123', mobile_number: '+447700900123' },
    error: null,
  })
  const customerSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle }) })
  const customerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const customerUpdate = vi.fn().mockReturnValue({ eq: customerUpdateEq })

  const messageSingle = vi.fn().mockResolvedValue({ data: { id: 'message-1' }, error: null })
  const messageInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: messageSingle }) })

  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'customers') return { select: customerSelect, update: customerUpdate }
      if (table === 'messages') return { insert: messageInsert }
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

  return { result, twilioCreate, customerUpdate, customerUpdateEq, messageInsert }
}

describe('sendSMS when Twilio refuses the number', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST'
    process.env.TWILIO_AUTH_TOKEN = 'AUTH_TEST'
    process.env.TWILIO_PHONE_NUMBER = '+15555550123'
  })

  it('stops texting an invalid number after the first refusal, and still logs the failed send', async () => {
    const { result, twilioCreate, customerUpdate, customerUpdateEq, messageInsert } = await sendThroughRefusal(
      twilioRefusal(21211, "The 'To' number +447700900123 is not a valid phone number.")
    )

    expect(result).toMatchObject({ success: false, code: '21211' })
    // The refusal is final, so it is not retried.
    expect(twilioCreate).toHaveBeenCalledTimes(1)
    expect(messageInsert).toHaveBeenCalledTimes(1)
    expect(customerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ sms_status: 'sms_deactivated', sms_opt_in: false, sms_deactivation_reason: 'invalid_number' })
    )
    expect(customerUpdateEq).toHaveBeenCalledWith('id', 'customer-1')
  })

  it('stops texting a number that cannot receive texts', async () => {
    const { customerUpdate } = await sendThroughRefusal(
      twilioRefusal(21612, "The 'To' phone number is not currently reachable via SMS.")
    )

    expect(customerUpdate).toHaveBeenCalledWith(expect.objectContaining({ sms_deactivation_reason: 'unreachable_number' }))
  })

  it('leaves the customer alone for an opt-out refusal, which the inbound webhook records', async () => {
    const { result, customerUpdate } = await sendThroughRefusal(
      twilioRefusal(21610, 'Attempt to send to unsubscribed recipient')
    )

    expect(result).toMatchObject({ success: false, code: '21610' })
    expect(customerUpdate).not.toHaveBeenCalled()
  })
})
