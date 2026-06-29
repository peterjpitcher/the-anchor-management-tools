import { describe, expect, it } from 'vitest'
import { getRuleMatch } from './rule-matching'

const baseRule = {
  id: 'r1', priority: 1000, created_at: '2026-01-01',
  match_description: 'tesco', match_transaction_type: 'Card Transaction',
  match_direction: 'out' as const, match_min_amount: null, match_max_amount: null,
}
const ctx = { direction: 'out' as const, amountValue: 20 }

describe('getRuleMatch with typeless (Amex) transactions', () => {
  it('matches a description rule on a typeless row, ignoring the type requirement', () => {
    const r = getRuleMatch(baseRule, { details: 'TESCO STORE 2047 STAINES', transaction_type: null }, ctx)
    expect(r.matched).toBe(true)
    expect(r.hasTransactionTypeMatch).toBe(false)
  })

  it('still requires the type to match when the row HAS a type', () => {
    const r = getRuleMatch(baseRule, { details: 'TESCO STORE 2047', transaction_type: 'Direct Debit' }, ctx)
    expect(r.matched).toBe(false)
  })

  it('does NOT match a type-only rule (no description) against a typeless row', () => {
    const typeOnly = { ...baseRule, id: 'r2', match_description: null, match_transaction_type: 'Cash Deposit', match_direction: 'in' as const }
    const r = getRuleMatch(typeOnly, { details: 'PAYMENT RECEIVED', transaction_type: null }, { direction: 'in', amountValue: 100 })
    expect(r.matched).toBe(false)
  })

  it('still matches a typed row for the type-only rule (regression)', () => {
    const typeOnly = { ...baseRule, id: 'r2', match_description: null, match_transaction_type: 'Cash Deposit', match_direction: 'in' as const }
    const r = getRuleMatch(typeOnly, { details: 'X', transaction_type: 'Cash Deposit' }, { direction: 'in', amountValue: 100 })
    expect(r.matched).toBe(true)
  })
})
