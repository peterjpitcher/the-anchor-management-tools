import { describe, expect, it } from 'vitest'
import { tablePaymentBlockedReasonMessage } from '@/lib/table-bookings/table-payment-blocked-reason'

describe('tablePaymentBlockedReasonMessage', () => {
  it('maps newly supported blocked reasons to explicit user copy', () => {
    expect(tablePaymentBlockedReasonMessage('invalid_token')).toContain('invalid')
    expect(tablePaymentBlockedReasonMessage('booking_not_found')).toContain('could not find the booking')
    expect(tablePaymentBlockedReasonMessage('token_customer_mismatch')).toContain('does not match')
    expect(tablePaymentBlockedReasonMessage('invalid_amount')).toContain('amount')
  })

  it('falls back to generic copy for unknown reasons', () => {
    expect(tablePaymentBlockedReasonMessage('something_else')).toBe('This payment link is no longer available.')
  })
})
