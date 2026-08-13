import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resendSend = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return {
    emails: {
      send: resendSend,
    },
    }
  }),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(() => false),
}))

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: vi.fn(),
  },
}))

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn(),
}))

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient,
}))

function mockAdminClient(options?: { suppressed?: boolean }) {
  const suppressionMaybeSingle = vi.fn().mockResolvedValue({
    data: options?.suppressed ? { email: 'guest@example.com' } : null,
    error: null,
  })
  const suppressionEq = vi.fn().mockReturnValue({ maybeSingle: suppressionMaybeSingle })
  const suppressionSelect = vi.fn().mockReturnValue({ eq: suppressionEq })

  const emailLogMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'email-log-1' }, error: null })
  const emailLogSelect = vi.fn().mockReturnValue({ maybeSingle: emailLogMaybeSingle })
  const emailLogInsert = vi.fn().mockReturnValue({ select: emailLogSelect })
  // A send that carries a provider id is logged with upsert rather than insert, so a retry
  // the provider deduplicated maps back onto the same row instead of claiming a second send.
  const emailLogUpsert = vi.fn().mockReturnValue({ select: emailLogSelect })

  createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'email_suppressions') {
        return { select: suppressionSelect }
      }
      if (table === 'email_messages') {
        return { insert: emailLogInsert, upsert: emailLogUpsert }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })

  return { emailLogInsert, emailLogUpsert }
}

describe('sendEmail Resend provider', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
    process.env.EMAIL_REPLY_TO = 'manager@the-anchor.pub'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('maps the existing email options contract to Resend and returns the message id', async () => {
    const { emailLogUpsert } = mockAdminClient()
    resendSend.mockResolvedValue({
      data: { id: 'resend-email-1' },
      error: null,
    })

    const { sendEmail } = await import('@/lib/email/emailService')
    const result = await sendEmail({
      to: 'guest@example.com',
      subject: 'Booking confirmed',
      html: '<p>Hello</p>',
      text: 'Hello',
      cc: ['cc@example.com'],
      attachments: [
        {
          name: 'booking.pdf',
          content: Buffer.from('pdf-bytes'),
          contentType: 'application/pdf',
        },
      ],
      commType: 'table_booking_confirmed',
      customerId: 'customer-1',
      tableBookingId: 'table-booking-1',
    })

    expect(result).toEqual({ success: true, messageId: 'resend-email-1', emailMessageId: 'email-log-1' })
    expect(resendSend).toHaveBeenCalledWith(expect.objectContaining({
      from: 'The Anchor <noreply@auth.orangejelly.co.uk>',
      to: 'guest@example.com',
      subject: 'Booking confirmed',
      html: '<p>Hello</p>',
      text: 'Hello',
      cc: ['cc@example.com'],
      replyTo: 'manager@the-anchor.pub',
      attachments: [
        {
          filename: 'booking.pdf',
          content: Buffer.from('pdf-bytes').toString('base64'),
          contentType: 'application/pdf',
        },
      ],
    }))
    expect(emailLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'customer-1',
        to_address: 'guest@example.com',
        resend_message_id: 'resend-email-1',
        status: 'sent',
        comm_type: 'table_booking_confirmed',
        table_booking_id: 'table-booking-1',
      }),
      { onConflict: 'resend_message_id' },
    )
  })

  it('uses Resend automatically when Resend credentials are configured', async () => {
    delete process.env.EMAIL_PROVIDER
    mockAdminClient()
    resendSend.mockResolvedValue({
      data: { id: 'resend-email-auto' },
      error: null,
    })

    const { sendEmail } = await import('@/lib/email/emailService')
    const result = await sendEmail({
      to: 'guest@example.com',
      subject: 'Automatic provider',
      text: 'Hello',
    })

    expect(result).toEqual({ success: true, messageId: 'resend-email-auto', emailMessageId: 'email-log-1' })
    expect(resendSend).toHaveBeenCalledWith(expect.objectContaining({
      from: 'The Anchor <noreply@auth.orangejelly.co.uk>',
      to: 'guest@example.com',
      subject: 'Automatic provider',
    }))
  })

  it('handles Resend SDK non-throwing errors as failed sends', async () => {
    mockAdminClient()
    resendSend.mockResolvedValue({
      data: null,
      error: { message: 'invalid from address' },
    })

    const { sendEmail } = await import('@/lib/email/emailService')
    const result = await sendEmail({
      to: 'guest@example.com',
      subject: 'Hello',
      text: 'Hello',
    })

    expect(result).toEqual({ success: false, error: 'invalid from address' })
  })

  it('passes an idempotency key to Resend when supplied', async () => {
    mockAdminClient()
    resendSend.mockResolvedValue({
      data: { id: 'resend-email-idempotent' },
      error: null,
    })

    const { sendEmail } = await import('@/lib/email/emailService')
    const result = await sendEmail({
      to: 'manager@example.com',
      subject: 'Checklist alert',
      text: 'Alert',
      idempotencyKey: 'checklist:outbox-1',
    })

    expect(result).toEqual({ success: true, messageId: 'resend-email-idempotent', emailMessageId: 'email-log-1' })
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'manager@example.com',
        subject: 'Checklist alert',
      }),
      { idempotencyKey: 'checklist:outbox-1' },
    )
  })

  it('short-circuits suppressed recipients before calling Resend', async () => {
    mockAdminClient({ suppressed: true })

    const { sendEmail } = await import('@/lib/email/emailService')
    const result = await sendEmail({
      to: 'guest@example.com',
      subject: 'Hello',
      text: 'Hello',
    })

    expect(result).toEqual({ success: false, error: 'Recipient email address is suppressed' })
    expect(resendSend).not.toHaveBeenCalled()
  })
})
