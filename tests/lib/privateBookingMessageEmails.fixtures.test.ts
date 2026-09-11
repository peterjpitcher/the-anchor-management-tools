import { describe, expect, it } from 'vitest'
import { getIsoWeekday } from '@/lib/dateUtils'
import {
  buildBalanceDueDateChangedEmail,
  buildBalancePaidMessageEmail,
  buildBalanceReminderEmail,
  buildBookingConfirmedMessageEmail,
  buildCancellationEmail,
  buildDateChangedEmail,
  buildDepositReceivedMessageEmail,
  buildDepositReminderEmail,
  buildDepositRequestEmail,
  buildEventReminderEmail,
  buildHoldExtendedEmail,
  buildHoldLapsedEmail,
  buildPrivateBookingCreatedEmail,
  buildReviewRequestEmail,
  buildSetupReminderEmail,
  buildThankYouEmail,
  formatPrivateBookingReference,
  resolveConfirmationDepositState,
  type PrivateBookingEmailContent,
  type PrivateBookingMessageEmailBooking,
} from '@/lib/email/private-booking-emails'
import {
  balanceDueDateChangedMessage,
  balanceReminder15DayMessage,
  balanceReminder16DayMessage,
  balanceReminder21DayMessage,
  balanceReminderDueMessage,
  bookingCancelledHoldMessage,
  bookingCancelledManualReviewMessage,
  bookingCancelledPartialRefundMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledRetentionMessage,
  bookingCancelledReviewPendingMessage,
  bookingCompletedThanksMessage,
  bookingConfirmedMessage,
  bookingExpiredMessage,
  dateChangedMessage,
  depositReceivedMessage,
  depositRequestMessage,
  depositReminder1DayMessage,
  depositReminder3DayMessage,
  depositReminder7DayMessage,
  eventReminder1DayMessage,
  finalPaymentMessage,
  holdExtendedMessage,
  privateBookingCreatedMessage,
  reviewRequestMessage,
  setupReminderMessage,
} from '@/lib/private-bookings/messages'
import { formatPrivateBookingSmsDate } from '@/lib/private-bookings/message-catalogue'

/**
 * Fixture renders of every email version of a private booking text (P6).
 *
 * The suite runs twice, under TEST_TZ=Europe/London (npm test) and TEST_TZ=UTC (npm run
 * test:utc), so each render here is checked in both zones. Every email must:
 * - contain no "undefined", "Invalid Date", "NaN", "£0.00" or a bare "£0";
 * - print the event date with the weekday that date really falls on;
 * - carry the booking reference and the venue phone number;
 * - state every amount, date, count and link its text states, exactly as the text prints it;
 * - contain no em dash or en dash.
 */

const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
// Built from char codes so this file never contains the characters it bans.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`)

// 3 October 2026 is a Saturday; the clocks go back on 25 October 2026 and forward on 29 March
// 2026, so those dates and evening deadlines are where a zone slip would show.
const EVENT_DATES = ['2026-10-03', '2026-10-25', '2026-03-29', '2026-12-31']

const BOOKING_ID = '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b'

function booking(eventDate: string, overrides: Partial<PrivateBookingMessageEmailBooking> = {}): PrivateBookingMessageEmailBooking {
  return {
    id: BOOKING_ID,
    event_type: 'Birthday party',
    event_date: eventDate,
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    setup_date: eventDate,
    setup_time: '17:30:00',
    ...overrides,
  }
}

/** Built from the calendar alone (UTC-anchored weekday), never from the host zone. */
function expectedWeekdayDate(eventDate: string): string {
  const weekday = WEEKDAYS[getIsoWeekday(eventDate) as number]
  const [year, month, day] = eventDate.split('-').map(Number)
  const monthName = new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
  return `${weekday}, ${day} ${monthName} ${year}`
}

