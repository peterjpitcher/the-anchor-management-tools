import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, depositConfirmation: true }))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    ...state.db,
    from: (table: string) => state.db.from(table),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'manager@example.com' } } })) },
  })),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) =>
    key === 'private_booking_deposit_confirmation' ? state.depositConfirmation : false
  ),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  createSimplePayPalOrder: vi.fn(async () => ({ orderId: 'order-1', approveUrl: 'https://paypal.example/approve' })),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))

vi.mock('@/lib/email/private-booking-emails', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email/private-booking-emails')>('@/lib/email/private-booking-emails')
  return {
    ...actual,
    sendDepositPaymentLinkEmail: vi.fn(async () => ({ sent: true })),
    sendBookingCalendarInvite: vi.fn(async () => undefined),
  }
})

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(async () => undefined),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/services/sms-queue', async () => {
  const actual = await vi.importActual<typeof import('@/services/sms-queue')>('@/services/sms-queue')
  return {
    shouldAutoSendPrivateBookingSms: actual.shouldAutoSendPrivateBookingSms,
    SmsQueueService: { queueAndSend: vi.fn() },
  }
})

import { createSimplePayPalOrder } from '@/lib/paypal'
import { sendDepositPaymentLinkEmail } from '@/lib/email/private-booking-emails'
import { sendEmail } from '@/lib/email/emailService'
import { SmsQueueService } from '@/services/sms-queue'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { confirmPrivateBookingDeposit, sendDepositPaymentLink } from '@/app/actions/privateBookingActions'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock
const mockedPermission = checkUserPermission as unknown as Mock

const BOOKING_ID = '11111111-2222-4333-8444-555555555555'

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    contact_email: 'host@example.com',
    event_date: '2026-10-31',
    event_type: 'Birthday party',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    deposit_confirmed_at: null,
    ...overrides,
  }
}

function seed(row: Record<string, unknown>) {
  state.db = createFakeSupabase({
    private_bookings: [
      {
        customer_last_name: 'Smith',
        contact_phone: '+447700900123',
        start_time: '19:00:00',
        end_time: '23:30:00',
        end_time_next_day: false,
        guest_count: 40,
        date_tbd: false,
        internal_notes: null,
        hold_expiry: null,
        balance_due_date: '2026-10-17',
        final_payment_date: null,
        setup_date: null,
        setup_time: null,
        ...row,
      },
    ],
    customers: [{ id: 'customer-1', email: null, email_status: null, email_deactivated_at: null, mobile_number: '+447700900123' }],
    email_suppressions: [],
    notification_deliveries: [],
    notification_attempts: [],
    private_booking_audit: [],
  })
}

