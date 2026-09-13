import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyCustomer } from '../notify'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import {
  isCustomerSmsSendAllowed,
  isCustomerWhatsAppSendAllowed,
  sendSMS,
  sendWhatsApp,
} from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { reportCronFailure } from '@/lib/cron/alerting'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(),
}))

vi.mock('@/lib/email/logging', () => ({
  isEmailSuppressed: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  isCustomerSmsSendAllowed: vi.fn(),
  isCustomerWhatsAppSendAllowed: vi.fn(),
  sendSMS: vi.fn(),
  sendWhatsApp: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function buildAuditDbMock() {
  const chain: Record<string, any> = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.insert = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'delivery-1' }, error: null })
  chain.update = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockResolvedValue({ data: null, error: null })
  return chain
}

const customer = {
  id: 'customer-1',
  email: 'guest@example.com',
  mobile_e164: '+447700900001',
  mobile_number: '+447700900001',
  sms_status: 'active',
  sms_opt_in: true,
  whatsapp_status: 'active',
  whatsapp_opt_in: true,
}

describe('notifyCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createAdminClient).mockReturnValue(buildAuditDbMock() as any)
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true })
    vi.mocked(isCustomerWhatsAppSendAllowed).mockResolvedValue({ allowed: true })
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' })
    vi.mocked(sendWhatsApp).mockResolvedValue({ success: true, sid: 'wa-1' })
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'sms-1' })
  })

  it('stops the cascade after a successful email for both policy', async () => {
    const result = await notifyCustomer({
      policy: 'both',
      urgency: 'standard',
      customer,
      email: {
        to: customer.email,
        subject: 'Booking confirmed',
        text: 'Confirmed',
        commType: 'ad_hoc',
      },
      whatsapp: {
        body: 'Confirmed',
        options: { templateKey: 'booking_confirmed' },
      },
      sms: {
        body: 'Confirmed',
      },
    })

    expect(result.attempts).toEqual([
      expect.objectContaining({ channel: 'email', success: true }),
    ])
    expect(sendWhatsApp).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('passes WhatsApp template metadata into eligibility checks', async () => {
    await notifyCustomer({
      policy: 'both',
      urgency: 'standard',
      customer,
      whatsapp: {
        body: 'Confirmed',
        options: {
          metadata: { template_key: 'event_booking_confirmed' },
        },
      },
    })

    expect(isCustomerWhatsAppSendAllowed).toHaveBeenCalledWith(
      customer.id,
      customer.mobile_e164,
      {
        marketing: false,
        templateKey: 'event_booking_confirmed',
      }
    )
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
  })
})

