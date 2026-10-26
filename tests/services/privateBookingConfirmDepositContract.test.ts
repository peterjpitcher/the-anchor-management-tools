import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Review BK-006, owner decision D25: every deposit request told the guest that paying the deposit
 * accepts the terms "set out in your contract", but Confirm deposit neither sent nor checked for a
 * contract, and four of the six upcoming confirmed hires had none. Confirm deposit now sends the
 * contract for signature, through the shared signing feature, in the same action and before the
 * deposit request, so the request is true when it says so.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => undefined) }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/services/sms-queue', async () => {
  const actual = await vi.importActual<typeof import('@/services/sms-queue')>('@/services/sms-queue')
  return {
    shouldAutoSendPrivateBookingSms: actual.shouldAutoSendPrivateBookingSms,
    SmsQueueService: { queueAndSend: vi.fn() },
  }
})

import { sendEmail } from '@/lib/email/emailService'
import { SmsQueueService } from '@/services/sms-queue'
import { confirmDeposit, DepositConfirmationError } from '@/services/private-bookings/deposit-confirmation'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock

// 10:00 in London on Friday 11 September 2026.
const NOW = new Date('2026-09-11T09:00:00.000Z')

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: 'host@example.com',
    event_type: 'Birthday party',
    event_date: '2026-11-21',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: null,
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    deposit_confirmed_at: null,
    deposit_confirmed_by: null,
    paypal_deposit_order_id: null,
    balance_due_date: '2026-11-07',
    final_payment_date: null,
    setup_date: null,
    setup_time: null,
    contract_sent_at: null,
    contract_accepted_at: null,
    ...overrides,
  }
}

function seed(booking: Record<string, unknown>, customerEmail: string | null = null) {
  state.db = createFakeSupabase({
    private_bookings: [booking],
    customers: [{ id: 'customer-1', email: customerEmail, email_status: null, email_deactivated_at: null, mobile_number: '+447700900123' }],
    email_suppressions: [],
    notification_deliveries: [],
    notification_attempts: [],
    private_booking_audit: [],
  })
}

function row() {
  return state.db.tables.private_bookings[0]
}

/** Stands in for sendPrivateBookingContractForSignature: records the order and stamps the send, as it does. */
function fakeContractSender(order: string[]) {
  return vi.fn(async (bookingId: string) => {
    order.push('contract')
    const booking = state.db.tables.private_bookings.find((candidate: any) => candidate.id === bookingId)
    booking.contract_sent_at = NOW.toISOString()
    return { version: 1 }
  })
}

describe('Confirm deposit sends the contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emails the contract for signature first, then the deposit request, which can then point to it', async () => {
    seed(bookingRow())
    const order: string[] = []
    mockedSendEmail.mockImplementation(async () => {
      order.push('deposit request')
      return { success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' }
    })
    const sendContract = fakeContractSender(order)

    const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW, sendContract })

    expect(sendContract).toHaveBeenCalledWith('booking-1')
    expect(order).toEqual(['contract', 'deposit request'])
    expect(outcome).toMatchObject({ status: 'sent', channel: 'email', contract: 'sent' })
    expect(outcome.message).toBe(
      'Deposit confirmed at £250, due by 25 September 2026. The contract was emailed for signature. The deposit request was emailed to the guest.'
    )
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.text).toContain(
      'Paying the deposit confirms that you accept the booking terms and conditions set out in your contract, including the cancellation and refund policy.'
    )
  })

  it('confirms nothing and sends nothing else when the contract cannot be sent', async () => {
    seed(bookingRow())
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    const sendContract = vi.fn(async () => {
      throw new Error('Add the customer\'s name before sending the contract.')
    })

    await expect(
      confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW, sendContract })
    ).rejects.toThrow(
      new DepositConfirmationError(
        "The contract could not be sent (Add the customer's name before sending the contract.), so the deposit was not confirmed and no deposit request was sent. Fix that, then confirm the deposit again."
      )
    )
    expect(row().deposit_confirmed_at).toBeNull()
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('is refused for someone who cannot send contracts, before anything happens', async () => {
    seed(bookingRow())
    const sendContract = vi.fn()

    await expect(
      confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW, sendContract, canSendContract: false })
    ).rejects.toThrow('Confirming the deposit also sends the contract, and you do not have permission to send contracts')
    expect(sendContract).not.toHaveBeenCalled()
    expect(row().deposit_confirmed_at).toBeNull()
  })

  it('does not send it again when it has already been sent or accepted', async () => {
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    for (const contract of [{ contract_sent_at: '2026-09-01T10:00:00.000Z' }, { contract_accepted_at: '2026-09-02T11:00:00.000Z' }]) {
      seed(bookingRow(contract))
      const sendContract = vi.fn()

      const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW, sendContract })

      expect(sendContract).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ status: 'sent', contract: 'already_sent' })
    }
  })

  it('with no contact email: confirms the deposit, and tells staff the contract still has to go', async () => {
    seed(bookingRow({ contact_email: null }), 'alex@example.com')
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    const sendContract = vi.fn()

    const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW, sendContract })

    expect(sendContract).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ status: 'sent', contract: 'not_sent_no_email' })
    expect(outcome.message).toContain(
      'No contract was sent: the booking has no contact email address. Add one and send the contract from the Signatures panel, or record that the customer accepted it another way. The booking cannot be confirmed until then.'
    )
    // The deposit request went to the customer's own address, and with no contract it points to
    // the standard terms instead.
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.to).toBe('alex@example.com')
    expect(email.text).toContain(
      "Paying the deposit confirms that you accept our standard booking terms and conditions, including the cancellation and refund policy. Just ask us if you'd like a copy before you pay."
    )
    expect(email.text).not.toContain('your contract')
  })
})