/** Amounts, dates, day and guest counts and links a text states. */
function factsOf(sms: string): string[] {
  const facts = new Set<string>()
  for (const match of sms.matchAll(/£\d+(?:\.\d{2})?/g)) facts.add(match[0])
  for (const match of sms.matchAll(/\b\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/g)) facts.add(match[0])
  for (const match of sms.matchAll(/\b\d+ (?:days|guests)\b/g)) facts.add(match[0])
  for (const match of sms.matchAll(/https?:\/\/\S+/g)) facts.add(match[0])
  return [...facts]
}

function expectSound(email: PrivateBookingEmailContent, eventDate: string | null, sms: string | null) {
  for (const part of [email.subject, email.html, email.text]) {
    expect(part).not.toMatch(/undefined|Invalid Date|NaN|£0\.00|£0(?![\d.])/)
    expect(part).not.toMatch(DASHES)
  }
  expect(email.text).toContain(`Booking reference: ${formatPrivateBookingReference(BOOKING_ID)}`)
  expect(email.text).toContain('01753 682707')
  expect(email.html).toContain('tel:+441753682707')
  if (eventDate) {
    expect(email.text).toContain(`Date: ${expectedWeekdayDate(eventDate)}`)
  }
  if (sms) {
    for (const fact of factsOf(sms)) {
      expect(email.text, `email should state "${fact}" as the text does`).toContain(fact)
    }
  }
}

