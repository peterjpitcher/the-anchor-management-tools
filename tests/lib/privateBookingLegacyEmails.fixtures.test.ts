import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { assertCleanText, expectedLongDate } from '../mocks/emailRenderChecks'

/**
 * Fixture renders of the private booking emails that are sent directly, rather than as the email
 * version of a text: the provisional hold and confirmation, the deposit receipt, payment complete,
 * the calendar invite, the deposit payment link, the two deposit refund notices, the refund
 * confirmation, the cancellation and the contract.
 *
 * The suite runs twice, under TEST_TZ=Europe/London (npm test) and TEST_TZ=UTC (npm run test:utc),
 * which is the zone the serverless runtime actually runs in. Every render must:
 * - carry no "undefined", "Invalid Date", "NaN", "£0.00" or bare "null", and no em or en dash;
 * - print the event date with the weekday that date really falls on, in London;
 * - print times on a 12-hour clock, and mark an end time that falls the next day;
 * - carry a plain-text part written for the message, not derived from a table;
 * - escape anything a customer typed;
 * - fit a 375px phone, which means no label column that refuses to wrap.
 *
 * `assertCleanRender` is not used: it asserts the text ends with the sign-off, and a private
 * booking email ends with the SOP §26/§27 small print (privacy notice and complaints route).
 */

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

import { sendEmail } from '@/lib/email/emailService'
import {
  sendBalancePaidEmail,
  sendBookingCalendarInvite,
  sendBookingCancelledEmail,
  sendBookingConfirmationEmail,
  sendContractEmailToCustomer,
  sendDepositPartRefundEmail,
  sendDepositPaymentLinkEmail,
  sendDepositReceivedEmail,
  sendPrivateBookingRefundSentEmail,
} from '@/lib/email/private-booking-emails'

const mockedSendEmail = sendEmail as unknown as Mock

// 3 October 2026 is a Saturday (BST), 5 December 2026 a Saturday (GMT), and the clocks go back on
// 25 October 2026. A near-midnight booking is where a zone slip or a 24-hour clock shows up.
const BST_DATE = '2026-10-03'
const GMT_DATE = '2026-12-05'
const BOOKING_ID = '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b'

/** A name and event type as the public enquiry form would let them through. */
const HOSTILE_NAME = 'Siobh<b>an</b>'
const HOSTILE_EVENT = 'Party <script>alert(1)</script> & "drinks"'

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    customer_id: 'customer-1',
    contact_email: 'host@example.com',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    event_type: 'Birthday party',
    event_date: BST_DATE,
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    deposit_amount: 250,
    total_amount: 1440,
    ...overrides,
  }
}

type Payload = { subject: string; html: string; text?: string }

function sent(): Payload {
  expect(mockedSendEmail).toHaveBeenCalledTimes(1)
  return mockedSendEmail.mock.calls[0][0] as Payload
}

/** Every check that should hold for every private booking email, whatever it says. */
function expectSound(payload: Payload, options: { eventDate?: string | null } = {}): void {
  expect(typeof payload.text).toBe('string')
  const text = payload.text as string
  for (const part of [payload.subject, payload.html, text]) {
    assertCleanText(part)
  }
  // A written text part, not one derived from an HTML table, where a label and its value run
  // together because </td> is not a block end.
  expect(text).not.toMatch(/Event[A-Z]/)
  expect(text).toContain('The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ')
  // Readable on a 375px phone: nothing in the table refuses to wrap.
  expect(payload.html).not.toContain('white-space: nowrap')
  expect(payload.html).toContain('padding: 16px')
  if (options.eventDate) {
    // expectedLongDate builds "Saturday 3 October 2026" from the calendar alone.
    const [weekday, ...rest] = expectedLongDate(options.eventDate).split(' ')
    expect(payload.html).toContain(`${weekday}, ${rest.join(' ')}`)
    expect(text).toContain(`${weekday}, ${rest.join(' ')}`)
  }
}

