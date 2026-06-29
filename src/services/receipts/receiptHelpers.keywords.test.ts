import { describe, expect, it } from 'vitest'
import { buildRuleSuggestion, sanitizeRuleKeywords } from './receiptHelpers'

describe('sanitizeRuleKeywords', () => {
  it('extracts the distinctive vendor token from details', () => {
    expect(sanitizeRuleKeywords('TESCO STORE 2047 2047TE STAINES', null)).toBe('tesco')
  })
  it('prefers AI keywords but drops generic/stopword/short tokens', () => {
    expect(sanitizeRuleKeywords('x', 'the,uk,ltd,amazon,store')).toBe('amazon')
  })
  it('caps at 3 keywords', () => {
    expect(sanitizeRuleKeywords('costco wickes wholesale sunbury hanworth', null)?.split(',').length).toBeLessThanOrEqual(3)
  })
  it('returns null when nothing distinctive remains', () => {
    expect(sanitizeRuleKeywords('THE UK LTD STORE', 'the,uk,ltd')).toBeNull()
  })
})

describe('buildRuleSuggestion (Move 2/3)', () => {
  const tx: any = { details: 'TESCO STORE 2047 STAINES', transaction_type: 'Card Transaction', amount_in: null, amount_out: 20 }
  it('no longer emits transactionType', () => {
    const s = buildRuleSuggestion(tx, { vendorName: 'Tesco', expenseCategory: null, suggestedRuleKeywords: null })
    expect(s).not.toHaveProperty('transactionType')
  })
  it('uses sanitized keywords for matchDescription', () => {
    const s = buildRuleSuggestion(tx, { vendorName: 'Tesco', expenseCategory: null, suggestedRuleKeywords: null })
    expect(s?.matchDescription).toBe('tesco')
  })
  it('returns null when no distinctive keyword exists', () => {
    const s = buildRuleSuggestion({ ...tx, details: 'THE UK LTD' }, { vendorName: 'X', expenseCategory: null, suggestedRuleKeywords: 'the,uk,ltd' })
    expect(s).toBeNull()
  })
})
