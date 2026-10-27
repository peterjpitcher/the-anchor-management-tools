import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

const mockSendEmail = vi.mocked(sendEmail)
const mockSendSMS = vi.mocked(sendSMS)

describe('sendRefundNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should send email when email is available', async () => {
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })

    const result = await sendRefundNotification({
      customerName: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+447700900000',
      amount: 25.5,
    })

    expect(result).toBe('email_sent')
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'jane@example.com',
      // The old subject was "Refund Confirmation", joined to the venue name by a banned em
      // dash, and it named no booking. Copy detail lives in
      // tests/lib/refundNotificationCopy.test.ts.
      subject: 'Refund of \u00a325.50 from The Anchor',
      html: expect.stringContaining('\u00a325.50'),
      requireLog: true,
      commType: 'refund_confirmation',
    }))
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('should fall back to SMS when email fails', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'Graph error' })
    mockSendSMS.mockResolvedValue({ success: true } as ReturnType<typeof sendSMS> extends Promise<infer R> ? R : never)

    const result = await sendRefundNotification({
      customerName: 'John Doe',
      email: 'john@example.com',
      phone: '+447700900001',
      amount: 10.0,
    })

    expect(result).toBe('sms_sent')
    expect(mockSendEmail).toHaveBeenCalled()
    expect(mockSendSMS).toHaveBeenCalledWith(
      '+447700900001',
      expect.stringContaining('\u00a310.00'),
      { metadata: expect.objectContaining({ template_key: 'refund_confirmation' }) }
    )
  })

  it('should fall back to SMS when no email provided', async () => {
    mockSendSMS.mockResolvedValue({ success: true } as ReturnType<typeof sendSMS> extends Promise<infer R> ? R : never)

    const result = await sendRefundNotification({
      customerName: 'Alice',
      email: null,
      phone: '+447700900002',
      amount: 50.0,
    })

    expect(result).toBe('sms_sent')
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockSendSMS).toHaveBeenCalledWith(
      '+447700900002',
      expect.stringContaining('\u00a350.00'),
      { metadata: expect.objectContaining({ template_key: 'refund_confirmation' }) }
    )
  })

  it('should return skipped when no contact info', async () => {
    const result = await sendRefundNotification({
      customerName: 'Bob',
      email: null,
      phone: null,
      amount: 15.0,
    })

    expect(result).toBe('skipped')
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('should return failed when both channels fail', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'Graph error' })
    mockSendSMS.mockResolvedValue({ success: false, error: 'Twilio error' } as ReturnType<typeof sendSMS> extends Promise<infer R> ? R : never)

    const result = await sendRefundNotification({
      customerName: 'Charlie',
      email: 'charlie@example.com',
      phone: '+447700900003',
      amount: 100.0,
    })

    expect(result).toBe('failed')
    expect(mockSendEmail).toHaveBeenCalled()
    expect(mockSendSMS).toHaveBeenCalled()
  })

  // BK-170: the text fallback carries a template key and the booking, so a retried notice is sent
  // once, the event and booking kill switch sees a table booking text, and it reaches the timeline.
  it('texts with the template key, the booking and the refund it is for', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'Resend error' })
    mockSendSMS.mockResolvedValue({ success: true } as ReturnType<typeof sendSMS> extends Promise<infer R> ? R : never)

    await sendRefundNotification({
      customerId: 'cust-1',
      customerName: 'Sam Guest',
      email: 'sam@example.com',
      phone: '+447700900003',
      amount: 40,
      context: { subject: 'table_booking', bookingDate: '2026-11-20', reference: 'TB-1' },
      tableBookingId: 'tb-1',
      refundId: 'refund-row-1',
    })

    expect(mockSendSMS).toHaveBeenCalledWith('+447700900003', expect.any(String), {
      metadata: {
        template_key: 'refund_confirmation',
        table_booking_id: 'tb-1',
        stage: 'refund:refund-row-1',
        refund_subject: 'table_booking',
      },
    })
  })

  it('always texts the number the caller passed, never one looked up from a customer record', async () => {
    mockSendSMS.mockResolvedValue({ success: true } as ReturnType<typeof sendSMS> extends Promise<infer R> ? R : never)

    await sendRefundNotification({
      customerId: null,
      customerName: 'Pat Contact',
      email: null,
      phone: '+447700900004',
      amount: 250,
      context: { subject: 'private_booking' },
      privateBookingId: 'pb-1',
    })

    const [to, , options] = mockSendSMS.mock.calls[0]
    expect(to).toBe('+447700900004')
    // No customer id is handed over, so sendSMS resolves the customer from this number and can
    // never refuse it as a mismatch or send it elsewhere.
    expect(options).not.toHaveProperty('customerId')
    expect(options?.metadata).toMatchObject({ template_key: 'refund_confirmation', private_booking_id: 'pb-1' })
  })
})
