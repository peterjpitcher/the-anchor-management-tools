import { describe, expect, it } from 'vitest'
import {
  evaluatePaymentAgainstRules,
  paymentAmount,
  paymentDirection,
  type EvaluablePayment,
  type EvaluableRule,
} from './rule-evaluation'
import {
  escapeRuleKeyword,
  getRuleMatch,
  rankMatchingReceiptRules,
  splitRuleKeywords,
} from './rule-matching'
import { compareRuleMatchers, computeRuleHealth, explainRuleMatch } from './rule-health'
import { findDuplicateRule, ruleBehaviourChanged, ruleIdentityKey, ruleKeywordSet } from './rule-identity'

const NOW = '2026-10-01T12:00:00.000Z'

function rule(id: string, overrides: Partial<EvaluableRule> = {}): EvaluableRule {
  return {
    id,
    name: `Rule ${id}`,
    priority: 1000,
    created_at: '2026-01-01T00:00:00Z',
    match_description: 'acme',
    match_transaction_type: null,
    match_direction: 'both',
    match_min_amount: null,
    match_max_amount: null,
    auto_status: 'pending',
    set_vendor_name: null,
    set_expense_category: null,
    vendor_id: null,
    ...overrides,
  }
}

function payment(overrides: Partial<EvaluablePayment> = {}): EvaluablePayment {
  return {
    id: 'tx-1',
    transaction_date: '2026-08-15',
    details: 'CARD PURCHASE ACME LTD',
    transaction_type: 'Card Purchase',
    amount_in: null,
    amount_out: 25,
    status: 'pending',
    marked_method: null,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    expense_category_source: null,
    expense_rule_id: null,
    updated_at: '2026-09-01T10:00:00.000000+00:00',
    ...overrides,
  }
}

const closing = rule('closing', {
  auto_status: 'no_receipt_required',
  set_vendor_name: 'Acme Supplies',
  vendor_id: 'vendor-acme',
  set_expense_category: 'Sundries/Consumables',
})

describe('splitRuleKeywords', () => {
  it('splits on commas and trims', () => {
    expect(splitRuleKeywords(' tesco , asda,  aldi ')).toEqual(['tesco', 'asda', 'aldi'])
  })

  it('keeps a comma that is written with a backslash inside the keyword', () => {
    expect(splitRuleKeywords('smith\\, jones and co, tesco')).toEqual(['smith, jones and co', 'tesco'])
  })

  it('reads back what escapeRuleKeyword wrote, as one keyword', () => {
    const description = 'SMITH, JONES AND CO, LONDON'
    expect(splitRuleKeywords(escapeRuleKeyword(description))).toEqual([description])
  })

  it('drops empty keywords and handles nothing', () => {
    expect(splitRuleKeywords('tesco,,asda,')).toEqual(['tesco', 'asda'])
    expect(splitRuleKeywords('')).toEqual([])
    expect(splitRuleKeywords(null)).toEqual([])
  })
})

