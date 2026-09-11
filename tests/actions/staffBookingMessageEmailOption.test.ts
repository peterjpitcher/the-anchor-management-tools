import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flagOn: true, bohAuth: null as any }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'staff@example.com' } } })) },
    from: (table: string) => state.db.from(table),
  })),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => (key === 'staff_message_email_option' ? state.flagOn : false)),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(async () => undefined),
}))

vi.mock('@/services/audit', () => ({
  AuditService: { logAuditEvent: vi.fn(async () => undefined) },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: vi.fn(async () => state.bohAuth),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email/emailService'
import { messageTableBookingGuests, previewTableBookingGuests } from '@/app/actions/table-booking-messages'
import { POST as postBookingEmail } from '@/app/api/boh/table-bookings/[id]/email/route'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedSendSMS = sendSMS as unknown as Mock
const mockedSendEmail = sendEmail as unknown as Mock

function customer(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    first_name: id.toUpperCase(),
    last_name: 'Guest',
    mobile_e164: null,
    mobile_number: null,
    sms_opt_in: null,
    sms_status: null,
    email: null,
    email_status: null,
    email_deactivated_at: null,
    ...overrides,
  }
}

const TEXTABLE = { mobile_e164: '+447700900001', mobile_number: '+447700900001', sms_opt_in: true, sms_status: 'active' }

function seedDay() {
  state.db = createFakeSupabase({
    customers: [
      customer('both', { ...TEXTABLE, email: 'both@example.com' }),
      customer('textonly', { ...TEXTABLE, mobile_e164: '+447700900002' }),
      customer('emailonly', { email: 'emailonly@example.com' }),
      customer('suppressed', { ...TEXTABLE, mobile_e164: '+447700900003', email: 'gone@example.com' }),
      customer('bounced', { email: 'bounced@example.com', email_status: 'bounced' }),
    ],
    table_bookings: ['both', 'textonly', 'emailonly', 'suppressed', 'bounced'].map((id, index) => ({
      id: `tb-${id}`,
      booking_date: '2026-10-03',
      booking_time: '19:00:00',
      status: 'confirmed',
      customer_id: id,
      booking_reference: `REF${index}`,
    })),
    email_suppressions: [{ email: 'gone@example.com' }],
    email_messages: [],
  })
}

describe('BOH "Message guests" with the email option (P7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    seedDay()
    mockedPermission.mockResolvedValue(true)
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'row-1' })
    mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-1' })
  })

  it('the preview counts who would be emailed and who texted', async () => {
    const result = await previewTableBookingGuests({ date: '2026-10-03' })
    expect(result.data).toMatchObject({
      total: 5,
      eligible: 3,
      emailOption: { emailable: 2, textOnly: 2, reachable: 4 },
    })
  })

  it('emails the guests with a usable address and texts the rest', async () => {
    const result = await messageTableBookingGuests({ date: '2026-10-03', message: 'Hi {{first_name}}, the kitchen opens at 6pm.', channel: 'email_first' })

    expect(result).toMatchObject({ success: true, channel: 'email_first', emailed: 2, sent: 2, failed: 0 })
    const emailed = mockedSendEmail.mock.calls.map((call) => call[0].to).sort()
    expect(emailed).toEqual(['both@example.com', 'emailonly@example.com'])
    const texted = mockedSendSMS.mock.calls.map((call) => call[0]).sort()
    expect(texted).toEqual(['+447700900002', '+447700900003'])
    const email = mockedSendEmail.mock.calls.find((call) => call[0].to === 'both@example.com')[0]
    expect(email).toMatchObject({
      subject: 'A message about your booking at The Anchor',
      commType: 'table_booking_manual_message_email',
      tableBookingId: 'tb-both',
      customerId: 'both',
    })
    expect(email.text).toContain('Hi BOTH, the kitchen opens at 6pm.')
    expect(email.text).toContain('01753 682707')
  })

  it('a failed email falls back to the text where there is one, and counts a failure where there is not', async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })

    const result = await messageTableBookingGuests({ date: '2026-10-03', message: 'Hello', channel: 'email_first' })

    expect(result).toMatchObject({ emailed: 0, sent: 3, failed: 1 })
    expect(mockedSendSMS.mock.calls.map((call) => call[0])).toContain('+447700900001')
  })

  it('"Text only" is exactly today', async () => {
    const result = await messageTableBookingGuests({ date: '2026-10-03', message: 'Hello', channel: 'sms' })
    expect(result).toEqual({ success: true, sent: 3, scheduled: 0, skipped: 0, failed: 0 })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('with the option switched off, an email-first request is sent exactly as today', async () => {
    state.flagOn = false

    const preview = await previewTableBookingGuests({ date: '2026-10-03' })
    const result = await messageTableBookingGuests({ date: '2026-10-03', message: 'Hello', channel: 'email_first' })

    expect(preview.data?.emailOption).toBeUndefined()
    expect(result).toEqual({ success: true, sent: 3, scheduled: 0, skipped: 0, failed: 0 })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('the permission check is unchanged', async () => {
    mockedPermission.mockResolvedValue(false)
    const result = await messageTableBookingGuests({ date: '2026-10-03', message: 'Hello', channel: 'email_first' })
    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedPermission).toHaveBeenCalledWith('messages', 'send_transactional', 'user-1')
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })
})

describe('single-guest email route (P7)', () => {
  const bookingId = '00000000-0000-4000-8000-000000000001'

  function request(body: unknown) {
    return new Request(`http://localhost/api/boh/table-bookings/${bookingId}/email`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as any
  }

  function seedBooking(customerOverrides: Record<string, unknown>) {
    state.db = createFakeSupabase({
      customers: [customer('guest-1', customerOverrides)],
      table_bookings: [{ id: bookingId, booking_reference: 'ABC123', customer_id: 'guest-1' }],
      email_suppressions: [],
      email_messages: [],
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    state.bohAuth = { ok: true, userId: 'user-1', supabase: {} }
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'row-1' })
  })

  it('sends the email and links it to the booking', async () => {
    seedBooking({ email: 'pat@example.com' })

    const response = await postBookingEmail(request({ subject: 'Your table', message: 'We have moved you to the garden.' }), {
      params: Promise.resolve({ id: bookingId }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, data: { channel: 'email' } })
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'pat@example.com',
        subject: 'Your table',
        commType: 'boh_manual_booking_email',
        tableBookingId: bookingId,
      })
    )
  })

  it('keeps the same permission gate as the text route', async () => {
    const { NextResponse } = await import('next/server')
    state.bohAuth = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    seedBooking({ email: 'pat@example.com' })

    const response = await postBookingEmail(request({ subject: 'x', message: 'y' }), { params: Promise.resolve({ id: bookingId }) })

    expect(response.status).toBe(403)
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('refuses a guest with no usable address, and says why', async () => {
    seedBooking({ email: 'pat@example.com', email_status: 'bounced' })
    const response = await postBookingEmail(request({ subject: 'x', message: 'y' }), { params: Promise.resolve({ id: bookingId }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'This guest has no usable email address' })
  })

  it('reports the provider failure rather than success', async () => {
    seedBooking({ email: 'pat@example.com' })
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
    const response = await postBookingEmail(request({ subject: 'x', message: 'y' }), { params: Promise.resolve({ id: bookingId }) })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Resend 500' })
  })

  it('does nothing while the option is switched off', async () => {
    state.flagOn = false
    seedBooking({ email: 'pat@example.com' })
    const response = await postBookingEmail(request({ subject: 'x', message: 'y' }), { params: Promise.resolve({ id: bookingId }) })
    expect(response.status).toBe(409)
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })
})
