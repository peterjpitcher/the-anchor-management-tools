import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import {
  verifyTabologySignature,
  deriveSessionDate,
  buildPaymentBreakdowns,
  mapCashupRanToDto,
  type CashupRanData,
} from '@/lib/webhooks/tabology'

const SECRET = 'whsec_test_secret'

function sign(body: string, encoding: 'hex' | 'base64'): string {
  return crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest(encoding)
}

const SAMPLE: CashupRanData = {
  id: 456,
  venue_id: 1,
  from: '2025-01-15T00:00:00+00:00',
  to: '2025-01-15T23:59:59+00:00',
  ran_at: '2025-01-15T23:45:00+00:00',
  ran_by: 'admin@example.com',
  gross_sales: 2450.75,
  payments: {
    cash: { expected: 450, actual: 432.5 },
    card: { expected: 2000.75, actual: 2018.25 },
  },
  closing_cash: { expected: 532.5, actual: 520, variance: -12.5 },
  plan: { meta: { date: '2025-01-15', venue_name: 'Example Venue' } },
  warnings: [],
}

describe('verifyTabologySignature', () => {
  const body = JSON.stringify({ type: 'cashup.ran', id: 'abc' })

  it('accepts a valid hex signature', () => {
    expect(verifyTabologySignature(body, sign(body, 'hex'), SECRET)).toBe(true)
  })

  it('accepts a valid base64 signature', () => {
    expect(verifyTabologySignature(body, sign(body, 'base64'), SECRET)).toBe(true)
  })

  it('tolerates a sha256= prefix', () => {
    expect(verifyTabologySignature(body, `sha256=${sign(body, 'hex')}`, SECRET)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    expect(verifyTabologySignature(body, sign(body, 'hex'), 'other_secret')).toBe(false)
  })

  it('rejects a tampered body', () => {
    const sig = sign(body, 'hex')
    expect(verifyTabologySignature(body + ' ', sig, SECRET)).toBe(false)
  })

  it('rejects a missing signature or secret', () => {
    expect(verifyTabologySignature(body, null, SECRET)).toBe(false)
    expect(verifyTabologySignature(body, sign(body, 'hex'), '')).toBe(false)
    expect(verifyTabologySignature(body, '', SECRET)).toBe(false)
  })
})

describe('deriveSessionDate', () => {
  it('prefers the EPOS trading date (plan.meta.date)', () => {
    expect(deriveSessionDate(SAMPLE)).toBe('2025-01-15')
  })

  it('falls back to the London date of `from` when no meta date', () => {
    const d = deriveSessionDate({ from: '2025-01-20T19:00:00+00:00' })
    expect(d).toBe('2025-01-20')
  })

  it('returns null when no usable date is present', () => {
    expect(deriveSessionDate({})).toBeNull()
    expect(deriveSessionDate({ from: 'not-a-date' })).toBeNull()
  })
})

describe('buildPaymentBreakdowns', () => {
  it('maps expected->expected and actual->counted per method', () => {
    const rows = buildPaymentBreakdowns(SAMPLE.payments)
    expect(rows).toEqual([
      { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 450, countedAmount: 432.5 },
      { paymentTypeCode: 'CARD', paymentTypeLabel: 'Card', expectedAmount: 2000.75, countedAmount: 2018.25 },
    ])
  })

  it('generalises to any payment method present', () => {
    const rows = buildPaymentBreakdowns({ amex: { expected: 10, actual: 11 } })
    expect(rows).toEqual([
      { paymentTypeCode: 'AMEX', paymentTypeLabel: 'Amex', expectedAmount: 10, countedAmount: 11 },
    ])
  })

  it('returns [] for an empty/array/missing payments value', () => {
    expect(buildPaymentBreakdowns(undefined)).toEqual([])
    expect(buildPaymentBreakdowns([])).toEqual([])
    expect(buildPaymentBreakdowns({})).toEqual([])
  })

  it('coerces missing/invalid amounts to 0', () => {
    const rows = buildPaymentBreakdowns({ cash: { expected: undefined, actual: '12.5' as unknown as number } })
    expect(rows[0]).toEqual({ paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 0, countedAmount: 12.5 })
  })
})

describe('mapCashupRanToDto', () => {
  it('builds a submitted session with provenance and no cash counts', () => {
    const result = mapCashupRanToDto(SAMPLE, 'site-uuid')
    expect(result.ok).toBe(true)
    expect(result.dto).toMatchObject({
      siteId: 'site-uuid',
      sessionDate: '2025-01-15',
      status: 'submitted',
      cashCounts: [],
    })
    expect(result.dto?.paymentBreakdowns).toHaveLength(2)
    expect(result.dto?.notes).toContain('EPOS cash-up #456')
    expect(result.dto?.notes).toContain('admin@example.com')
  })

  it('fails when there are no payment methods', () => {
    const result = mapCashupRanToDto({ ...SAMPLE, payments: {} }, 'site-uuid')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_payment_methods')
  })

  it('fails when the date is missing/invalid', () => {
    const result = mapCashupRanToDto({ payments: SAMPLE.payments }, 'site-uuid')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_or_invalid_date')
  })
})