describe('the keyword matcher', () => {
  const matches = (keyword: string, details: string, matcher?: 'substring' | 'word') =>
    getRuleMatch(
      { id: 'r', match_description: keyword, match_transaction_type: null, match_direction: 'both', match_min_amount: null, match_max_amount: null },
      { details, transaction_type: null },
      { direction: 'out', amountValue: 10, matcher }
    ).matched

  it('as it has always worked: four letters or more match anywhere, shorter ones must stand alone', () => {
    expect(matches('shell', 'SHELLFISH CO')).toBe(true)
    expect(matches('booker', 'B SUMMERS bookers')).toBe(true)
    expect(matches('bp', 'BP FUEL')).toBe(true)
    expect(matches('bp', 'ABP PORTS')).toBe(false)
  })

  it('whole words: a keyword must stand alone, whatever its length', () => {
    expect(matches('shell', 'SHELLFISH CO', 'word')).toBe(false)
    expect(matches('shell', 'SHELL GARAGE', 'word')).toBe(true)
    expect(matches('shell', 'PAYMENT TO SHELL', 'word')).toBe(true)
    expect(matches('shell', 'WWW.SHELL.CO.UK', 'word')).toBe(true)
    // What the comparison on live data found: plurals and run-together names stop matching.
    expect(matches('booker', 'B SUMMERS bookers', 'word')).toBe(false)
    expect(matches('wickes', 'PAYPAL WICKESBUILD', 'word')).toBe(false)
  })

  it('whole words: a phrase matches across runs of spaces', () => {
    expect(matches('oak farm gas', 'OAK   FARM  GAS CO', 'word')).toBe(true)
    expect(matches('oak farm', 'SOAK FARMER', 'word')).toBe(false)
  })

  it('whole words: a keyword that starts or ends with punctuation is matched as written', () => {
    expect(matches('*amazon', 'AMZN*AMAZON PRIME', 'word')).toBe(true)
    expect(matches('co.', 'ACME CO. LTD', 'word')).toBe(true)
  })

  it('a keyword with an escaped comma matches the whole text, not its pieces', () => {
    expect(matches('smith\\, jones', 'SMITH, JONES AND CO')).toBe(true)
    expect(matches('smith\\, jones', 'JONES THE BUTCHER')).toBe(false)
    // Unescaped, either piece is enough.
    expect(matches('smith, jones', 'JONES THE BUTCHER')).toBe(true)
  })
})

describe('rankMatchingReceiptRules', () => {
  it('returns every matching rule, best first', () => {
    const ranked = rankMatchingReceiptRules(
      [
        rule('short', { match_description: 'acme' }),
        rule('other', { match_description: 'tesco' }),
        rule('long', { match_description: 'acme ltd' }),
        rule('first', { match_description: 'purchase', priority: 10 }),
      ],
      { details: 'CARD PURCHASE ACME LTD', transaction_type: null },
      { direction: 'out', amountValue: 25 }
    )

    expect(ranked.map((entry) => entry.rule.id)).toEqual(['first', 'long', 'short'])
  })
})

describe('paymentDirection and paymentAmount', () => {
  it('money in wins when there is any, otherwise money out', () => {
    expect(paymentDirection({ amount_in: 10, amount_out: null })).toBe('in')
    expect(paymentDirection({ amount_in: 0, amount_out: 5 })).toBe('out')
    expect(paymentAmount({ amount_in: 10, amount_out: null })).toBe(10)
    // A zero in the unused column must not hide the real amount.
    expect(paymentAmount({ amount_in: 0, amount_out: 5 })).toBe(5)
    expect(paymentAmount({ amount_in: null, amount_out: null })).toBe(0)
  })
})

