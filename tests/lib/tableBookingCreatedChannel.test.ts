import { beforeEach, describe, expect, it, vi } from 'vitest'

// The website names the channel on its confirmation screen from notification_channel
// ("We've sent confirmation details by email."). With email first, the first channel selected is
// email even when the email failed and the text went instead, so the channel reported must be
// the one that reached the guest.

const { notifyCustomer } = vi.hoisted(() => ({ notifyCustomer: vi.fn() }))

vi.mock('@/lib/notifications/notify', () => ({ notifyCustomer }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
  isCustomerSmsSendAllowed: vi.fn().mockResolvedValue({ allowed: true }),
}))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((value: string) => value) }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn().mockResolvedValue(undefined) } }))

import { sendTableBookingCreatedSmsIfAllowed } from '@/lib/table-bookings/bookings'

function supabaseWithCustomer() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'customer-1', first_name: 'Pat', mobile_number: '+447700900123', sms_status: 'active' },
    error: null,
  })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  return {
    from: vi.fn((table: string) => {
      if (table === 'customers') return { select }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

async function send() {
  return sendTableBookingCreatedSmsIfAllowed(supabaseWithCustomer() as any, {
    customerId: 'customer-1',
    normalizedPhone: '+447700900123',
    bookingResult: {
      state: 'pending_card_capture',
      status: 'pending_card_capture',
      table_booking_id: 'table-booking-1',
      start_datetime: '2026-10-24T18:30:00.000Z',
      party_size: 2,
    } as any,
    nextStepUrl: 'https://example.com/card',
  })
}

describe('the channel a new table booking reports to the website', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the text when the email failed and the text went instead', async () => {
    notifyCustomer.mockResolvedValueOnce({
      selectedChannels: ['email', 'sms'],
      attempts: [
        { channel: 'email', success: false, error: 'Resend refused' },
        { channel: 'sms', success: true, scheduledFor: null },
      ],
      finalStatus: 'sent',
      sentChannel: 'sms',
      fallbackUsed: true,
    })

    expect((await send()).notificationChannel).toBe('sms')
  })

  it('reports the email when the email went', async () => {
    notifyCustomer.mockResolvedValueOnce({
      selectedChannels: ['email'],
      attempts: [{ channel: 'email', success: true }],
      finalStatus: 'sent',
      sentChannel: 'email',
      fallbackUsed: false,
    })

    expect((await send()).notificationChannel).toBe('email')
  })

  it('keeps the first channel selected when nothing is known to have gone, as before', async () => {
    notifyCustomer.mockResolvedValueOnce({
      selectedChannels: ['email', 'sms'],
      attempts: [
        { channel: 'email', success: false, error: 'Resend refused' },
        { channel: 'sms', success: false, code: 'twilio_error', error: 'Twilio refused' },
      ],
      finalStatus: 'failed',
      sentChannel: null,
      fallbackUsed: false,
    })

    expect((await send()).notificationChannel).toBe('email')
  })
})
