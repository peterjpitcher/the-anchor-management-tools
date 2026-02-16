import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_CONTACT_PHONE_NUMBER: undefined,
    TWILIO_PHONE_NUMBER: undefined,
  },
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((message: string) => message),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { MessageService } from '@/services/messages'

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedSendSMS = sendSMS as unknown as Mock

describe('MessageService sendReply safety signals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces logging_failed safety signals from sendSMS without treating transport send as a failure', async () => {
    const single = vi
      .fn()
      .mockResolvedValueOnce({
        data: { first_name: 'Alex', last_name: 'Smith', mobile_number: '+447700900123' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { sms_opt_in: true },
        error: null,
      })

    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))

    mockedCreateAdminClient.mockReturnValue({ from } as any)

    mockedSendSMS.mockResolvedValue({
      success: true,
      sid: 'SM123',
      status: 'queued',
      code: 'logging_failed',
      logFailure: true,
    })

    const result: any = await MessageService.sendReply('customer-1', 'hello')

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        messageSid: 'SM123',
        status: 'queued',
        code: 'logging_failed',
        logFailure: true,
      })
    )

    expect(mockedSendSMS).toHaveBeenCalledTimes(1)
    expect(mockedSendSMS).toHaveBeenCalledWith(
      '+447700900123',
      'hello',
      expect.objectContaining({
        customerId: 'customer-1',
        metadata: expect.objectContaining({
          template_key: 'message_thread_reply',
          trigger_type: 'message_thread_reply',
          type: 'reply',
          source: 'message_thread',
          stage: expect.stringMatching(/^[a-f0-9]{16}$/),
        }),
      })
    )
  })

  it('returns success when sendSMS suppresses a duplicate send', async () => {
    const single = vi
      .fn()
      .mockResolvedValueOnce({
        data: { first_name: 'Alex', last_name: 'Smith', mobile_number: '+447700900123' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { sms_opt_in: true },
        error: null,
      })

    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))

    mockedCreateAdminClient.mockReturnValue({ from } as any)

    mockedSendSMS.mockResolvedValue({
      success: true,
      sid: null,
      status: 'suppressed_duplicate',
      suppressed: true,
      suppressionReason: 'duplicate',
    })

    const result: any = await MessageService.sendReply('customer-1', 'hello')

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        messageSid: null,
        status: 'suppressed_duplicate',
        code: undefined,
        logFailure: false,
      })
    )
  })

  it('propagates safety metadata when sendSMS returns a non-success outcome', async () => {
    const single = vi
      .fn()
      .mockResolvedValueOnce({
        data: { first_name: 'Alex', last_name: 'Smith', mobile_number: '+447700900123' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { sms_opt_in: true },
        error: null,
      })

    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))

    mockedCreateAdminClient.mockReturnValue({ from } as any)

    mockedSendSMS.mockResolvedValue({
      success: false,
      error: 'SMS sending paused by safety guard',
      code: 'safety_unavailable',
    })

    const result: any = await MessageService.sendReply('customer-1', 'hello')

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: 'SMS sending paused by safety guard',
        code: 'safety_unavailable',
        logFailure: false,
      })
    )
  })
})
