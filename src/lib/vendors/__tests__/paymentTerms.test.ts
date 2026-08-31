import { describe, it, expect } from 'vitest'
import { parsePaymentTermsValue } from '../paymentTerms'
import { DEFAULT_PAYMENT_TERMS_DAYS } from '../paymentTerms'

/**
 * Owner rule, 2026-08-31: seven days unless a customer has been given longer.
 * The default used to be 30 in six separate places, which quietly handed every
 * new customer four times the intended credit.
 */
describe('payment terms', () => {
  it('defaults to seven days', () => {
    expect(DEFAULT_PAYMENT_TERMS_DAYS).toBe(7)
  })

  it('returns undefined for a blank field so the default applies', () => {
    expect(parsePaymentTermsValue(null)).toBeUndefined()
    expect(parsePaymentTermsValue('')).toBeUndefined()
    expect(parsePaymentTermsValue('   ')).toBeUndefined()
  })

  it('keeps an explicitly agreed term, including a longer one', () => {
    expect(parsePaymentTermsValue('30')).toBe(30)
    expect(parsePaymentTermsValue('25')).toBe(25)
    expect(parsePaymentTermsValue('0')).toBe(0)
  })

  it('rejects nonsense rather than guessing', () => {
    expect(parsePaymentTermsValue('-1')).toBeUndefined()
    expect(parsePaymentTermsValue('soon')).toBeUndefined()
  })
})