describe('evaluatePaymentAgainstRules: one rule', () => {
  it('plans the status, vendor and category for a pending payment', () => {
    const evaluation = evaluatePaymentAgainstRules(payment(), [closing], { now: NOW })

    expect(evaluation).toMatchObject({ inScope: true, matched: true, protectedByOwner: false, locked: false })
    expect(evaluation.plan).toMatchObject({
      transactionId: 'tx-1',
      expectedUpdatedAt: '2026-09-01T10:00:00.000000+00:00',
      statusChanged: true,
      vendorChanged: true,
      expenseChanged: true,
    })
    expect(evaluation.plan?.after).toEqual({
      status: 'no_receipt_required',
      receipt_required: false,
      marked_by: null,
      marked_by_email: null,
      marked_by_name: null,
      marked_at: NOW,
      marked_method: 'rule',
      vendor_name: 'Acme Supplies',
      vendor_id: 'vendor-acme',
      vendor_source: 'rule',
      vendor_rule_id: 'closing',
      vendor_updated_at: NOW,
      expense_category: 'Sundries/Consumables',
      expense_category_source: 'rule',
      expense_rule_id: 'closing',
      expense_updated_at: NOW,
      rule_applied_id: 'closing',
    })
    expect(evaluation.plan?.logs).toEqual([
      { action_type: 'rule_auto_mark', note: 'Auto-marked by rule: Rule closing', rule_id: 'closing' },
      {
        action_type: 'rule_classification',
        note: 'Classification updated by rule Rule closing: Vendor → Acme Supplies | Expense → Sundries/Consumables',
        rule_id: 'closing',
      },
    ])
  })

  it('plans nothing when the payment is already as the rule would set it', () => {
    const evaluation = evaluatePaymentAgainstRules(
      payment({
        status: 'no_receipt_required',
        vendor_name: 'Acme Supplies',
        vendor_source: 'rule',
        vendor_rule_id: 'closing',
        expense_category: 'Sundries/Consumables',
        expense_category_source: 'rule',
        expense_rule_id: 'closing',
      }),
      [closing],
      { includeClosed: true, now: NOW }
    )

    expect(evaluation.matched).toBe(true)
    expect(evaluation.plan).toBeNull()
  })

  it('does not look at a closed payment unless asked to', () => {
    const evaluation = evaluatePaymentAgainstRules(payment({ status: 'completed' }), [closing], { now: NOW })

    expect(evaluation).toMatchObject({ inScope: false, matched: false, plan: null })
  })

  it('classifies a closed payment and never plans its status', () => {
    const evaluation = evaluatePaymentAgainstRules(payment({ status: 'completed' }), [closing], { includeClosed: true, now: NOW })

    expect(evaluation.plan).toMatchObject({ statusChanged: false, vendorChanged: true, expenseChanged: true })
    expect(evaluation.plan?.after).not.toHaveProperty('status')
    expect(evaluation.plan?.after).not.toHaveProperty('marked_method')
    // A closed payment keeps whatever rule last acted on it while it was pending.
    expect(evaluation.plan?.after).not.toHaveProperty('rule_applied_id')
  })

  it('leaves alone what a person decided, and says so', () => {
    const evaluation = evaluatePaymentAgainstRules(
      payment({ vendor_name: 'Typed By Hand', vendor_source: 'manual', expense_category: 'Entertainment', expense_category_source: 'manual', marked_method: 'manual' }),
      [closing],
      { now: NOW }
    )

    expect(evaluation.protectedByOwner).toBe(true)
    expect(evaluation.plan).toBeNull()
  })

  it('never gives a category to money coming in', () => {
    const evaluation = evaluatePaymentAgainstRules(payment({ amount_in: 100, amount_out: null }), [closing], { now: NOW })

    expect(evaluation.winners.expense).toBeNull()
    expect(evaluation.plan?.expenseChanged).toBe(false)
    expect(evaluation.plan?.after).not.toHaveProperty('expense_category')
  })

  it('plans nothing for a payment on or before the lock date, and reports it as locked', () => {
    const locked = evaluatePaymentAgainstRules(payment({ transaction_date: '2026-03-31' }), [closing], { lockDate: '2026-03-31', now: NOW })
    expect(locked).toMatchObject({ matched: true, locked: true, plan: null })

    const dayAfter = evaluatePaymentAgainstRules(payment({ transaction_date: '2026-04-01' }), [closing], { lockDate: '2026-03-31', now: NOW })
    expect(dayAfter.locked).toBe(false)
    expect(dayAfter.plan).not.toBeNull()
  })

  it('does not call a payment locked when the rules would not change it anyway', () => {
    const evaluation = evaluatePaymentAgainstRules(
      payment({ transaction_date: '2026-03-01', status: 'pending', vendor_name: 'Typed', vendor_source: 'manual', marked_method: 'manual' }),
      [rule('vendor-only', { set_vendor_name: 'Acme Supplies' })],
      { lockDate: '2026-03-31', now: NOW }
    )

    expect(evaluation.locked).toBe(false)
    expect(evaluation.protectedByOwner).toBe(true)
  })

  it('does not write the vendor of a rule whose vendor could not be looked up', () => {
    const evaluation = evaluatePaymentAgainstRules(payment(), [closing], {
      unresolvedVendorRuleIds: new Set(['closing']),
      now: NOW,
    })

    expect(evaluation.vendorUnresolved).toBe(true)
    expect(evaluation.plan?.vendorChanged).toBe(false)
    expect(evaluation.plan?.after).not.toHaveProperty('vendor_name')
    // The rest of what the rule does still stands.
    expect(evaluation.plan?.statusChanged).toBe(true)
  })
})

