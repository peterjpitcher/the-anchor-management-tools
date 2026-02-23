import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimiters: {
    bulk: vi.fn(),
    sms: vi.fn(),
  },
}))

vi.mock('@/lib/sms/bulk', () => ({
  sendBulkSms: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
  resolveCustomerIdForSms: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  getTablePaymentPreviewByRawToken: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { headers } from 'next/headers'
import { rateLimiters } from '@/lib/rate-limit'
import { sendBulkSms } from '@/lib/sms/bulk'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone, resolveCustomerIdForSms } from '@/lib/sms/customers'
import { getTablePaymentPreviewByRawToken } from '@/lib/table-bookings/bookings'
import { sendSMS } from '@/lib/twilio'
import { sendBulkSMSAsync, sendOTPMessage, sendSms } from '@/app/actions/sms'

describe('sms action bulk guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
    ;(headers as unknown as vi.Mock).mockResolvedValue({
      get: vi.fn().mockReturnValue(null),
    })
    ;(rateLimiters.bulk as unknown as vi.Mock).mockResolvedValue(null)
    ;(sendBulkSms as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sent: 2,
      failed: 0,
      total: 2,
      results: [
        { customerId: 'customer-a', messageSid: 'SM1' },
        { customerId: 'customer-b', messageSid: 'SM2' },
      ],
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-otp',
      resolutionError: undefined
    })
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM-OTP-1'
    })
  })

  it('rejects bulk send when permission is missing', async () => {
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(false)

    const result = await sendBulkSMSAsync(['customer-a'], 'Hello')

    expect(result).toEqual({ error: 'Insufficient permissions to send messages' })
    expect(sendBulkSms).not.toHaveBeenCalled()
  })

  it('rejects bulk send when bulk limiter blocks the request', async () => {
    ;(rateLimiters.bulk as unknown as vi.Mock).mockResolvedValue(new Response('limited', { status: 429 }))

    const result = await sendBulkSMSAsync(['customer-a'], 'Hello')

    expect(result).toEqual({
      error: 'Too many bulk SMS operations. Please wait before sending more bulk messages.',
    })
    expect(sendBulkSms).not.toHaveBeenCalled()
  })

  it('rejects bulk send above configured recipient cap', async () => {
    const previousLimit = process.env.BULK_SMS_MAX_RECIPIENTS
    process.env.BULK_SMS_MAX_RECIPIENTS = '1'

    try {
      const result = await sendBulkSMSAsync(['customer-a', 'customer-b'], 'Hello')

      expect(result).toEqual({
        error: 'Bulk SMS recipient limit exceeded (2/1). Split this send into smaller batches.',
      })
      expect(sendBulkSms).not.toHaveBeenCalled()
    } finally {
      if (previousLimit === undefined) {
        delete process.env.BULK_SMS_MAX_RECIPIENTS
      } else {
        process.env.BULK_SMS_MAX_RECIPIENTS = previousLimit
      }
    }
  })

  it('normalizes recipients before dispatching bulk send', async () => {
    const result = await sendBulkSMSAsync(['customer-b', 'customer-a', 'customer-a'], 'Hello')

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sent: 2,
        failed: 0,
      })
    )
    expect(sendBulkSms).toHaveBeenCalledWith(
      expect.objectContaining({
        customerIds: ['customer-a', 'customer-b'],
      })
    )
  })

  it('fails safe when bulk helper aborts with logging_failed after sends may have occurred', async () => {
    ;(sendBulkSms as unknown as vi.Mock).mockResolvedValue({
      success: false,
      error: 'Bulk SMS aborted due to safety failure (logging_failed): SMS sent but message persistence failed',
    })

    const result = await sendBulkSMSAsync(['customer-a'], 'Hello')

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        code: 'logging_failed',
        logFailure: true,
      })
    )
    expect(result).not.toHaveProperty('error')
  })
})

describe('sms action OTP guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-otp',
      resolutionError: undefined
    })
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM-OTP-1'
    })
  })

  it('fails closed when customer resolution safety check errors', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: null,
      resolutionError: 'lookup_failed'
    })

    await expect(
      sendOTPMessage({
        phoneNumber: '+447700900123',
        message: 'Code: 123456'
      })
    ).rejects.toThrow('SMS blocked by customer safety check')

    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('fails closed when customer resolution returns no customer ID', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: null,
      resolutionError: undefined
    })

    await expect(
      sendOTPMessage({
        phoneNumber: '+447700900124',
        message: 'Code: 654321'
      })
    ).rejects.toThrow('SMS blocked by customer safety check')

    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('sends OTP when customer resolution succeeds', async () => {
    const result = await sendOTPMessage({
      phoneNumber: '+447700900125',
      message: 'Code: 246810'
    })

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        messageSid: 'SM-OTP-1',
        logFailure: false,
      })
    )
    expect(sendSMS).toHaveBeenCalledWith(
      '+447700900125',
      'Code: 246810',
      expect.objectContaining({
        customerId: 'customer-otp',
        createCustomerIfMissing: false,
        metadata: expect.objectContaining({
          context: 'otp',
          template_key: 'otp_message',
          trigger_type: 'otp_message'
        })
      })
    )
  })

  it('fails safe when OTP sendSMS returns logging_failed as non-success', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: false,
      sid: 'SM-OTP-logging-1',
      code: 'logging_failed',
      logFailure: true,
      error: 'DB insert failed',
    })

    const result = await sendOTPMessage({
      phoneNumber: '+447700900126',
      message: 'Code: 135790'
    })

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        messageSid: 'SM-OTP-logging-1',
        code: 'logging_failed',
        logFailure: true,
      })
    )
  })
})