describe.each([BST_DATE, GMT_DATE])('private booking emails for an event on %s', (eventDate) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  it('provisional hold, deposit still owed', async () => {
    await sendBookingConfirmationEmail(
      booking({ event_date: eventDate, hold_expiry: '2099-09-25T22:59:59.000Z' })
    )
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.subject).toBe(`Provisional booking hold: Birthday party on ${weekdayDate(eventDate)}`)
    expect(payload.text).toContain('Deposit due: £250.00')
    expect(payload.text).toContain('not confirmed until we receive your deposit')
    // One row, not the same figure twice under two labels.
    expect(payload.text).toContain('Total event cost: £1,440.00')
    expect(payload.text).not.toContain('Event balance due')
  })

  it('confirmation once the deposit is paid: never a hold, never "deposit due"', async () => {
    await sendBookingConfirmationEmail(
      booking({ event_date: eventDate, deposit_paid_date: '2026-09-10T09:00:00.000Z' })
    )
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.subject).toContain('Booking confirmed')
    expect(payload.text).toContain('We have received your deposit')
    expect(payload.text).toContain('Deposit paid: £250.00')
    expect(payload.html).not.toMatch(/provisional/i)
    expect(payload.text).not.toContain('Deposit due')
  })

  it('confirmation with the deposit waived: no deposit asked for', async () => {
    await sendBookingConfirmationEmail(booking({ event_date: eventDate, deposit_amount: 0 }))
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.subject).toContain('Booking confirmed')
    expect(payload.text).toContain('There is no deposit to pay on this booking')
    expect(payload.html).not.toMatch(/provisional/i)
    expect(payload.html).not.toMatch(/deposit due/i)
  })

  it('provisional hold with no deadline says nothing about one', async () => {
    await sendBookingConfirmationEmail(booking({ event_date: eventDate, hold_expiry: null }))
    const payload = sent()
    expectSound(payload, { eventDate })
    // A website enquiry was never given a hold expiry date, so the email must not refer to one.
    expect(payload.html).not.toContain("the hold expiry date we've given you")
    expect(payload.text).not.toContain('Deposit due by')
  })

  it('deposit received, booking confirmed', async () => {
    await sendBookingConfirmationEmailNoop()
    await sendDepositReceivedEmail(booking({ event_date: eventDate, balance_due_date: '2026-09-19' }))
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.subject).toBe(`Deposit received, booking confirmed: Birthday party on ${weekdayDate(eventDate)}`)
    expect(payload.text).toContain('Your private event booking at The Anchor is confirmed.')
    expect(payload.text).toContain("It's held separately from your bill and refunded after the event, less any documented deductions.")
  })

  it('deposit received while the booking is still being checked', async () => {
    await sendDepositReceivedEmail(booking({ event_date: eventDate, bookingConfirmed: false }))
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.subject).toBe(`Deposit received: Birthday party on ${weekdayDate(eventDate)}`)
    expect(payload.text).toContain("we'll confirm it shortly")
    expect(payload.html).not.toMatch(/is confirmed/)
  })

  it('deposit received with nothing priced yet leaves the total out', async () => {
    await sendDepositReceivedEmail(booking({ event_date: eventDate, total_amount: null }))
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.text).not.toContain('Total event cost')
  })

  it('payment complete, with a deposit held', async () => {
    await sendBalancePaidEmail(
      booking({ event_date: eventDate, deposit_paid_date: '2026-09-10T09:00:00.000Z' })
    )
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.text).toContain('Deposit held: £250.00')
    expect(payload.text).toContain('We refund it within 48 hours after the event')
  })

  it('payment complete promises no refund when there is no deposit held', async () => {
    for (const overrides of [
      { deposit_paid_date: null },
      { deposit_amount: 0, deposit_paid_date: '2026-09-10T09:00:00.000Z' },
      { deposit_paid_date: '2026-09-10T09:00:00.000Z', invoice_deposit_treatment: 'deducted' },
    ]) {
      vi.clearAllMocks()
      mockedSendEmail.mockResolvedValue({ success: true })
      await sendBalancePaidEmail(booking({ event_date: eventDate, ...overrides }))
      const payload = sent()
      expectSound(payload, { eventDate })
      expect(payload.text).not.toContain('Deposit held')
      expect(payload.html).not.toMatch(/refunded after the event/)
      expect(payload.html).not.toMatch(/48 hours/)
    }
  })

  it('calendar invite, with the .ics attached', async () => {
    const result = await sendBookingCalendarInvite(booking({ event_date: eventDate }))
    expect(result).toEqual({ sent: true })
    const payload = mockedSendEmail.mock.calls[0][0]
    expectSound(payload, { eventDate })
    expect(payload.attachments[0].contentType).toContain('method=PUBLISH')
    expect(String(payload.attachments[0].content)).toContain('BEGIN:VCALENDAR')
  })

  it('deposit payment link', async () => {
    const result = await sendDepositPaymentLinkEmail(
      booking({ event_date: eventDate }),
      'https://paypal.test/checkout?token=ORDER-123',
      'https://management.example.com/booking-portal/token'
    )
    expect(result).toEqual({ sent: true })
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.text).toContain('Pay deposit via PayPal: https://paypal.test/checkout?token=ORDER-123')
    expect(payload.text).toContain('Open your booking and pay: https://management.example.com/booking-portal/token')
    // Both buttons are the same size, so the recovery link is as tappable as the PayPal one.
    expect(payload.html.match(/padding: 12px 24px/g)?.length).toBe(2)
  })

  it('deposit refunded in full', async () => {
    await sendDepositRefundInFull(eventDate)
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.text).toContain('Deposit refunded: £250.00')
    expect(payload.text).not.toMatch(/deduction/i)
  })

  it('part-refunded deposit states the position across every refund, and no internal reason', async () => {
    await sendDepositPartRefundEmail({
      ...booking({ event_date: eventDate }),
      deposit_amount: 250,
      refund_amount: 150,
      total_refunded: 250,
    })
    const payload = sent()
    expectSound(payload, { eventDate })
    // The second of two refunds: the guest has the whole deposit back, so nothing is held.
    expect(payload.text).toContain('This refund: £150.00')
    expect(payload.text).toContain('Refunded: £250.00')
    expect(payload.text).not.toContain('Held back')
  })

  it('part-refunded deposit says what is held back, without a reason staff were told stays internal', async () => {
    await sendDepositPartRefundEmail({
      ...booking({ event_date: eventDate }),
      deposit_amount: 250,
      refund_amount: 100,
      total_refunded: 100,
    })
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.text).toContain('Refunded: £100.00')
    expect(payload.text).toContain('Held back: £150.00')
    expect(payload.text).toContain('we will send you a breakdown')
  })

  it('refund sent on a cancelled booking, which the cancellation email promised', async () => {
    await sendPrivateBookingRefundSentEmail({
      ...booking({ event_date: eventDate }),
      refund_amount: 150,
      refund_method: 'paypal',
    })
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.text).toContain('Refund sent: £150.00')
    expect(payload.text).toContain('01753 682707')
  })

  it('cancellation states the retention the manager decided', async () => {
    await sendBookingCancelledEmail({
      ...booking({ event_date: eventDate }),
      refund_amount: 150,
      retained_amount: 100,
      retention_reason: 'Band deposit already paid',
      variant: 'private_booking_cancelled_retention',
    })
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.text).toContain('£100.00 of your deposit has been retained')
    expect(payload.text).toContain('Refund: £150.00')
    expect(payload.text).toContain('Reason: Band deposit already paid')
    expect(payload.html).not.toContain("We're reviewing the payments")
  })

  it('takes the cancelled event back out of the guest calendar', async () => {
    await sendBookingCancelledEmail({
      ...booking({ event_date: eventDate }),
      refund_amount: 150,
      retained_amount: 0,
      variant: 'private_booking_cancelled_refundable',
    })
    const payload = mockedSendEmail.mock.calls[0][0]
    expect(payload.attachments[0].name).toBe('booking-cancelled.ics')
    const ics = String(payload.attachments[0].content)
    expect(ics).toContain('METHOD:CANCEL')
    expect(ics).toContain('STATUS:CANCELLED')
    expect(ics).toContain(`UID:booking-${BOOKING_ID}@the-anchor`)
    // Later than the invite it withdraws, or the client keeps the event.
    expect(Number(/SEQUENCE:(\d+)/.exec(ics)?.[1])).toBeGreaterThan(0)
  })

  it('sends no calendar cancellation for a hold, which never had an invite', async () => {
    await sendBookingCancelledEmail({
      ...booking({ event_date: eventDate }),
      refund_amount: 0,
      retained_amount: 0,
      variant: 'private_booking_cancelled_hold',
    })
    expect(mockedSendEmail.mock.calls[0][0].attachments).toBeUndefined()
  })

  it('cancellation of a hold says a hold, not a booking', async () => {
    await sendBookingCancelledEmail({
      ...booking({ event_date: eventDate }),
      refund_amount: 0,
      retained_amount: 0,
      variant: 'private_booking_cancelled_hold',
    })
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.subject).toContain('Your hold at The Anchor is cancelled')
    expect(payload.text).toContain('Your hold for Birthday party')
    expect(payload.text).toContain('No money changed hands')
  })

  it('contract, with the version out of the guest copy', async () => {
    await sendContractEmailToCustomer(booking({ event_date: eventDate }), {
      version: 3,
      pdf: Buffer.from('pdf'),
    })
    const payload = sent()
    expectSound(payload, { eventDate })
    expect(payload.html).not.toContain('contract version 3')
    expect(payload.attachments[0].name).toBe('The-Anchor-booking-contract-v3.pdf')
  })
})