describe('evaluatePaymentAgainstRules: each field is decided on its own', () => {
  const vendorOnly = rule('vendor-only', { match_description: 'acme ltd', set_vendor_name: 'Acme Supplies', vendor_id: 'vendor-acme' })
  const categoryOnly = rule('category-only', { match_description: 'acme', set_expense_category: 'Sundries/Consumables' })

  it('takes the vendor from the best rule that sets one and the category from the best that sets one', () => {
    const evaluation = evaluatePaymentAgainstRules(payment(), [categoryOnly, vendorOnly], { now: NOW })

    expect(evaluation.winners.status?.id).toBe('vendor-only')
    expect(evaluation.winners.vendor?.id).toBe('vendor-only')
    // The best rule sets no category, so the next one that does supplies it.
    expect(evaluation.winners.expense?.id).toBe('category-only')
    expect(evaluation.plan?.after).toMatchObject({
      vendor_name: 'Acme Supplies',
      vendor_rule_id: 'vendor-only',
      expense_category: 'Sundries/Consumables',
      expense_rule_id: 'category-only',
      rule_applied_id: 'vendor-only',
    })
    // One history row per rule that changed something.
    expect(evaluation.plan?.logs.map((log) => log.rule_id)).toEqual(['vendor-only', 'category-only'])
  })

  it('the status still comes from the best rule only', () => {
    const closes = rule('closes', { match_description: 'acme', auto_status: 'no_receipt_required' })
    const evaluation = evaluatePaymentAgainstRules(payment(), [closes, vendorOnly], { now: NOW })

    // vendor-only is the better match (longer keyword) and leaves the payment pending.
    expect(evaluation.winners.status?.id).toBe('vendor-only')
    expect(evaluation.plan?.statusChanged).toBe(false)
    expect(evaluation.plan?.after).not.toHaveProperty('status')
  })
})

describe('evaluatePaymentAgainstRules: a run of one rule', () => {
  const vendorOnly = rule('vendor-only', { match_description: 'acme ltd', set_vendor_name: 'Acme Supplies', vendor_id: 'vendor-acme' })
  const categoryOnly = rule('category-only', { match_description: 'acme', set_expense_category: 'Sundries/Consumables' })
  const rival = rule('rival', { match_description: 'card purchase acme ltd', set_vendor_name: 'Rival Vendor', set_expense_category: 'Entertainment' })

  it('writes only the fields the target rule wins', () => {
    const evaluation = evaluatePaymentAgainstRules(payment(), [categoryOnly, vendorOnly], { targetRuleId: 'category-only', now: NOW })

    expect(evaluation.matched).toBe(true)
    expect(evaluation.plan?.after).toEqual({
      expense_category: 'Sundries/Consumables',
      expense_category_source: 'rule',
      expense_rule_id: 'category-only',
      expense_updated_at: NOW,
      rule_applied_id: 'category-only',
    })
  })

  it('changes nothing where a higher rule decides every field, and does not take the payment from it', () => {
    const evaluation = evaluatePaymentAgainstRules(payment(), [categoryOnly, vendorOnly, rival], { targetRuleId: 'category-only', now: NOW })

    expect(evaluation.matched).toBe(true)
    expect(evaluation.winners).toEqual({ status: null, vendor: null, expense: null })
    expect(evaluation.plan).toBeNull()
  })

  it('is not matched when the target rule does not match the payment', () => {
    const evaluation = evaluatePaymentAgainstRules(payment({ details: 'TESCO' }), [categoryOnly, rule('tesco', { match_description: 'tesco' })], {
      targetRuleId: 'category-only',
      now: NOW,
    })

    expect(evaluation.matched).toBe(false)
    expect(evaluation.plan).toBeNull()
  })
})

