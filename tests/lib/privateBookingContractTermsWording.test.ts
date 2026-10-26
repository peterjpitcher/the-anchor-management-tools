import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Review BK-006: the deposit request, the provisional hold and the deposit receipts told every
 * guest that paying the deposit accepts the terms "set out in your contract", and that the
 * cancellation policy "is set out in your contract", when most had never been sent a contract.
 * Until a contract has been sent, or accepted another way, they point to the standard terms.
 */

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

import { sendEmail } from '@/lib/email/emailService'
import {
  buildBookingConfirmedMessageEmail,
  buildDepositReceivedMessageEmail,
  buildDepositRequestEmail,
  sendBookingConfirmationEmail,
  sendDepositPaymentLinkEmail,
  sendDepositReceivedEmail,
} from '@/lib/email/private-booking-emails'

const mockedSendEmail = sendEmail as unknown as Mock

const CONTRACT_ACCEPTS =
  'Paying the deposit confirms that you accept the booking terms and conditions set out in your contract, including the cancellation and refund policy.'
const STANDARD_ACCEPTS =
  "Paying the deposit confirms that you accept our standard booking terms and conditions, including the cancellation and refund policy. Just ask us if you'd like a copy before you pay."
const CONTRACT_POLICY = 'Our full cancellation, refund and date-change policy is set out in your contract.'
const STANDARD_POLICY =
  "Our full cancellation, refund and date-change policy is in our standard booking terms and conditions. Just ask us if you'd like a copy."

const NO_CONTRACT = { contract_sent_at: null, contract_accepted_at: null }
const SENT = { contract_sent_at: '2026-09-01T10:00:00.000Z', contract_accepted_at: null }
const ACCEPTED_ANOTHER_WAY = { contract_sent_at: null, contract_accepted_at: '2026-09-02T11:00:00.000Z' }

function booking(contract: Record<string, unknown>) {
  return {
    id: '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
    customer_id: 'customer-1',
    contact_email: 'host@example.com',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    event_type: 'Birthday party',
    event_date: '2026-11-21',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    hold_expiry: '2026-11-07T23:59:59.000Z',
    total_amount: 1440,
    ...contract,
  }
}

/** The plain-text part of the one email sent. */
function sentText(): string {
  expect(mockedSendEmail).toHaveBeenCalledTimes(1)
  return String(mockedSendEmail.mock.calls[0][0].text ?? '')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedSendEmail.mockResolvedValue({ success: true, messageId: 'm-1' })
})

describe('the email versions sent today', () => {
  it('the deposit request (Confirm deposit)', () => {
    const render = (contract: Record<string, unknown>) =>
      buildDepositRequestEmail({
        booking: booking(contract),
        firstName: 'Alex',
        depositAmount: 250,
        holdExpiry: '25 September 2026',
        paymentLink: 'https://management.example.com/booking-portal/token',
      }).text

    expect(render(NO_CONTRACT)).toContain(STANDARD_ACCEPTS)
    expect(render(NO_CONTRACT)).not.toContain('your contract')
    expect(render(SENT)).toContain(CONTRACT_ACCEPTS)
    expect(render(ACCEPTED_ANOTHER_WAY)).toContain(CONTRACT_ACCEPTS)
  })

  it('the provisional hold', () => {
    const render = (contract: Record<string, unknown>) =>
      buildBookingConfirmedMessageEmail({
        booking: booking(contract),
        firstName: 'Alex',
        depositState: 'due',
        depositAmount: 250,
        holdExpiry: '2026-11-07T23:59:59.000Z',
        now: new Date('2026-09-11T09:00:00.000Z'),
        paymentLink: 'https://management.example.com/booking-portal/token',
      }).text

    expect(render(NO_CONTRACT)).toContain(STANDARD_ACCEPTS)
    expect(render(NO_CONTRACT)).not.toContain('your contract')
    expect(render(SENT)).toContain(CONTRACT_ACCEPTS)
  })

  it('the deposit receipt', () => {
    const render = (contract: Record<string, unknown>) =>
      buildDepositReceivedMessageEmail({ booking: booking(contract), firstName: 'Alex', depositAmount: 250 }).text

    expect(render(NO_CONTRACT)).toContain(STANDARD_POLICY)
    expect(render(NO_CONTRACT)).not.toContain('your contract')
    expect(render(SENT)).toContain(CONTRACT_POLICY)
  })
})

describe('the older emails, still sent while email first is off', () => {
  it('the booking confirmation with a deposit still due', async () => {
    await sendBookingConfirmationEmail(booking(NO_CONTRACT))
    expect(sentText()).toContain(STANDARD_ACCEPTS)
    expect(sentText()).not.toContain('your contract')

    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'm-2' })
    await sendBookingConfirmationEmail(booking(SENT))
    expect(sentText()).toContain(CONTRACT_ACCEPTS)
  })

  it('the deposit received email', async () => {
    await sendDepositReceivedEmail({ ...booking(NO_CONTRACT), bookingConfirmed: true })
    expect(sentText()).toContain(
      `${STANDARD_POLICY} Date changes are subject to availability and must be requested at least 14 calendar days before the event, so please tell us as early as you can.`
    )
    expect(sentText()).not.toContain('your contract')

    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'm-2' })
    await sendDepositReceivedEmail({ ...booking(SENT), bookingConfirmed: true })
    expect(sentText()).toContain(CONTRACT_POLICY)
  })

  it('the deposit payment link email', async () => {
    await sendDepositPaymentLinkEmail(booking(NO_CONTRACT), 'https://www.paypal.com/checkoutnow?token=ORDER-1')
    expect(sentText()).toContain(
      "Paying the deposit confirms that you accept our standard booking terms and conditions. Just ask us if you'd like a copy before you pay."
    )
    expect(sentText()).not.toContain('your contract')

    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'm-2' })
    await sendDepositPaymentLinkEmail(booking(SENT), 'https://www.paypal.com/checkoutnow?token=ORDER-1')
    expect(sentText()).toContain('Paying the deposit confirms that you accept the booking terms and conditions set out in your contract.')
  })
})
