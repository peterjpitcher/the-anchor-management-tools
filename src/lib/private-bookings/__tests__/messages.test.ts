import { describe, it, expect } from 'vitest'
import {
  bookingCancelledRetentionMessage,
  bookingCancelledReviewPendingMessage,
  bookingCancelledPartialRefundMessage,
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