describe('sms action recipient safety guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
    ;(headers as unknown as vi.Mock).mockResolvedValue({
      get: vi.fn().mockReturnValue(null),
    })
    ;(rateLimiters.sms as unknown as vi.Mock).mockResolvedValue(null)
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
    ;(resolveCustomerIdForSms as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined
    })
    ;(getTablePaymentPreviewByRawToken as unknown as vi.Mock).mockResolvedValue({
      state: 'ready',
      tableBookingId: 'booking-preview-1',
      customerId: 'customer-1',
      bookingReference: 'BK-1',
      partySize: 2,
      totalAmount: 20,
      currency: 'GBP',
      holdExpiresAt: '2099-02-01T10:00:00.000Z',
      bookingDate: '2099-02-01',
      bookingTime: '12:30',
      startDateTime: '2099-02-01T12:30:00.000Z',
      bookingType: 'sunday_lunch',
      tokenHash: 'token-hash-preview',
    })
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM-1',
      status: 'queued',
      messageId: 'msg-1'
    })
  })

  it('rejects manual send when permission is missing', async () => {
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(false)

    const result = await sendSms({
      to: '+447700900110',
      body: 'Permission gate message',
      bookingId: 'booking-0',
    })

    expect(result).toEqual({ error: 'Insufficient permissions to send messages' })
    expect(rateLimiters.sms).not.toHaveBeenCalled()
    expect(resolveCustomerIdForSms).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('fails closed when recipient context lookup reports a safety error', async () => {
    ;(resolveCustomerIdForSms as unknown as vi.Mock).mockResolvedValue({
      customerId: null,
      resolutionError: 'booking_lookup_failed'
    })

    const result = await sendSms({
      to: '+447700900111',
      body: 'Safety check message',
      bookingId: 'booking-1'
    })

    expect(result).toEqual({ error: 'Failed SMS recipient safety check' })
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('blocks manual send when body contains an invalid table-payment token link', async () => {
    ;(getTablePaymentPreviewByRawToken as unknown as vi.Mock).mockResolvedValue({
      state: 'blocked',
      reason: 'invalid_token',
    })

    const result = await sendSms({
      to: '+447700900111',
      body: 'Please pay here: https://management.orangejelly.co.uk/g/bad-token/table-payment',
      bookingId: 'booking-1'
    })

    expect(result).toEqual({
      error: 'Cannot send SMS because a payment link is unavailable (invalid_token).'
    })
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('allows manual send when body contains a valid table-payment token link', async () => {
    ;(getTablePaymentPreviewByRawToken as unknown as vi.Mock).mockResolvedValue({
      state: 'ready',
      tableBookingId: 'booking-preview-2',
      customerId: 'customer-1',
      bookingReference: 'BK-2',
      partySize: 3,
      totalAmount: 30,
      currency: 'GBP',
      holdExpiresAt: '2099-02-01T10:00:00.000Z',
      bookingDate: '2099-02-01',
      bookingTime: '13:00',
      startDateTime: '2099-02-01T13:00:00.000Z',
      bookingType: 'sunday_lunch',
      tokenHash: 'token-hash-preview-2',
    })

    const result = await sendSms({
      to: '+447700900112',
      body: 'Pay link: https://management.orangejelly.co.uk/g/good-token/table-payment',
      bookingId: 'booking-2'
    })

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sid: 'SM-1',
        customerId: 'customer-1'
      })
    )
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('sends SMS when recipient context lookup succeeds', async () => {
    const result = await sendSms({
      to: '+447700900112',
      body: 'Normal message',
      bookingId: 'booking-2'
    })

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sid: 'SM-1',
        messageId: 'msg-1',
        customerId: 'customer-1'
      })
    )
    expect(sendSMS).toHaveBeenCalledWith(
      '+447700900112',
      expect.stringContaining('Normal message'),
      expect.objectContaining({
        customerId: 'customer-1',
        metadata: expect.objectContaining({
          template_key: 'manual_sms',
          trigger_type: 'manual_sms'
        })
      })
    )
  })

  it('surfaces logFailure when outbound message logging fails after transport send', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM-logging-1',
      status: 'queued',
      messageId: null,
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await sendSms({
      to: '+447700900113',
      body: 'Logging failure message',
      bookingId: 'booking-3'
    })

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sid: 'SM-logging-1',
        code: 'logging_failed',
        logFailure: true,
      })
    )
  })

  it('fails safe when sendSMS reports logging_failed as non-success', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: false,
      sid: 'SM-logging-2',
      status: 'queued',
      messageId: null,
      code: 'logging_failed',
      logFailure: true,
      error: 'Message persisted failed after transport send',
    })

    const result = await sendSms({
      to: '+447700900114',
      body: 'Logging failure message (non-success)',
      bookingId: 'booking-4'
    })

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sid: 'SM-logging-2',
        code: 'logging_failed',
        logFailure: true,
      })
    )
  })
})
