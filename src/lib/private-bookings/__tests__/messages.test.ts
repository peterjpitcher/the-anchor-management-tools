import { describe, it, expect } from 'vitest'
import {
  bookingCancelledRetentionMessage,
  bookingCancelledReviewPendingMessage,
  bookingCancelledPartialRefundMessage,
  privateBookingCreatedMessage,
  dateChangedMessage,
  balanceDueDateChangedMessage,
  balanceReminder15DayMessage,
  balanceReminderDueMessage,
  depositReminder3DayMessage,
  depositReminder1DayMessage,
  depositReminder7DayMessage,
} from '../messages'

const MAX_SMS_BODY = 306

describe('bookingCancelledRetentionMessage', () => {
  it('should state the retained amount and the refund when one is due', () => {
    const body = bookingCancelledRetentionMessage({
      customerFirstName: 'Sam',
      eventDate: '19 July 2026',
      retainedAmount: 150,
      refundAmount: 100,
    })
    expect(body).toContain('£150')
    expect(body).toContain('£100')
    expect(body).toContain('Following review')
    expect(body.length).toBeLessThanOrEqual(MAX_SMS_BODY)
  })

  it('should omit the refund sentence when nothing is refunded', () => {
    const body = bookingCancelledRetentionMessage({
      customerFirstName: 'Sam',
      eventDate: '19 July 2026',
      retainedAmount: 250,
      refundAmount: 0,
    })
    expect(body).toContain('£250')
    expect(body).not.toContain('refunded within')
    expect(body.length).toBeLessThanOrEqual(MAX_SMS_BODY)
  })

  it('should never claim retention is automatic or per booking terms', () => {
    const body = bookingCancelledRetentionMessage({
      customerFirstName: 'Sam',
      eventDate: '19 July 2026',
      retainedAmount: 250,
      refundAmount: 0,
    })
    expect(body.toLowerCase()).not.toContain('per our booking terms')
    expect(body.toLowerCase()).not.toContain('non-refundable')
  })
})

describe('bookingCancelledReviewPendingMessage', () => {
  it('should not assert any amounts before the manager decision', () => {
    const body = bookingCancelledReviewPendingMessage({
      customerFirstName: 'Sam',
      eventDate: '19 July 2026',
    })
    expect(body).not.toContain('£')
    expect(body).toContain('review')
    expect(body.length).toBeLessThanOrEqual(MAX_SMS_BODY)
  })
})

describe('bookingCancelledPartialRefundMessage', () => {
  it('should keep the 5% admin deduction wording and stay within SMS length', () => {
    const body = bookingCancelledPartialRefundMessage({
      customerFirstName: 'Sam',
      eventDate: '19 July 2026',
      refundAmount: 237.5,
      deductionAmount: 12.5,
    })
    expect(body).toContain('£12.50')
    expect(body).toContain('£237.50')
    expect(body.length).toBeLessThanOrEqual(MAX_SMS_BODY)
  })
})

describe('privateBookingCreatedMessage', () => {
  it('should quote the deposit deadline when a hold expiry exists', () => {
    const body = privateBookingCreatedMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
      holdExpiry: '12 July 2026',
    })
    expect(body).toContain('secures it by 12 July 2026')
  })

  it('should not invent a deadline when the hold expiry is missing', () => {
    const body = privateBookingCreatedMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
      holdExpiry: null,
    })
    expect(body).toContain('£100 deposit secures it.')
    expect(body).not.toContain(' by ')
  })
})

describe('dateChangedMessage', () => {
  it('should carry the new balance due date when the deadline moved with the event', () => {
    const body = dateChangedMessage({
      customerFirstName: 'Paula',
      newEventDate: '26 July 2026',
      balanceDueDate: '12 July 2026',
    })
    expect(body).toContain('moved to 26 July 2026')
    expect(body).toContain('now due by 12 July 2026')
  })

  it('should stay unchanged when the deadline did not move', () => {
    const body = dateChangedMessage({
      customerFirstName: 'Paula',
      newEventDate: '26 July 2026',
    })
    expect(body).not.toContain('due by')
    expect(body).toContain('All sorted our end.')
  })
})

describe('balanceDueDateChangedMessage', () => {
  it('should tell the customer the new deadline and that nothing else changes', () => {
    const body = balanceDueDateChangedMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      balanceDueDate: '12 July 2026',
    })
    expect(body).toContain('now due by 12 July 2026')
    expect(body).toContain('Everything else stays the same.')
    expect(body.length).toBeLessThanOrEqual(MAX_SMS_BODY)
  })
})

describe('balance reminder date anchoring', () => {
  it('should anchor "tomorrow" to the actual deadline when provided', () => {
    const body = balanceReminder15DayMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      balanceAmount: 120,
      balanceDueDate: '12 July 2026',
    })
    expect(body).toContain('due tomorrow (12 July 2026)')
  })

  it('should anchor "today" to the actual deadline when provided', () => {
    const body = balanceReminderDueMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      balanceAmount: 120,
      balanceDueDate: '12 July 2026',
    })
    expect(body).toContain('due today (12 July 2026)')
  })

  it('should read cleanly without a date (backwards compatible)', () => {
    const body = balanceReminderDueMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      balanceAmount: 120,
    })
    expect(body).toContain('are due today.')
  })
})

describe('deposit reminder hold-expiry anchoring', () => {
  it('should state the actual expiry date on the 3-day reminder', () => {
    const body = depositReminder3DayMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
      holdExpiry: '12 July 2026',
    })
    expect(body).toContain('expires on 12 July 2026')
  })

  it('should vary the 3-day body when the expiry moves (sms-queue body dedup re-arm)', () => {
    const base = {
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
    }
    const before = depositReminder3DayMessage({ ...base, holdExpiry: '12 July 2026' })
    const after = depositReminder3DayMessage({ ...base, holdExpiry: '19 July 2026' })
    expect(before).not.toBe(after)
  })

  it('should anchor the 1-day reminder to the expiry date and vary on change', () => {
    const base = {
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
    }
    const body = depositReminder1DayMessage({ ...base, holdExpiry: '12 July 2026' })
    expect(body).toContain('expires tomorrow (12 July 2026)')
    expect(body).not.toBe(depositReminder1DayMessage({ ...base, holdExpiry: '19 July 2026' }))
  })

  it('should read cleanly without an expiry date (backwards compatible)', () => {
    const body = depositReminder3DayMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
    })
    expect(body).toContain('is expiring soon')
  })
})

describe('depositReminder7DayMessage', () => {
  it('should state the actual expiry date alongside the countdown', () => {
    const body = depositReminder7DayMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
      daysRemaining: 7,
      holdExpiry: '15 July 2026',
    })
    expect(body).toContain('expires in 7 days, on 15 July 2026')
  })

  it('should vary the body when the expiry moves but the countdown does not', () => {
    const base = {
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
      daysRemaining: 7,
    }
    const before = depositReminder7DayMessage({ ...base, holdExpiry: '15 July 2026' })
    const after = depositReminder7DayMessage({ ...base, holdExpiry: '29 July 2026' })
    expect(before).not.toBe(after)
  })

  it('should read cleanly without an expiry date (backwards compatible)', () => {
    const body = depositReminder7DayMessage({
      customerFirstName: 'Paula',
      eventDate: '19 July 2026',
      depositAmount: 100,
      daysRemaining: 7,
    })
    expect(body).toContain('expires in 7 days.')
  })
})
