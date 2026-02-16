import { beforeEach, describe, expect, it, vi } from 'vitest'

const { warn, error } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn,
    error,
  },
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((value: string) => value),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/parking/notifications', () => ({
  buildPaymentConfirmationSms: vi.fn(),
  buildPaymentConfirmationManagerEmail: vi.fn(),
  buildPaymentRequestSms: vi.fn().mockReturnValue('Pay now'),
}))

vi.mock('@/lib/parking/repository', () => ({
  insertParkingPayment: vi.fn(),
  getPendingParkingPayment: vi.fn(),
  updateParkingBooking: vi.fn(),
  logParkingNotification: vi.fn().mockResolvedValue({ id: 'notification-1' }),
}))

import { sendSMS } from '@/lib/twilio'
import { buildPaymentConfirmationManagerEmail, buildPaymentConfirmationSms } from '@/lib/parking/notifications'
import { sendEmail } from '@/lib/email/emailService'
import { logParkingNotification, updateParkingBooking } from '@/lib/parking/repository'
import { captureParkingPayment, sendParkingPaymentRequest } from '@/lib/parking/payments'

describe('parking payment persistence guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists sms_code and sms_log_failure markers when sendSMS returns logging_failed', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM1',
      code: 'logging_failed',
      logFailure: true,
    })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'booking-logging-fail' },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'parking_bookings') {
          return { update }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await sendParkingPaymentRequest(
      {
        id: 'booking-logging-fail',
        customer_id: null,
        customer_mobile: '+447700900123',
      } as any,
      'https://example.com/pay',
      { client: supabase as any }
    )

    expect(error).toHaveBeenCalledWith(
      'Parking payment request SMS sent but outbound message logging failed',
      expect.any(Object)
    )
    expect(logParkingNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-logging-fail',
        channel: 'sms',
        event_type: 'payment_request',
        status: 'sent',
        payload: expect.objectContaining({
          sms_code: 'logging_failed',
          sms_log_failure: true,
        }),
      }),
      supabase
    )
  })

  it('persists sms_code and sms_log_failure markers for payment confirmation SMS when sendSMS returns logging_failed', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM2',
      code: 'logging_failed',
      logFailure: true,
    })
    ;(buildPaymentConfirmationSms as unknown as vi.Mock).mockReturnValue('Paid')
    ;(buildPaymentConfirmationManagerEmail as unknown as vi.Mock).mockReturnValue({
      to: 'manager@example.com',
      subject: 'Paid',
      html: '<p>Paid</p>',
    })
    ;(sendEmail as unknown as vi.Mock).mockResolvedValue({ success: true })
    ;(updateParkingBooking as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-confirm',
      customer_id: null,
      customer_mobile: '+447700900123',
      payment_status: 'paid',
      status: 'confirmed',
    })

    const paymentMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'payment-1',
        status: 'paid',
        booking_id: 'booking-confirm',
        paypal_order_id: 'order-1',
      },
      error: null,
    })
    const paymentLimit = vi.fn().mockReturnValue({ maybeSingle: paymentMaybeSingle })
    const paymentOrder = vi.fn().mockReturnValue({ limit: paymentLimit })
    const paymentIn = vi.fn().mockReturnValue({ order: paymentOrder })
    const paymentEq2 = vi.fn().mockReturnValue({ in: paymentIn })
    const paymentEq1 = vi.fn().mockReturnValue({ eq: paymentEq2 })
    const paymentSelect = vi.fn().mockReturnValue({ eq: paymentEq1 })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'parking_booking_payments') {
          return { select: paymentSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await captureParkingPayment(
      {
        id: 'booking-confirm',
        customer_id: null,
        customer_mobile: '+447700900123',
        payment_status: 'pending',
        status: 'pending',
      } as any,
      'order-1',
      { client: supabase as any }
    )

    expect(error).toHaveBeenCalledWith(
      'Parking payment confirmation SMS sent but outbound message logging failed',
      expect.any(Object)
    )
    expect(logParkingNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-confirm',
        channel: 'sms',
        event_type: 'payment_confirmation',
        status: 'sent',
        payload: expect.objectContaining({
          sms_code: 'logging_failed',
          sms_log_failure: true,
        }),
      }),
      supabase
    )
  })

  it('fails closed when reminder-flag persistence affects no booking rows after successful SMS send', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM123456',
    })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'parking_bookings') {
          return { update }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendParkingPaymentRequest(
      {
        id: 'booking-1',
        customer_id: null,
        customer_mobile: '+447700900123',
      } as any,
      'https://example.com/pay',
      { client: supabase as any }
    )

    expect(result).toEqual({
      sent: true,
      skipped: false,
      code: 'logging_failed',
      logFailure: true,
    })
    expect(updateEq).toHaveBeenCalledWith('id', 'booking-1')
    expect(error).toHaveBeenCalledWith(
      'Parking payment request SMS sent but failed to persist booking reminder flags',
      expect.any(Object)
    )
  })

  it('fails closed when reminder-flag persistence errors after successful SMS send', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM123456',
    })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'booking update unavailable' },
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'parking_bookings') {
          return { update }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await expect(
      sendParkingPaymentRequest(
        {
          id: 'booking-2',
          customer_id: null,
          customer_mobile: '+447700900123',
        } as any,
        'https://example.com/pay',
        { client: supabase as any }
      )
    ).resolves.toEqual({
      sent: true,
      skipped: false,
      code: 'logging_failed',
      logFailure: true,
    })
    expect(error).toHaveBeenCalledWith(
      'Parking payment request SMS sent but failed to persist booking reminder flags',
      expect.any(Object)
    )
  })

  it('surfaces logging_failed when parking notification persistence fails after a successful SMS send', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM123456',
    })

    ;(logParkingNotification as unknown as vi.Mock).mockRejectedValueOnce(new Error('log down'))

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'booking-10' },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'parking_bookings') {
          return { update }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendParkingPaymentRequest(
      {
        id: 'booking-10',
        customer_id: null,
        customer_mobile: '+447700900123',
      } as any,
      'https://example.com/pay',
      { client: supabase as any }
    )

    expect(result).toEqual({
      sent: true,
      skipped: false,
      code: 'logging_failed',
      logFailure: true,
    })
    expect(updateEq).toHaveBeenCalledWith('id', 'booking-10')
    expect(error).toHaveBeenCalledWith(
      'Failed to persist parking payment request notification result',
      expect.any(Object)
    )
  })

  it('propagates thrown logging_failed metadata when sendSMS throws before persistence writes', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValue(
      Object.assign(new Error('message persistence failed in twilio pipeline'), {
        code: 'logging_failed',
      })
    )

    const supabase = {} as any

    const result = await sendParkingPaymentRequest(
      {
        id: 'booking-throw-logging-failed',
        customer_id: null,
        customer_mobile: '+447700900123',
      } as any,
      'https://example.com/pay',
      { client: supabase }
    )

    expect(result).toEqual({
      sent: false,
      skipped: false,
      code: 'logging_failed',
      logFailure: true,
    })
    expect(logParkingNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-throw-logging-failed',
        channel: 'sms',
        event_type: 'payment_request',
        status: 'failed',
      }),
      supabase
    )
  })

  it('fails closed and skips SMS when customer opt-in lookup errors', async () => {
    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'customer lookup unavailable' },
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await sendParkingPaymentRequest(
      {
        id: 'booking-2',
        customer_id: 'customer-1',
        customer_mobile: '+447700900123',
      } as any,
      'https://example.com/pay',
      { client: supabase as any }
    )

    expect(sendSMS).not.toHaveBeenCalled()
    expect(logParkingNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-2',
        channel: 'sms',
        event_type: 'payment_request',
        status: 'skipped',
        payload: expect.objectContaining({ reason: 'Customer SMS eligibility lookup failed' })
      }),
      supabase
    )
  })

  it('fails closed and skips SMS when customer opt-in lookup affects no rows', async () => {
    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await sendParkingPaymentRequest(
      {
        id: 'booking-3',
        customer_id: 'customer-2',
        customer_mobile: '+447700900123',
      } as any,
      'https://example.com/pay',
      { client: supabase as any }
    )

    expect(sendSMS).not.toHaveBeenCalled()
    expect(logParkingNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-3',
        channel: 'sms',
        event_type: 'payment_request',
        status: 'skipped',
        payload: expect.objectContaining({ reason: 'Customer SMS eligibility lookup failed' })
      }),
      supabase
    )
  })
})