describe('computeRuleHealth', () => {
  const longKeyword = rule('long', { match_description: 'acme ltd', set_vendor_name: 'Acme Supplies', set_expense_category: 'Sundries/Consumables', auto_status: 'no_receipt_required' })
  const shadowed = rule('shadowed', { match_description: 'acme', set_vendor_name: 'Acme Other', set_expense_category: 'Entertainment' })
  const unused = rule('unused', { match_description: 'nothing matches this' })
  const stale = rule('stale', { match_description: 'old supplier' })

  const payments = [
    payment({ id: 'a', transaction_date: '2026-09-20' }),
    payment({ id: 'b', transaction_date: '2026-08-01' }),
    payment({ id: 'c', transaction_date: '2025-01-10', details: 'OLD SUPPLIER LTD' }),
  ]

  it('counts matches and wins, finds the last match, and names the rule that always beats another', () => {
    const health = computeRuleHealth(payments, [longKeyword, shadowed, unused, stale], { today: '2026-10-01' })
    const byId = Object.fromEntries(health.map((item) => [item.ruleId, item]))

    expect(byId.long).toMatchObject({ matches: 2, wins: 2, matchesLast90Days: 2, lastMatchedDate: '2026-09-20', shadowedBy: null })
    expect(byId.shadowed).toMatchObject({ matches: 2, wins: 0, shadowedBy: { id: 'long', name: 'Rule long' } })
    expect(byId.unused).toMatchObject({ matches: 0, wins: 0, lastMatchedDate: null, shadowedBy: null })
    expect(byId.stale).toMatchObject({ matches: 1, wins: 1, matchesLast90Days: 0, lastMatchedDate: '2025-01-10' })
  })
})

describe('compareRuleMatchers', () => {
  it('lists the payments a different rule, or none, would decide under whole-word matching', () => {
    const shell = rule('shell', { name: 'Shell fuel', match_description: 'shell', set_vendor_name: 'Shell', set_expense_category: 'Travel/Car' })
    const fish = rule('fish', { name: 'Fishmonger', match_description: 'shellfish co', set_vendor_name: 'Shellfish Co', priority: 2000 })
    const payments = [
      payment({ id: 'garage', details: 'SHELL GARAGE STAINES' }),
      payment({ id: 'fish', details: 'SHELLFISH CO LTD' }),
      payment({ id: 'none', details: 'TESCO' }),
    ]

    const comparison = compareRuleMatchers(payments, [shell, fish])

    expect(comparison.reviewed).toBe(3)
    expect(comparison.paymentsAffected).toBe(1)
    // Today "shell" wins the fishmonger's payment on every field; as a whole word it does not match.
    expect(comparison.differences.map((difference) => [difference.transactionId, difference.field, difference.fromRule?.name, difference.toRule?.name ?? null])).toEqual([
      ['fish', 'status', 'Shell fuel', 'Fishmonger'],
      ['fish', 'vendor', 'Shell fuel', 'Fishmonger'],
      ['fish', 'expense', 'Shell fuel', null],
    ])
    expect(comparison.byRule).toEqual([
      { ruleId: 'shell', name: 'Shell fuel', lost: 3, gained: 0 },
      { ruleId: 'fish', name: 'Fishmonger', lost: 0, gained: 2 },
    ])
  })

  it('reports nothing when the two matchers agree', () => {
    const comparison = compareRuleMatchers([payment()], [closing])
    expect(comparison).toMatchObject({ paymentsAffected: 0, differences: [] })
  })
})

