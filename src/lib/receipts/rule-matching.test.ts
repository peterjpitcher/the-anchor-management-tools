import { describe, expect, it } from 'vitest'
import {
  getRuleMatch,
  selectBestReceiptRule,
  type ReceiptRuleMatchable,
} from './rule-matching'

const baseRule: ReceiptRuleMatchable = {
  id: 'base',
  priority: 1000,
  created_at: '2026-01-01T00:00:00.000Z',
  match_description: null,
  match_transaction_type: null,
  match_direction: 'both',
  match_min_amount: null,
  match_max_amount: null,
}

function rule(overrides: Partial<ReceiptRuleMatchable>): ReceiptRuleMatchable {
  return {
    ...baseRule,
    ...overrides,
  }
}

const transaction = {
  details: 'PAYPAL INC BACS ORANGE JELLY LIMIT ZETTLE SETTLEMENT',
  transaction_type: 'BACS',
}

describe('receipt rule matching', () => {
  it('uses lower priority before longer description specificity', () => {
    const selected = selectBestReceiptRule(
      [
        rule({
          id: 'specific',
          priority: 1000,
          match_description: 'PAYPAL INC BACS ORANGE JELLY LIMIT',
        }),
        rule({
          id: 'priority',
          priority: 100,
          match_description: 'PAYPAL',
        }),
      ],
      transaction,
      { direction: 'in', amountValue: 125.5 }
    )

    expect(selected?.id).toBe('priority')
  })

  it('uses description length when priorities are equal', () => {
    const selected = selectBestReceiptRule(
      [
        rule({ id: 'short', match_description: 'PAYPAL' }),
        rule({ id: 'long', match_description: 'PAYPAL INC BACS' }),
      ],
      transaction,
      { direction: 'in', amountValue: 125.5 }
    )

    expect(selected?.id).toBe('long')
  })

  it('uses transaction type and direction specificity when description ties', () => {
    const selected = selectBestReceiptRule(
      [
        rule({ id: 'description-only', match_description: 'PAYPAL' }),
        rule({ id: 'typed', match_description: 'PAYPAL', match_transaction_type: 'BACS' }),
        rule({ id: 'typed-directional', match_description: 'PAYPAL', match_transaction_type: 'BACS', match_direction: 'in' }),
      ],
      transaction,
      { direction: 'in', amountValue: 125.5 }
    )

    expect(selected?.id).toBe('typed-directional')
  })

  it('uses amount constraints when other specificity is equal', () => {
    const selected = selectBestReceiptRule(
      [
        rule({ id: 'unbounded', match_description: 'PAYPAL', match_direction: 'in' }),
        rule({ id: 'bounded', match_description: 'PAYPAL', match_direction: 'in', match_min_amount: 100, match_max_amount: 150 }),
      ],
      transaction,
      { direction: 'in', amountValue: 125.5 }
    )

    expect(selected?.id).toBe('bounded')
  })

  it('falls back to earliest created_at after equal specificity', () => {
    const selected = selectBestReceiptRule(
      [
        rule({ id: 'newer', match_description: 'PAYPAL', created_at: '2026-02-01T00:00:00.000Z' }),
        rule({ id: 'older', match_description: 'PAYPAL', created_at: '2026-01-01T00:00:00.000Z' }),
      ],
      transaction,
      { direction: 'in', amountValue: 125.5 }
    )

    expect(selected?.id).toBe('older')
  })

  it('requires boundaries for short alphanumeric tokens', () => {
    const positive = getRuleMatch(
      rule({ id: 'sdd', match_description: 'sdd' }),
      { details: 'HMRC SDD PAYMENT', transaction_type: null },
      { direction: 'out', amountValue: 10 }
    )
    const negative = getRuleMatch(
      rule({ id: 'sdd', match_description: 'sdd' }),
      { details: 'HMRC SDDS PAYMENT', transaction_type: null },
      { direction: 'out', amountValue: 10 }
    )

    expect(positive.matched).toBe(true)
    expect(negative.matched).toBe(false)
  })
})