describe('notifyCustomer email first, with SMS as the fallback', () => {
  let auditDb: ReturnType<typeof buildAuditDbMock>

  beforeEach(() => {
    vi.clearAllMocks()
    auditDb = buildAuditDbMock()
    vi.mocked(createAdminClient).mockReturnValue(auditDb as any)
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true })
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' })
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'sms-1' })
  })

  // A table booking cancellation, the shape P3 will send: the routing matrix sends
  // table_booking_* to email, then WhatsApp, then SMS, and WhatsApp is not offered here.
  function cancellationNotice(overrides: { customer?: Record<string, unknown>; idempotencyKey?: string } = {}) {
    return notifyCustomer({
      policy: 'email_first',
      urgency: 'standard',
      category: 'transactional',
      customer: { ...customer, ...overrides.customer },
      email: {
        to: (overrides.customer?.email as string | undefined) ?? customer.email,
        subject: 'Your booking has been cancelled',
        text: 'Cancelled',
        commType: 'table_booking_cancelled',
        tableBookingId: 'booking-1',
        ...(overrides.idempotencyKey ? { idempotencyKey: overrides.idempotencyKey } : {}),
      },
      sms: {
        body: 'The Anchor: your booking has been cancelled.',
        options: { metadata: { template_key: 'table_booking_cancelled' } },
      },
    })
  }

  function attemptRows() {
    return auditDb.insert.mock.calls
      .map(([row]) => row as Record<string, any>)
      .filter(row => 'attempt_order' in row)
  }

  function finalDeliveryUpdate() {
    return auditDb.update.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
  }

  it('sends the SMS when the email provider fails, and records both attempts', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 503: service unavailable' })

    const result = await cancellationNotice()

    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(result.attempts).toEqual([
      expect.objectContaining({ channel: 'email', success: false, error: 'Resend 503: service unavailable' }),
      expect.objectContaining({ channel: 'sms', success: true, messageId: 'sms-1' }),
    ])
    expect(result).toEqual(expect.objectContaining({
      finalStatus: 'sent',
      sentChannel: 'sms',
      fallbackUsed: true,
    }))

    expect(attemptRows()).toEqual([
      expect.objectContaining({ channel: 'email', attempt_order: 1, status: 'failed', error: 'Resend 503: service unavailable' }),
      expect.objectContaining({ channel: 'sms', attempt_order: 2, status: 'sent', twilio_message_sid: 'sms-1' }),
    ])
    expect(finalDeliveryUpdate()).toEqual(expect.objectContaining({ selected_channel: 'sms', final_status: 'sent' }))
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('counts an email the provider accepted as sent when only its log row failed: no SMS, and an alert', async () => {
    vi.mocked(sendEmail).mockResolvedValue({
      success: false,
      error: 'Email sent state could not be logged',
      messageId: 'resend-accepted-1',
      emailMessageId: null,
    })

    const result = await cancellationNotice()

    expect(sendSMS).not.toHaveBeenCalled()
    expect(result.attempts).toEqual([
      expect.objectContaining({
        channel: 'email',
        success: true,
        logFailure: true,
        messageId: 'resend-accepted-1',
      }),
    ])
    expect(result).toEqual(expect.objectContaining({
      finalStatus: 'sent',
      sentChannel: 'email',
      fallbackUsed: false,
    }))

    expect(attemptRows()).toEqual([
      expect.objectContaining({
        channel: 'email',
        status: 'sent',
        resend_message_id: 'resend-accepted-1',
        raw_payload: expect.objectContaining({ log_failure: true }),
      }),
    ])
    expect(finalDeliveryUpdate()).toEqual(expect.objectContaining({ selected_channel: 'email', final_status: 'sent' }))

    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    const [alertName, alertError, alertContext] = vi.mocked(reportCronFailure).mock.calls[0]
    expect(alertName).toBe('notify-customer')
    expect(String((alertError as Error).message)).toContain('Email sent state could not be logged')
    expect(alertContext).toEqual(expect.objectContaining({
      template_key: 'table_booking_cancelled',
      delivery_id: 'delivery-1',
      customer_id: 'customer-1',
      provider_message_id: 'resend-accepted-1',
    }))
    // The alert identifies the send without carrying the guest's contact details.
    expect(JSON.stringify(alertContext)).not.toContain(customer.email)
    expect(JSON.stringify(alertContext)).not.toContain(customer.mobile_e164)
  })

  it('still reports the email as sent when raising the alert throws', async () => {
    vi.mocked(sendEmail).mockResolvedValue({
      success: false,
      error: 'Email sent state could not be logged',
      messageId: 'resend-accepted-2',
    })
    vi.mocked(reportCronFailure).mockRejectedValueOnce(new Error('alert transport down'))

    const result = await cancellationNotice()

    expect(sendSMS).not.toHaveBeenCalled()
    expect(result.finalStatus).toBe('sent')
    expect(result.sentChannel).toBe('email')
  })

  it('reports failure with both errors when email and SMS both fail', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'invalid from address' })
    vi.mocked(sendSMS).mockResolvedValue({
      success: false,
      error: 'SMS sending paused by safety guard',
      code: 'global_rate_limit',
    })

    const result = await cancellationNotice()

    expect(result).toEqual(expect.objectContaining({
      finalStatus: 'failed',
      sentChannel: null,
      fallbackUsed: false,
    }))
    expect(result.attempts).toEqual([
      expect.objectContaining({ channel: 'email', success: false, error: 'invalid from address' }),
      expect.objectContaining({
        channel: 'sms',
        success: false,
        error: 'SMS sending paused by safety guard',
        code: 'global_rate_limit',
      }),
    ])
    expect(attemptRows()).toEqual([
      expect.objectContaining({ channel: 'email', status: 'failed', error: 'invalid from address' }),
      expect.objectContaining({ channel: 'sms', status: 'failed', error: 'SMS sending paused by safety guard' }),
    ])
    expect(finalDeliveryUpdate()).toEqual(expect.objectContaining({ selected_channel: null, final_status: 'failed' }))
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('falls back to SMS when the email kill switch refuses the send, and records the code', async () => {
    vi.mocked(sendEmail).mockResolvedValue({
      success: false,
      error: 'Email sending is currently suspended',
      code: 'email_suspended',
    })

    const result = await cancellationNotice()

    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      channel: 'email',
      success: false,
      code: 'email_suspended',
    }))
    expect(result).toEqual(expect.objectContaining({ finalStatus: 'sent', sentChannel: 'sms', fallbackUsed: true }))
    expect(attemptRows()[0]).toEqual(expect.objectContaining({
      channel: 'email',
      status: 'failed',
      raw_payload: expect.objectContaining({ code: 'email_suspended' }),
    }))
  })

  it('passes the idempotency key through to sendEmail', async () => {
    await cancellationNotice({ idempotencyKey: 'table_booking_cancelled:booking-1' })

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: customer.email,
      idempotencyKey: 'table_booking_cancelled:booking-1',
      requireLog: true,
    }))
  })

  it('goes straight to SMS for a bounced address, which is not a fallback', async () => {
    const result = await cancellationNotice({ customer: { email_status: 'bounced' } })

    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({ finalStatus: 'sent', sentChannel: 'sms', fallbackUsed: false }))
  })

  function deliveryInsert() {
    return auditDb.insert.mock.calls
      .map(([row]) => row as Record<string, any>)
      .find(row => 'template_key' in row)
  }

  it('writes the delivery row with only the channel flags when the caller adds no metadata', async () => {
    await cancellationNotice()

    expect(deliveryInsert()?.metadata).toEqual({ has_email: true, has_whatsapp: false, has_sms: true })
  })

  it('writes the caller\'s delivery metadata on the row when it is created, before anything is sent', async () => {
    let metadataWhenEmailWent: unknown = null
    vi.mocked(sendEmail).mockImplementation(async () => {
      metadataWhenEmailWent = deliveryInsert()?.metadata ?? null
      return { success: true, messageId: 'email-1' }
    })

    await notifyCustomer({
      policy: 'email_first',
      urgency: 'standard',
      category: 'transactional',
      customer,
      delayedFallbackAllowed: true,
      deliveryMetadata: {
        table_booking_id: 'booking-1',
        booking_facts: { booking_date: '2026-10-24', party_size: 4 },
        // A caller cannot overwrite the channel flags.
        has_sms: false,
      },
      email: { to: customer.email, subject: 'Cancelled', text: 'Cancelled', commType: 'table_booking_cancelled' },
      sms: { body: 'Cancelled', options: { metadata: { template_key: 'table_booking_cancelled' } } },
    })

    const expected = {
      table_booking_id: 'booking-1',
      booking_facts: { booking_date: '2026-10-24', party_size: 4 },
      has_email: true,
      has_whatsapp: false,
      has_sms: true,
    }
    expect(deliveryInsert()).toEqual(expect.objectContaining({ delayed_fallback_allowed: true, metadata: expected }))
    expect(metadataWhenEmailWent).toEqual(expected)
  })

  it('reports no_channel when neither channel can be used', async () => {
    vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: false, reason: 'sms_opted_out' } as any)

    const result = await cancellationNotice({ customer: { email: 'not-an-address' } })

    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      finalStatus: 'no_channel',
      sentChannel: null,
      fallbackUsed: false,
      noChannelReason: 'no_channel_available',
    }))
    expect(finalDeliveryUpdate()).toEqual(expect.objectContaining({ final_status: 'no_channel' }))
  })
})