describe('explainRuleMatch', () => {
  it('says which rule decides each field for a pasted description', () => {
    const vendorOnly = rule('vendor-only', { name: 'Acme vendor', match_description: 'acme ltd', set_vendor_name: 'Acme Supplies' })
    const categoryOnly = rule('category-only', { name: 'Acme category', match_description: 'acme', set_expense_category: 'Sundries/Consumables', auto_status: 'no_receipt_required' })

    const explanation = explainRuleMatch({ details: 'card purchase acme ltd', direction: 'out', amount: 12 }, [categoryOnly, vendorOnly], 'substring')

    expect(explanation.matched.map((entry) => entry.name)).toEqual(['Acme vendor', 'Acme category'])
    expect(explanation.status).toEqual({ ruleId: 'vendor-only', name: 'Acme vendor', outcome: 'pending' })
    expect(explanation.vendor).toEqual({ ruleId: 'vendor-only', name: 'Acme vendor', value: 'Acme Supplies' })
    expect(explanation.category).toEqual({ ruleId: 'category-only', name: 'Acme category', value: 'Sundries/Consumables' })
  })

  it('says so when nothing matches', () => {
    const explanation = explainRuleMatch({ details: 'TESCO', direction: 'out', amount: 0 }, [closing], 'substring')
    expect(explanation).toEqual({ matched: [], status: null, vendor: null, category: null })
  })

  it('respects amount limits and direction', () => {
    const limited = rule('limited', { match_min_amount: 100, match_direction: 'out' })
    expect(explainRuleMatch({ details: 'ACME', direction: 'out', amount: 50 }, [limited], 'substring').matched).toEqual([])
    expect(explainRuleMatch({ details: 'ACME', direction: 'out', amount: 150 }, [limited], 'substring').matched).toHaveLength(1)
    expect(explainRuleMatch({ details: 'ACME', direction: 'in', amount: 150 }, [limited], 'substring').matched).toEqual([])
  })
})

describe('rule identity', () => {
  const base = {
    match_description: 'Acme, Acme Ltd',
    match_transaction_type: null,
    match_direction: 'out',
    match_min_amount: null,
    match_max_amount: null,
    set_vendor_name: 'Acme Supplies',
    vendor_id: 'vendor-acme',
    set_expense_category: 'Sundries/Consumables',
    auto_status: 'pending',
  }

  it('ignores the order, case and spacing of keywords', () => {
    expect(ruleKeywordSet('  ACME   ltd , acme')).toEqual(['acme', 'acme ltd'])
    expect(ruleIdentityKey({ ...base, match_description: 'acme ltd,  ACME ' })).toBe(ruleIdentityKey(base))
  })

  it('treats 100 and 100.00 as the same limit', () => {
    expect(ruleIdentityKey({ ...base, match_min_amount: 100 })).toBe(ruleIdentityKey({ ...base, match_min_amount: '100.00' }))
  })

  it.each([
    ['keywords', { match_description: 'acme' }],
    ['direction', { match_direction: 'both' }],
    ['amount limit', { match_max_amount: 50 }],
    ['bank type', { match_transaction_type: 'Card Purchase' }],
    ['vendor', { vendor_id: 'vendor-other' }],
    ['category', { set_expense_category: 'Entertainment' }],
    ['outcome', { auto_status: 'no_receipt_required' }],
  ])('a different %s is a different rule', (_name, change) => {
    expect(ruleIdentityKey({ ...base, ...change })).not.toBe(ruleIdentityKey(base))
    expect(ruleBehaviourChanged(base, { ...base, ...change })).toBe(true)
  })

  it('finds a duplicate, and not the rule being edited', () => {
    const rules = [
      { id: 'one', ...base },
      { id: 'two', ...base, match_description: 'tesco' },
    ]
    expect(findDuplicateRule(rules, base)?.id).toBe('one')
    expect(findDuplicateRule(rules, base, 'one')).toBeNull()
    expect(findDuplicateRule(rules, { ...base, match_description: 'asda' })).toBeNull()
  })

  it('compares vendors by name only for an old rule with no vendor id', () => {
    const named = { ...base, vendor_id: null }
    expect(ruleIdentityKey(named)).toBe(ruleIdentityKey({ ...named, set_vendor_name: '  acme   SUPPLIES ' }))
    expect(ruleIdentityKey(named)).not.toBe(ruleIdentityKey(base))
  })
})