describe('Confirm deposit, the action staff press', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // 10:00 in London on 11 September 2026, so the deadline is always 25 September.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T09:00:00.000Z'))
    state.depositConfirmation = true
    mockedPermission.mockImplementation(async () => true)
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1' })
  })

  it('confirms, emails the request and tells staff how it went', async () => {
    seed(booking())

    const result = await confirmPrivateBookingDeposit(BOOKING_ID, { amount: '250' })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ status: 'sent', channel: 'email' })
    expect(result.data?.message).toBe('Deposit confirmed at £250, due by 25 September 2026. The deposit request was emailed to the guest.')
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(state.db.tables.private_bookings[0].deposit_confirmed_by).toBe('user-1')
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        resource_type: 'private_booking',
        resource_id: BOOKING_ID,
        operation_status: 'success',
        additional_info: expect.objectContaining({ action: 'confirm_deposit', outcome: 'sent', channel: 'email', amount: 250 }),
      })
    )
  })

  it('shows the failure when the email and the text both fail, and nothing is left confirmed', async () => {
    seed(booking())
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 503' })
    mockedQueueAndSend.mockResolvedValue({ error: 'Twilio 500' })

    const result = await confirmPrivateBookingDeposit(BOOKING_ID, { amount: 250 })

    expect(result.success).toBeUndefined()
    expect(result.error).toBe(
      "Nothing was sent: the email failed (Resend 503) and the text failed too (Twilio 500). The deposit is still to be confirmed. Check the guest's email address and mobile number, then confirm again."
    )
    expect(state.db.tables.private_bookings[0].deposit_confirmed_at).toBeNull()
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure' }))
  })

  it('shows the failure when the database is down, and sends nothing', async () => {
    seed(booking())
    state.db.failures.push({ table: 'private_bookings', op: 'select', error: { code: '08006', message: 'connection failure' } })

    const result = await confirmPrivateBookingDeposit(BOOKING_ID, { amount: 250 })

    expect(result.error).toBe('The booking could not be loaded, so nothing was sent. Please try again.')
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('a double click: one request, and the second click is told it was already done', async () => {
    seed(booking())

    const [first, second] = await Promise.all([
      confirmPrivateBookingDeposit(BOOKING_ID, { amount: 250 }),
      confirmPrivateBookingDeposit(BOOKING_ID, { amount: 250 }),
    ])

    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect([first.data?.status, second.data?.status].sort()).toEqual(['already_confirmed', 'sent'])
  })

  it('is refused without the permission that governs deposits', async () => {
    seed(booking())
    mockedPermission.mockImplementation(async () => false)

    const result = await confirmPrivateBookingDeposit(BOOKING_ID, { amount: 250 })

    expect(result.error).toBe('You do not have permission to confirm deposits')
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('is refused while the flag is off: nothing changes and nothing is sent', async () => {
    state.depositConfirmation = false
    seed(booking())

    const result = await confirmPrivateBookingDeposit(BOOKING_ID, { amount: 250 })

    expect(result.error).toBe('Deposit confirmation is switched off, so nothing was sent.')
    expect(state.db.tables.private_bookings[0].deposit_confirmed_at).toBeNull()
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('a reduction below £250 needs the General Manager override and a reason', async () => {
    seed(booking())
    mockedPermission.mockImplementation(async (_module: string, action: string) => action !== 'gm_override')
    expect((await confirmPrivateBookingDeposit(BOOKING_ID, { amount: 100, reductionReason: 'Regular' })).error).toBe(
      'Deposit reductions need General Manager override permission'
    )

    mockedPermission.mockImplementation(async () => true)
    expect((await confirmPrivateBookingDeposit(BOOKING_ID, { amount: 100 })).error).toBe(
      'Reducing the deposit below £250 requires a reason (General Manager discretion)'
    )
    expect(mockedSendEmail).not.toHaveBeenCalled()

    const allowed = await confirmPrivateBookingDeposit(BOOKING_ID, { amount: 100, reductionReason: 'Regular corporate client' })
    expect(allowed.data?.status).toBe('sent')
    expect(state.db.tables.private_bookings[0].deposit_amount).toBe(100)
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        additional_info: expect.objectContaining({ deposit_reduced_to: 100, deposit_reduction_reason: 'Regular corporate client' }),
      })
    )
  })

  it.each([['0'], ['-5'], ['abc'], ['12.345']])('rejects the amount %s before anything happens', async (amount) => {
    seed(booking())
    const result = await confirmPrivateBookingDeposit(BOOKING_ID, { amount })
    expect(result.error).toBeTruthy()
    expect(state.db.tables.private_bookings[0].deposit_confirmed_at).toBeNull()
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })
})

describe('Send payment link while the deposit is to be confirmed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.depositConfirmation = true
  })

  it('is refused, so the guest hears about a deposit only through Confirm deposit', async () => {
    seed(booking())

    const result = await sendDepositPaymentLink(BOOKING_ID)

    expect(result.error).toContain('Confirm the deposit first')
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
    expect(sendDepositPaymentLinkEmail).not.toHaveBeenCalled()
  })

  it('goes as before once the deposit is confirmed', async () => {
    seed(booking({ deposit_confirmed_at: '2026-09-11T10:00:00.000Z' }))

    const result = await sendDepositPaymentLink(BOOKING_ID)

    expect(result).toEqual({ success: true })
    expect(sendDepositPaymentLinkEmail).toHaveBeenCalledTimes(1)
  })

  it('goes exactly as today with the flag off', async () => {
    state.depositConfirmation = false
    seed(booking())

    const result = await sendDepositPaymentLink(BOOKING_ID)

    expect(result).toEqual({ success: true })
    expect(sendDepositPaymentLinkEmail).toHaveBeenCalledTimes(1)
  })
})
