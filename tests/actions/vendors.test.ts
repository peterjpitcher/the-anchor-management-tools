import { describe, expect, it } from 'vitest'

import { parsePaymentTermsValue } from '@/lib/vendors/paymentTerms'

describe('parsePaymentTermsValue', () => {
  it('returns undefined for null-like inputs', () => {
    expect(parsePaymentTermsValue(null)).toBeUndefined()
    expect(parsePaymentTermsValue('')).toBeUndefined()
    expect(parsePaymentTermsValue('   ')).toBeUndefined()
  })

  it('preserves explicit zero values', () => {
    expect(parsePaymentTermsValue('0')).toBe(0)
    expect(parsePaymentTermsValue(' 0 ')).toBe(0)
  })

  it('parses positive integer strings', () => {
    expect(parsePaymentTermsValue('30')).toBe(30)
    expect(parsePaymentTermsValue('0015')).toBe(15)
  })

  it('returns undefined for invalid or negative numbers', () => {
    expect(parsePaymentTermsValue('-5')).toBeUndefined()
    expect(parsePaymentTermsValue('not-a-number')).toBeUndefined()
  })
})
