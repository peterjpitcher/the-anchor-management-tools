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
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'jane@example.com',
      subject: 'Refund Confirmation \u2014 The Anchor',
      html: expect.stringContaining('\u00a325.50'),
    })
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
      {}
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
      {}
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
})
