import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flagOn: true, user: { id: 'user-1', email: 'staff@example.com' } as any }))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: state.user } })) },
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  createSimplePayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => (key === 'staff_message_email_option' ? state.flagOn : false)),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { sendEmail } from '@/lib/email/emailService'
import { sendPrivateBookingEmail } from '@/app/actions/privateBookingActions'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedSendEmail = sendEmail as unknown as Mock

function seed(booking: Record<string, unknown> = {}) {
  state.db = createFakeSupabase({
    private_bookings: [{ id: 'booking-1', customer_id: 'customer-1', contact_email: 'host@example.com', ...booking }],
    customers: [{ id: 'customer-1', email: 'alex@example.com', email_status: null, email_deactivated_at: null }],
    email_suppressions: [],
    private_booking_audit: [],
  })
}

describe('sendPrivateBookingEmail (P7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    seed()
    mockedPermission.mockResolvedValue(true)
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'row-1' })
  })

  it("emails the booking's contact address, logs it against the booking and puts it on the timeline", async () => {
    const result = await sendPrivateBookingEmail('booking-1', '  Your menu  ', '  We have your choices.  ')

    expect(result).toEqual({ success: true })
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'host@example.com',
        subject: 'Your menu',
        commType: 'private_booking_manual_email',
        privateBookingId: 'booking-1',
        customerId: 'customer-1',
      })
    )
    expect(mockedSendEmail.mock.calls[0][0].text).toContain('We have your choices.')
    expect(state.db.tables.private_booking_audit).toEqual([
      expect.objectContaining({
        booking_id: 'booking-1',
        action: 'email_sent',
        performed_by: 'user-1',
        metadata: expect.objectContaining({ subject: 'Your menu', recipient_source: 'contact_email', email_message_id: 'row-1' }),
      }),
    ])
  })

  it('keeps the text permission: private_bookings send or manage', async () => {
    mockedPermission.mockResolvedValue(false)
    const result = await sendPrivateBookingEmail('booking-1', 'Subject', 'Body')
    expect(result).toEqual({ error: 'You do not have permission to send messages for private bookings' })
    expect(mockedPermission).toHaveBeenCalledWith('private_bookings', 'send')
    expect(mockedPermission).toHaveBeenCalledWith('private_bookings', 'manage')
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('refuses when there is no usable address, and says so', async () => {
    seed({ contact_email: null })
    state.db.tables.customers[0].email = null
    const result = await sendPrivateBookingEmail('booking-1', 'Subject', 'Body')
    expect(result).toEqual({ error: 'This booking has no usable email address' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('returns the provider error for the toast', async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
    const result = await sendPrivateBookingEmail('booking-1', 'Subject', 'Body')
    expect(result).toEqual({ error: 'Resend 500' })
    expect(state.db.tables.private_booking_audit).toEqual([])
  })

  it('does nothing while the option is switched off', async () => {
    state.flagOn = false
    const result = await sendPrivateBookingEmail('booking-1', 'Subject', 'Body')
    expect(result).toEqual({ error: 'Emailing guests from here is switched off' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })
})
