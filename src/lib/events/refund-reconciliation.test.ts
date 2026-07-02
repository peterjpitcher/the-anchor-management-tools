import { describe, expect, it } from 'vitest'
import { mapPayPalRefundStatus } from './refund-reconciliation'

describe('mapPayPalRefundStatus', () => {
  it('maps COMPLETED to refunded', () => {
    expect(mapPayPalRefundStatus('COMPLETED')).toBe('refunded')
    expect(mapPayPalRefundStatus('completed')).toBe('refunded')
  })

  it('maps PENDING to pending', () => {
    expect(mapPayPalRefundStatus('PENDING')).toBe('pending')
  })

  it('maps FAILED and CANCELLED to failed', () => {
    expect(mapPayPalRefundStatus('FAILED')).toBe('failed')
    expect(mapPayPalRefundStatus('CANCELLED')).toBe('failed')
  })

  it('maps unknown/empty to unknown', () => {
    expect(mapPayPalRefundStatus('SOMETHING_ELSE')).toBe('unknown')
    expect(mapPayPalRefundStatus(null)).toBe('unknown')
    expect(mapPayPalRefundStatus(undefined)).toBe('unknown')
  })
})
