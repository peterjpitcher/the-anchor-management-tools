import { describe, it, expect } from 'vitest'
import {
  privateBookingCreatedMessage,
  depositReminder7DayMessage,
  depositReminder1DayMessage,
  depositReceivedMessage,
  bookingConfirmedMessage,
  balanceReminder14DayMessage,
  balanceReminder7DayMessage,
  balanceReminder1DayMessage,
  finalPaymentMessage,
  setupReminderMessage,
  dateChangedMessage,
  eventReminder1DayMessage,
  holdExtendedMessage,
  bookingCancelledHoldMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledNonRefundableMessage,
  bookingCancelledManualReviewMessage,
  bookingExpiredMessage,
  bookingCompletedThanksMessage,
  reviewRequestMessage,
} from '@/lib/private-bookings/messages'

describe('privateBookingCreatedMessage', () => {
  it('builds the welcome body with deposit info', () => {
    const body = privateBookingCreatedMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
      depositAmount: 150,
      holdExpiry: '19 April 2026',
    })
    expect(body).toBe(
      "Hi Sarah — your date at The Anchor on 12 May 2026 is penciled in. £150 deposit secures it by 19 April 2026. We'll be in touch with next steps."
    )
  })

  it('falls back to "there" when first name is placeholder', () => {
    const body = privateBookingCreatedMessage({
      customerFirstName: 'guest',
      eventDate: '12 May 2026',
      depositAmount: 150,
      holdExpiry: '19 April 2026',
    })
    expect(body.startsWith('Hi there —')).toBe(true)
  })

  it('sanitises newlines from first name', () => {
    const body = privateBookingCreatedMessage({
      customerFirstName: 'Sarah\n+44 7000 000000',
      eventDate: '12 May 2026',
      depositAmount: 150,
      holdExpiry: '19 April 2026',
    })
    expect(body).not.toContain('\n')
    expect(body).toContain('Sarah +44 7000 000000')
  })
})

describe('bookingCancelledRefundableMessage', () => {
  it('states refund amount and 10-working-day SLA', () => {
    const body = bookingCancelledRefundableMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
      refundAmount: 150,
    })
    expect(body).toBe(
      "Hi Sarah — your booking on 12 May 2026 is cancelled. We'll refund £150 within 10 working days and confirm once it's on the way."
    )
  })
})

describe('bookingCancelledNonRefundableMessage', () => {
  it('states retained amount with booking-terms wording', () => {
    const body = bookingCancelledNonRefundableMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
      retainedAmount: 150,
    })
    expect(body).toContain('£150')
    expect(body).toContain('retained per our booking terms')
  })
})

describe('bookingCancelledManualReviewMessage', () => {
  it('makes no refund promise', () => {
    const body = bookingCancelledManualReviewMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
    })
    expect(body).not.toContain('£')
    expect(body).not.toContain('refund')
    expect(body).toContain('in touch shortly')
  })
})

describe('every message', () => {
  const allMessages = [
    () => privateBookingCreatedMessage({ customerFirstName: 'A', eventDate: 'x', depositAmount: 1, holdExpiry: 'y' }),
    () => depositReminder7DayMessage({ customerFirstName: 'A', eventDate: 'x', depositAmount: 1, daysRemaining: 3 }),
    () => depositReminder1DayMessage({ customerFirstName: 'A', eventDate: 'x', depositAmount: 1 }),
    () => depositReceivedMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingConfirmedMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => balanceReminder14DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1, balanceDueDate: 'y' }),
    () => balanceReminder7DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1, balanceDueDate: 'y' }),
    () => balanceReminder1DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1 }),
    () => finalPaymentMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => setupReminderMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => dateChangedMessage({ customerFirstName: 'A', newEventDate: 'x' }),
    () => eventReminder1DayMessage({ customerFirstName: 'A', guestPart: '' }),
    () => holdExtendedMessage({ customerFirstName: 'A', eventDate: 'x', newExpiryDate: 'y' }),
    () => bookingCancelledHoldMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingCancelledRefundableMessage({ customerFirstName: 'A', eventDate: 'x', refundAmount: 1 }),
    () => bookingCancelledNonRefundableMessage({ customerFirstName: 'A', eventDate: 'x', retainedAmount: 1 }),
    () => bookingCancelledManualReviewMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingExpiredMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingCompletedThanksMessage({ customerFirstName: 'A' }),
    () => reviewRequestMessage({ customerFirstName: 'A', eventDate: 'x', reviewLink: 'https://g.co/r' }),
  ]

  it.each(allMessages.map((fn, i) => [i, fn] as const))(
    'message #%i stays under 306 chars',
    (_, fn) => {
      expect(fn().length).toBeLessThanOrEqual(306)
    }
  )

  it.each(allMessages.map((fn, i) => [i, fn] as const))(
    'message #%i does not start with "The Anchor:"',
    (_, fn) => {
      expect(fn().startsWith('The Anchor:')).toBe(false)
    }
  )
})
