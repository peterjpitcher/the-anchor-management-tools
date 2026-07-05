import { describe, it, expect } from 'vitest'
import {
  privateBookingCreatedMessage,
  depositReminder7DayMessage,
  depositReminder3DayMessage,
  depositReminder1DayMessage,
  depositReceivedMessage,
  bookingConfirmedMessage,
  balanceReminder21DayMessage,
  balanceReminder16DayMessage,
  balanceReminder15DayMessage,
  balanceReminderDueMessage,
  finalPaymentMessage,
  setupReminderMessage,
  dateChangedMessage,
  eventReminder1DayMessage,
  holdExtendedMessage,
  bookingCancelledHoldMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledRetentionMessage,
  bookingCancelledReviewPendingMessage,
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

describe('bookingCancelledRetentionMessage', () => {
  it('states the reviewed retained amount and the refund when one is due', () => {
    const body = bookingCancelledRetentionMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
      retainedAmount: 150,
      refundAmount: 50,
    })
    expect(body).toContain('£150')
    expect(body).toContain('Following review')
    expect(body).toContain('£50 will be refunded within 10 working days')
    expect(body).not.toContain('per our booking terms')
    expect(body).not.toContain('non-refundable')
  })

  it('omits the refund sentence when nothing is refunded', () => {
    const body = bookingCancelledRetentionMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
      retainedAmount: 150,
      refundAmount: 0,
    })
    expect(body).toContain('£150')
    expect(body).not.toContain('refunded within 10 working days')
    expect(body).not.toContain('per our booking terms')
    expect(body).not.toContain('non-refundable')
  })
})

describe('bookingCancelledReviewPendingMessage', () => {
  it('asserts no amounts while the retention decision is pending', () => {
    const body = bookingCancelledReviewPendingMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
    })
    expect(body).not.toContain('£')
    expect(body).toContain('reviewing payments')
    expect(body).toContain('confirm any refund shortly')
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
    () => depositReminder3DayMessage({ customerFirstName: 'A', eventDate: 'x', depositAmount: 1 }),
    () => depositReminder1DayMessage({ customerFirstName: 'A', eventDate: 'x', depositAmount: 1 }),
    () => depositReceivedMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingConfirmedMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => balanceReminder21DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1, balanceDueDate: 'y' }),
    () => balanceReminder16DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1, balanceDueDate: 'y' }),
    () => balanceReminder15DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1 }),
    () => balanceReminderDueMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1 }),
    () => finalPaymentMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => setupReminderMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => dateChangedMessage({ customerFirstName: 'A', newEventDate: 'x' }),
    () => eventReminder1DayMessage({ customerFirstName: 'A', guestPart: '' }),
    () => holdExtendedMessage({ customerFirstName: 'A', eventDate: 'x', newExpiryDate: 'y' }),
    () => bookingCancelledHoldMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingCancelledRefundableMessage({ customerFirstName: 'A', eventDate: 'x', refundAmount: 1 }),
    () => bookingCancelledRetentionMessage({ customerFirstName: 'A', eventDate: 'x', retainedAmount: 1, refundAmount: 1 }),
    () => bookingCancelledReviewPendingMessage({ customerFirstName: 'A', eventDate: 'x' }),
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
