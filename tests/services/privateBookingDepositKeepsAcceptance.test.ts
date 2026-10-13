import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * Paying the deposit accepts the contract (SOP section 11), but only when nothing has accepted
 * it already. Until 13 October 2026 a deposit paid after the customer had signed online
 * overwrote that record with "deposit_payment" and the time of the payment, so the booking no
 * longer said the contract had been signed.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => undefined) }))
vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))
vi.mock('@/services/private-bookings/conflicts', () => ({
  getBookingConflictSummary: vi.fn(async () => []),
  getBookingSpaceIds: vi.fn(async () => []),
  findBookingConflicts: vi.fn(async () => []),
  checkCapacity: vi.fn(() => ({ ok: true })),
}))
// The receipt to the guest is not what is under test, and nothing here may send: the one
// messenger every receipt goes through is a stand-in, and so are both transports behind it.
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => true) }))
vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true })),
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/services/sms-queue', () => ({ SmsQueueService: { queueAndSend: vi.fn() } }))

import { logAuditEvent } from '@/app/actions/audit'
import { sendEmail } from '@/lib/email/emailService'
import { finalizeDepositPayment, recordDeposit } from '@/services/private-bookings/payments'
import { SmsQueueService } from '@/services/sms-queue'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const USER = '99999999-9999-4999-8999-999999999999'
const SIGNED_AT = '2026-10-01T10:00:00.000Z'
const SENT_AT = '2026-09-28T09:00:00.000Z'

let db: FakeDb

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    status: 'draft',
    customer_id: 'cust-1',
    customer_first_name: 'Sam',
    customer_last_name: 'Example',
    customer_name: 'Sam Example',
    contact_phone: '+447700900123',
    contact_email: 'sam@example.com',
    event_type: 'Birthday party',
    event_date: '2026-12-05',
    start_time: '18:00:00',
    end_time: '23:00:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: '2026-11-01T23:59:59.000Z',
    deposit_amount: 250,
    deposit_paid_date: null,
    balance_due_date: '2026-11-21',
    total_amount: 1200,
    calendar_event_id: null,
    layout: null,
    risk_status: 'normal',
    contract_sent_at: SENT_AT,
    contract_accepted_at: null,
    contract_acceptance_method: null,
    ...extra,
  }
}

function seed(booking: Row): void {
  db = createFakeDb({ private_bookings: [booking], private_bookings_with_details: [] })
  state.client = db.client
}

function saved(): Row {
  return db.rows('private_bookings')[0]
}

function depositUpdate(): Row {
  const write = db.writes.find((entry) => entry.table === 'private_bookings' && entry.operation === 'update')
  if (!write?.payload) throw new Error('The deposit was not written')
  return write.payload
}

beforeEach(() => {
  vi.clearAllMocks()
  seed(bookingRow())
})

describe('recording a deposit and the contract acceptance', () => {
  it('records acceptance by deposit payment when the contract was sent and nobody has accepted it', async () => {
    const result = await finalizeDepositPayment({ bookingId: BOOKING, amount: 250, method: 'card', performedByUserId: USER }, db.client)

    expect(result.success).toBe(true)
    expect(saved()).toMatchObject({ status: 'confirmed', deposit_payment_method: 'card', contract_acceptance_method: 'deposit_payment' })
    expect(saved().deposit_paid_date).toBeTruthy()
    expect(saved().contract_accepted_at).toBeTruthy()
    expect(Number.isFinite(new Date(String(saved().contract_accepted_at)).getTime())).toBe(true)
  })

  it.each([
    ['a card payment taken by staff', { method: 'card' }],
    ['a PayPal capture', { method: 'paypal', paypalCaptureId: 'CAPTURE-123' }],
  ])('leaves a contract already signed online exactly as it was: %s', async (_label, payment) => {
    seed(bookingRow({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' }))

    const result = await finalizeDepositPayment({ bookingId: BOOKING, amount: 250, performedByUserId: USER, ...payment }, db.client)

    // The money is recorded as usual.
    expect(result.success).toBe(true)
    expect(saved()).toMatchObject({ status: 'confirmed', deposit_payment_method: payment.method })
    expect(saved().deposit_paid_date).toBeTruthy()
    // The first acceptance stands: who signed, and when, is not replaced by the payment.
    expect(saved()).toMatchObject({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' })
    // And the write did not touch either column at all.
    expect(Object.keys(depositUpdate())).not.toContain('contract_accepted_at')
    expect(Object.keys(depositUpdate())).not.toContain('contract_acceptance_method')
  })

  it('keeps the e-signature when staff record the deposit from the booking page', async () => {
    seed(bookingRow({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' }))

    await recordDeposit(BOOKING, 250, 'cash', USER)

    expect(saved().deposit_paid_date).toBeTruthy()
    expect(saved()).toMatchObject({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' })
  })

  it('keeps an earlier acceptance of any kind, not only an e-signature', async () => {
    // The column is free text. This value stands for any route other than the two the app writes.
    seed(bookingRow({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'some_other_route' }))

    await finalizeDepositPayment({ bookingId: BOOKING, amount: 250, method: 'card', performedByUserId: USER }, db.client)

    expect(saved()).toMatchObject({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'some_other_route' })
  })

  it('records no acceptance when the contract was never sent, and flags the payment for review', async () => {
    seed(bookingRow({ contract_sent_at: null }))

    await finalizeDepositPayment({ bookingId: BOOKING, amount: 250, method: 'card', performedByUserId: USER }, db.client)

    expect(saved().deposit_paid_date).toBeTruthy()
    expect(saved()).toMatchObject({ contract_accepted_at: null, contract_acceptance_method: null })
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: BOOKING,
        additional_info: expect.objectContaining({ action: 'compliance_flag', flag: 'payment_received_before_contract_sent' }),
      })
    )
  })

  it('does not record a second acceptance when the deposit is already paid', async () => {
    seed(bookingRow({ deposit_paid_date: '2026-10-02T12:00:00.000Z', contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' }))

    const result = await finalizeDepositPayment({ bookingId: BOOKING, amount: 250, method: 'card', performedByUserId: USER }, db.client)

    expect(result).toEqual({ success: true, alreadyRecorded: true })
    expect(db.writes).toHaveLength(0)
    expect(saved()).toMatchObject({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' })
  })

  it('sends nothing through the real transports', async () => {
    await finalizeDepositPayment({ bookingId: BOOKING, amount: 250, method: 'card', performedByUserId: USER }, db.client)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
  })
})