describe.each(EVENT_DATES)('private booking email versions for an event on %s', (eventDate) => {
  const b = booking(eventDate)
  const eventSms = formatPrivateBookingSmsDate(eventDate)
  const holdExpiry = formatPrivateBookingSmsDate('2026-09-25T22:30:00.000Z')
  const dueDate = formatPrivateBookingSmsDate('2026-09-19')

  it('booking created', () => {
    const sms = privateBookingCreatedMessage({ customerFirstName: 'Alex', eventDate: eventSms, depositAmount: 250, holdExpiry })
    expectSound(buildPrivateBookingCreatedEmail({ booking: b, firstName: 'Alex', depositAmount: 250, holdExpiry }), eventDate, sms)
  })

  it('deposit request from Confirm deposit, with its deadline, cash at the bar and the PayPal link', () => {
    const paymentLink = `https://management.orangejelly.co.uk/booking-portal/${'a'.repeat(88)}`
    const sms = depositRequestMessage({ customerFirstName: 'Alex', eventDate: eventSms, depositAmount: 300, holdExpiry, paymentLink })
    const email = buildDepositRequestEmail({ booking: b, firstName: 'Alex', depositAmount: 300, holdExpiry, paymentLink })
    expectSound(email, eventDate, sms)
    expect(email.text).toContain('You can pay it in cash at the bar, or by PayPal using the button below.')
    expect(email.text).toContain(`Pay the deposit by PayPal: ${paymentLink}`)
    expect(email.html).toContain(`href="${paymentLink}"`)
    expect(email.text).toContain('Pay by: 25 September 2026')
    expect(email.subject).toBe('Your deposit for The Anchor: £300 by 25 September 2026')
    // The text keeps the whole link, however long the words before it get.
    expect(sms.endsWith(paymentLink)).toBe(true)
    expect(sms).toContain('cash at the bar or by PayPal')
    expect(sms).not.toMatch(DASHES)
  })

  it('deposit reminders, 7, 3 and 1 day', () => {
    const inputs = { customerFirstName: 'Alex', eventDate: eventSms, depositAmount: 250, holdExpiry }
    expectSound(
      buildDepositReminderEmail({ booking: b, firstName: 'Alex', stage: '7day', depositAmount: 250, holdExpiry, daysRemaining: 5 }),
      eventDate,
      depositReminder7DayMessage({ ...inputs, daysRemaining: 5 })
    )
    expectSound(buildDepositReminderEmail({ booking: b, firstName: 'Alex', stage: '3day', depositAmount: 250, holdExpiry }), eventDate, depositReminder3DayMessage(inputs))
    expectSound(buildDepositReminderEmail({ booking: b, firstName: 'Alex', stage: '1day', depositAmount: 250, holdExpiry }), eventDate, depositReminder1DayMessage(inputs))
  })

  it('hold extended and hold lapsed', () => {
    expectSound(
      buildHoldExtendedEmail({ booking: b, firstName: 'Alex', newExpiryDate: holdExpiry }),
      eventDate,
      holdExtendedMessage({ customerFirstName: 'Alex', eventDate: eventSms, newExpiryDate: holdExpiry })
    )
    expectSound(buildHoldLapsedEmail({ booking: b, firstName: 'Alex' }), eventDate, bookingExpiredMessage({ customerFirstName: 'Alex', eventDate: eventSms }))
  })

  it('date changed, with and without the new deadline, and deadline changed', () => {
    expectSound(
      buildDateChangedEmail({ booking: b, firstName: 'Alex', balanceDueDate: dueDate }),
      eventDate,
      dateChangedMessage({ customerFirstName: 'Alex', newEventDate: eventSms, balanceDueDate: dueDate })
    )
    expectSound(buildDateChangedEmail({ booking: b, firstName: 'Alex', balanceDueDate: null }), eventDate, dateChangedMessage({ customerFirstName: 'Alex', newEventDate: eventSms }))
    expectSound(
      buildBalanceDueDateChangedEmail({ booking: b, firstName: 'Alex', balanceDueDate: dueDate }),
      eventDate,
      balanceDueDateChangedMessage({ customerFirstName: 'Alex', eventDate: eventSms, balanceDueDate: dueDate })
    )
  })

  it('setup reminder, with the setup time it was about', () => {
    const email = buildSetupReminderEmail({ booking: b, firstName: 'Alex' })
    expectSound(email, eventDate, setupReminderMessage({ customerFirstName: 'Alex', eventDate: eventSms }))
    expect(email.text).toContain('Setup from: 5:30pm')
    expect(email.text).toContain(`Setup date: ${expectedWeekdayDate(eventDate)}`)
  })

  it('balance reminders, all four stages', () => {
    const inputs = { customerFirstName: 'Alex', eventDate: eventSms, balanceAmount: 1234.5, balanceDueDate: dueDate }
    const cases = [
      ['21day', balanceReminder21DayMessage(inputs)],
      ['16day', balanceReminder16DayMessage(inputs)],
      ['15day', balanceReminder15DayMessage(inputs)],
      ['due', balanceReminderDueMessage(inputs)],
    ] as const
    for (const [stage, sms] of cases) {
      expectSound(buildBalanceReminderEmail({ booking: b, firstName: 'Alex', stage, balanceAmount: 1234.5, balanceDueDate: dueDate }), eventDate, sms)
    }
  })

  it('balance reminders with the payments made, all four stages', () => {
    const inputs = { customerFirstName: 'Alex', eventDate: eventSms, balanceAmount: 1234.5, balanceDueDate: dueDate }
    const payments = {
      entries: [
        { id: 'deposit', type: 'deposit' as const, amount: 250, method: 'paypal' as const, date: '2026-08-12', appliedAmount: 0 },
        { id: 'p1', type: 'balance' as const, amount: 300, method: 'cash' as const, date: '2026-09-01' },
        { id: 'p2', type: 'balance' as const, amount: 245.7, method: 'bank_transfer' as const, date: '2026-10-25' },
      ],
      eventTotal: 1780.2,
      paidTowardsBill: 545.7,
      balanceDue: 1234.5,
    }
    const cases = [
      ['21day', balanceReminder21DayMessage(inputs)],
      ['16day', balanceReminder16DayMessage(inputs)],
      ['15day', balanceReminder15DayMessage(inputs)],
      ['due', balanceReminderDueMessage(inputs)],
    ] as const
    for (const [stage, sms] of cases) {
      const email = buildBalanceReminderEmail({ booking: b, firstName: 'Alex', stage, balanceAmount: 1234.5, balanceDueDate: dueDate, payments })
      expectSound(email, eventDate, sms)
      expect(email.text).toContain('Event total: £1780.20')
      expect(email.text).toContain('Paid towards your bill so far: £545.70')
      expect(email.text).toContain('Balance due: £1234.50')
      expect(email.text).toContain('Payments received\n12 August 2026: Deposit by PayPal, £250 (held separately from your bill)\n1 September 2026: Payment by cash, £300\n25 October 2026: Payment by bank transfer, £245.70')
      expect(email.text).toContain("held separately from your bill and refunded after the event")
      expect(email.html).toContain('Payments received')
    }
  })

  it('event reminder, thank you and review request', () => {
    expectSound(
      buildEventReminderEmail({ booking: b, firstName: 'Alex' }),
      eventDate,
      eventReminder1DayMessage({ customerFirstName: 'Alex', guestPart: 'for your 40 guests' })
    )
    expectSound(buildThankYouEmail({ booking: b, firstName: 'Alex' }), eventDate, bookingCompletedThanksMessage({ customerFirstName: 'Alex' }))
    const reviewLink = 'https://g.page/r/the-anchor/review'
    const review = buildReviewRequestEmail({ booking: b, firstName: 'Alex', reviewLink })
    expectSound(review, eventDate, reviewRequestMessage({ customerFirstName: 'Alex', eventDate: eventSms, reviewLink }))
    expect(review.html).toContain(`href="${reviewLink}"`)
  })

  it('all six cancellation variants', () => {
    const common = { customerFirstName: 'Alex', eventDate: eventSms }
    const cases = [
      ['private_booking_cancelled_hold', bookingCancelledHoldMessage(common), 0, 0, 0],
      ['private_booking_cancelled_refundable', bookingCancelledRefundableMessage({ ...common, refundAmount: 450 }), 450, 0, 0],
      ['private_booking_cancelled_partial_refund', bookingCancelledPartialRefundMessage({ ...common, refundAmount: 237.5, deductionAmount: 12.5 }), 237.5, 12.5, 12.5],
      ['private_booking_cancelled_retention', bookingCancelledRetentionMessage({ ...common, retainedAmount: 150, refundAmount: 100 }), 100, 150, 0],
      ['private_booking_cancelled_review_pending', bookingCancelledReviewPendingMessage(common), 0, 0, 0],
      ['private_booking_cancelled_manual_review', bookingCancelledManualReviewMessage(common), 0, 0, 0],
    ] as const
    for (const [variant, sms, refundAmount, retainedAmount, deductionAmount] of cases) {
      expectSound(
        buildCancellationEmail({
          booking: b,
          firstName: 'Alex',
          variant,
          refundAmount,
          retainedAmount,
          deductionAmount,
          retentionReason: variant === 'private_booking_cancelled_retention' ? 'Supplier costs already committed' : null,
        }),
        eventDate,
        sms
      )
    }
  })

  it('deposit received, balance paid and confirmed replace the emails that went alongside', () => {
    expectSound(
      buildDepositReceivedMessageEmail({ booking: b, firstName: 'Alex', depositAmount: 250, totalAmount: 1480.2, balanceDueDate: '2026-09-19' }),
      eventDate,
      depositReceivedMessage({ customerFirstName: 'Alex', eventDate: eventSms })
    )
    expectSound(
      buildBalancePaidMessageEmail({ booking: b, firstName: 'Alex', totalAmount: 1480.2, depositAmount: 250 }),
      eventDate,
      finalPaymentMessage({ customerFirstName: 'Alex', eventDate: eventSms })
    )
    for (const depositState of ['due', 'paid', 'none'] as const) {
      expectSound(
        buildBookingConfirmedMessageEmail({
          booking: b,
          firstName: 'Alex',
          depositState,
          depositAmount: depositState === 'none' ? 0 : 250,
          holdExpiry: '2026-09-25T22:30:00.000Z',
          totalAmount: 1480.2,
          now: new Date('2026-09-11T10:00:00.000Z'),
        }),
        eventDate,
        depositState === 'due' ? null : bookingConfirmedMessage({ customerFirstName: 'Alex', eventDate: eventSms })
      )
    }
  })
})