describe('times, dates and typed-in values', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  it('prints an overnight end time as the next day, on a 12-hour clock', async () => {
    await sendBookingConfirmationEmail(
      booking({ event_date: GMT_DATE, start_time: '19:30:00', end_time: '00:30:00', end_time_next_day: true })
    )
    const payload = sent()
    expectSound(payload, { eventDate: GMT_DATE })
    expect(payload.text).toContain('Time: 7:30pm to 12:30am (the next day)')
    expect(payload.html).not.toContain('19:30')
  })

  it('prints a half past midnight start as 12:30am, not 0:30', async () => {
    await sendBookingConfirmationEmail(
      booking({ event_date: BST_DATE, start_time: '00:30:00', end_time: '04:00:00' })
    )
    const payload = sent()
    expect(payload.text).toContain('Time: 12:30am to 4am')
    expect(payload.html).not.toContain('0:30')
  })

  it('says the date is to be confirmed rather than printing the placeholder it was created with', async () => {
    // A website enquiry with no date is stored with the day it arrived, at 12:00.
    const tbd = booking({ event_date: '2026-09-12', date_tbd: true, start_time: '12:00:00', end_time: null })

    await sendDepositPaymentLinkEmail(tbd, 'https://paypal.test/checkout', 'https://management.example.com/p/token')
    expect(sent().subject).toContain('Date to be confirmed')
    expect(sent().html).toContain('date to be confirmed')
    expect(sent().html).not.toContain('12 September 2026')

    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
    await sendContractEmailToCustomer(tbd, { version: 1, pdf: Buffer.from('pdf') })
    expect(sent().html).toContain('date to be confirmed')
    expect(sent().html).not.toContain('12 September 2026')

    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
    await sendBookingCancelledEmail({
      ...tbd,
      refund_amount: 0,
      retained_amount: 0,
      variant: 'private_booking_cancelled_hold',
    })
    expect(sent().html).toContain('date to be confirmed')
    expect(sent().html).not.toContain('12 September 2026')

    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
    // No invite at all: there is no event to put in a calendar yet.
    const invite = await sendBookingCalendarInvite(tbd)
    expect(invite).toEqual({ sent: false, reason: 'date_to_be_confirmed' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('escapes a name and an event type a customer typed', async () => {
    await sendBookingCancelledEmail({
      ...booking({ customer_first_name: HOSTILE_NAME, event_type: HOSTILE_EVENT }),
      refund_amount: 0,
      retained_amount: 0,
      variant: 'private_booking_cancelled_manual_review',
    })
    const payload = sent()
    expect(payload.html).not.toContain('<b>an</b>')
    expect(payload.html).not.toContain('<script>')
    expect(payload.html).toContain('&lt;script&gt;')
    expect(payload.html).toContain('&lt;b&gt;an&lt;/b&gt;')
  })

  it('escapes the reason shown with a retention', async () => {
    await sendBookingCancelledEmail({
      ...booking(),
      refund_amount: 0,
      retained_amount: 250,
      retention_reason: 'Damage <b>see photos</b>',
      variant: 'private_booking_cancelled_retention',
    })
    expect(sent().html).not.toContain('<b>see photos</b>')
  })
})

describe('a send that fails is reported, not swallowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
  })

  it('the deposit payment link, because staff act on the answer', async () => {
    const result = await sendDepositPaymentLinkEmail(booking(), 'https://paypal.test/checkout')
    expect(result).toEqual({ sent: false, error: 'Resend 500' })
  })

  it('the calendar invite', async () => {
    const result = await sendBookingCalendarInvite(booking())
    expect(result).toEqual({ sent: false, reason: 'send_failed', error: 'Resend 500' })
  })
})

/** "Saturday, 3 October 2026", as the emails print it. */
function weekdayDate(isoDate: string): string {
  const [weekday, ...rest] = expectedLongDate(isoDate).split(' ')
  return `${weekday}, ${rest.join(' ')}`
}

/** Keeps the deposit-received test honest about which call it is reading. */
async function sendBookingConfirmationEmailNoop(): Promise<void> {
  return undefined
}

async function sendDepositRefundInFull(eventDate: string): Promise<void> {
  const { sendDepositRefundEmail } = await import('@/lib/email/private-booking-emails')
  await sendDepositRefundEmail({
    ...booking({ event_date: eventDate }),
    refund_amount: 250,
    total_refunded: 250,
  })
}
