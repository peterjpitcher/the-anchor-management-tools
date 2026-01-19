import { describe, expect, it } from 'vitest'
import { selectBestReceiptRule, type ReceiptRuleMatchable } from '@/lib/receipts/rule-matching'

function rule(overrides: Partial<ReceiptRuleMatchable>): ReceiptRuleMatchable {
  return {
    id: 'rule',
    match_description: null,
    match_transaction_type: null,
    match_direction: 'both',
    match_min_amount: null,
    match_max_amount: null,
    ...overrides,
  }
}

describe('selectBestReceiptRule', () => {
  it('avoids matching short alphanumeric needles inside larger words', () => {
    const selected = selectBestReceiptRule(
      [
        rule({ id: 'dla', match_description: 'DLA', match_direction: 'out' }),
        rule({
          id: 'poundland',
          match_description: 'poundland',
          match_transaction_type: 'Card Transaction',
          match_direction: 'out',
        }),
      ],
      { details: 'Card Purchase POUNDLAND', transaction_type: 'Card Transaction' },
      { direction: 'out', amountValue: 12.5 }
    )

    expect(selected?.id).toBe('poundland')
  })

  it('still matches short alphanumeric needles as standalone tokens', () => {
    const selected = selectBestReceiptRule(
      [rule({ id: 'dla', match_description: 'DLA', match_direction: 'out' })],
      { details: 'MR P J PITCHER & MR B SUMMERS DLA', transaction_type: null },
      { direction: 'out', amountValue: 250 }
    )

    expect(selected?.id).toBe('dla')
  })

  it('prefers direction-specific matches over match_direction=both', () => {
    const selected = selectBestReceiptRule(
      [
        rule({
          id: 'both',
          match_description: 'amazon',
          match_transaction_type: 'Card Transaction',
          match_direction: 'both',
        }),
        rule({
          id: 'out',
          match_description: 'amazon',
          match_transaction_type: 'Card Transaction',
          match_direction: 'out',
        }),
      ],
      { details: 'AMAZON ORDER', transaction_type: 'Card Transaction' },
      { direction: 'out', amountValue: 99 }
    )

    expect(selected?.id).toBe('out')
  })

  it('prefers match_transaction_type matches over rules without a type', () => {
    const selected = selectBestReceiptRule(
      [
        rule({ id: 'generic', match_description: 'tesco', match_direction: 'out' }),
        rule({
          id: 'card',
          match_description: 'tesco',
          match_transaction_type: 'Card Transaction',
          match_direction: 'out',
        }),
      ],
      { details: 'TESCO STORES 2047', transaction_type: 'Card Transaction' },
      { direction: 'out', amountValue: 10.01 }
    )

    expect(selected?.id).toBe('card')
  })

  it('prefers rules that match longer description needles', () => {
    const selected = selectBestReceiptRule(
      [
        rule({
          id: 'short',
          match_description: 'amazon',
          match_transaction_type: 'Card Transaction',
          match_direction: 'out',
        }),
        rule({
          id: 'long',
          match_description: 'amazon marketplace',
          match_transaction_type: 'Card Transaction',
          match_direction: 'out',
        }),
      ],
      { details: 'AMAZON MARKETPLACE LONDON', transaction_type: 'Card Transaction' },
      { direction: 'out', amountValue: 50 }
    )

    expect(selected?.id).toBe('long')
  })
})