describe('waived-deposit wording (was "Provisional Booking Hold" for every confirmation)', () => {
  const b = booking('2026-10-03')

  it('a waived or zero deposit is confirmed, not provisional', () => {
    expect(resolveConfirmationDepositState({ deposit_amount: 0, deposit_waived: true })).toBe('none')
    expect(resolveConfirmationDepositState({ deposit_amount: 250, deposit_waived: true })).toBe('none')
    const email = buildBookingConfirmedMessageEmail({ booking: b, firstName: 'Alex', depositState: 'none', depositAmount: 0 })
    expect(email.subject).toContain('Booking confirmed')
    expect(email.text).toContain("You're all confirmed for Saturday, 3 October 2026.")
    expect(email.text).toContain('There is no deposit to pay for this booking.')
    expect(`${email.subject} ${email.text}`).not.toMatch(/provisional|not confirmed until/i)
  })

  it('a paid deposit is confirmed', () => {
    expect(resolveConfirmationDepositState({ deposit_amount: 250, deposit_paid_date: '2026-09-01' })).toBe('paid')
    const email = buildBookingConfirmedMessageEmail({ booking: b, firstName: 'Alex', depositState: 'paid', depositAmount: 250 })
    expect(email.text).toContain('We have received your deposit.')
    expect(email.text).not.toMatch(/provisional/i)
  })

  it('an unpaid deposit keeps the provisional hold, with the deadline while it is live', () => {
    expect(resolveConfirmationDepositState({ deposit_amount: 250 })).toBe('due')
    const email = buildBookingConfirmedMessageEmail({
      booking: b,
      firstName: 'Alex',
      depositState: 'due',
      depositAmount: 250,
      holdExpiry: '2026-09-25T22:30:00.000Z',
      now: new Date('2026-09-11T10:00:00.000Z'),
    })
    expect(email.subject).toContain('Provisional booking hold')
    expect(email.text).toContain('Deposit due: £250')
    // 22:30 UTC on 25 September is 23:30 in London: still the 25th.
    expect(email.text).toContain('Deposit due by: 25 September 2026')
  })
})

describe('a booking whose date is still to be confirmed', () => {
  it('never prints a placeholder date as a real one', () => {
    const tbd = booking('2027-01-01', { date_tbd: true })
    const email = buildPrivateBookingCreatedEmail({ booking: tbd, firstName: 'Alex', depositAmount: 250, holdExpiry: null })
    expect(email.text).toContain('Date: Date to be confirmed')
    expect(email.text).not.toContain('2027')
    expect(email.text).not.toContain('Time:')
  })

  it('a deposit request states no deadline and no date', () => {
    const tbd = booking('2027-01-01', { date_tbd: true })
    const paymentLink = 'https://management.orangejelly.co.uk/booking-portal/token'
    const email = buildDepositRequestEmail({ booking: tbd, firstName: 'Alex', depositAmount: 250.5, holdExpiry: null, paymentLink })
    const sms = depositRequestMessage({ customerFirstName: 'Alex', eventDate: null, depositAmount: 250.5, holdExpiry: null, paymentLink })
    expect(email.text).toContain('The deposit for your booking (date to be confirmed) is £250.50.')
    expect(email.text).not.toMatch(/Pay by|2027|released/)
    expect(sms).toBe(`Hi Alex, the deposit for your booking at The Anchor is £250.50. Pay in cash at the bar or by PayPal: ${paymentLink}`)
    for (const part of [email.subject, email.html, email.text, sms]) {
      expect(part).not.toMatch(/undefined|Invalid Date|NaN/)
      expect(part).not.toMatch(DASHES)
    }
  })
})

describe('the deposit request text never loses its link', () => {
  it('shortens the words, not the link, when a long name and a long link would run over', () => {
    const paymentLink = `https://management.orangejelly.co.uk/booking-portal/${'b'.repeat(200)}`
    const sms = depositRequestMessage({
      customerFirstName: 'Bartholomew-Maximilian',
      eventDate: '31 December 2026',
      depositAmount: 1234.56,
      holdExpiry: '17 December 2026',
      paymentLink,
    })
    expect(sms.endsWith(` ${paymentLink}`)).toBe(true)
    expect(sms.length).toBeLessThanOrEqual(306)
  })
})
