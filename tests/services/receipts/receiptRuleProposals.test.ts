import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { checkSuggestionsAgainstPayments, performSuggestReceiptRules } from '@/services/receipts/receiptRuleProposals'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

/**
 * Proposing rules from payments that already carry a vendor.
 *
 * The old generator took its keyword from the AI's free text: 27 of the first 68 proposals had a
 * keyword that appeared in none of the payments they were raised from. A keyword now comes from
 * the payments themselves and is checked against every other vendor's payments.
 */

type Row = Record<string, unknown>

const mockedCreateAdminClient = createAdminClient as unknown as Mock

let nextPayment = 0

function payment(details: string, overrides: Row = {}): Row {
  nextPayment += 1
  return {
    id: `tx-${String(nextPayment).padStart(3, '0')}`,
    transaction_date: '2026-09-15',
    details,
    transaction_type: null,
    amount_in: null,
    amount_out: 30,
    status: 'pending',
    marked_method: null,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    no_category_applies: false,
    expense_category_source: null,
    expense_rule_id: null,
    updated_at: 'v1',
    ...overrides,
  }
}

function forVendor(vendorId: string, name: string, details: string, overrides: Row = {}): Row {
  return payment(details, { vendor_id: vendorId, vendor_name: name, vendor_source: 'manual', ...overrides })
}

function vendor(id: string, name: string, overrides: Row = {}): Row {
  return { id, canonical_name: name, kind: 'business', status: 'confirmed', ...overrides }
}

function rule(id: string, overrides: Row = {}): Row {
  return {
    id,
    name: id,
    is_active: true,
    priority: 100,
    created_at: '2026-01-01T00:00:00Z',
    match_description: null,
    match_transaction_type: null,
    match_direction: 'out',
    match_min_amount: null,
    match_max_amount: null,
    vendor_id: null,
    set_vendor_name: null,
    set_expense_category: null,
    set_no_category: false,
    auto_status: 'pending',
    kind: 'standard',
    ...overrides,
  }
}

function arrange(seed: {
  payments: Row[]
  vendors?: Row[]
  rules?: Row[]
  suggestions?: Row[]
  employees?: Row[]
  settings?: Row[]
}): FakeDb {
  const db = createFakeDb({
    receipt_transactions: seed.payments,
    receipt_vendors: seed.vendors ?? [vendor('v-booker', 'Booker'), vendor('v-tesco', 'Tesco')],
    receipt_rules: seed.rules ?? [],
    receipt_rule_suggestions: seed.suggestions ?? [],
    employees: seed.employees ?? [],
    receipt_settings: seed.settings ?? [],
  })
  mockedCreateAdminClient.mockReturnValue(db.client)
  return db
}

function created(db: FakeDb): Row[] {
  return db.rows('receipt_rule_suggestions').filter((row) => !row.status)
}

beforeEach(() => {
  vi.clearAllMocks()
  nextPayment = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('performSuggestReceiptRules: a rule for a vendor no rule sets yet', () => {
  it('proposes a keyword taken from the payments, with what it would match', async () => {
    const db = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'CARD PURCHASE BOOKER WHOLESALE STAINES 01'),
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE STAINES 02', { vendor_source: 'ai' }),
        payment('BOOKER WHOLESALE STAINES 03'),
        forVendor('v-tesco', 'Tesco', 'TESCO STORES 1234'),
      ],
    })

    const result = await performSuggestReceiptRules()

    expect(result).toEqual({ reviewed: 4, created: 1 })
    expect(created(db)).toEqual([
      expect.objectContaining({
        suggested_name: 'Booker auto-tag',
        match_description: 'booker wholesale staines',
        match_transaction_type: null,
        match_direction: 'out',
        set_vendor_id: 'v-booker',
        set_vendor_name: 'Booker',
        set_expense_category: null,
        auto_status: 'pending',
        evidence_transaction_ids: ['tx-001', 'tx-002'],
        evidence: {
          source: 'checked',
          kind: 'new_rule',
          transaction_count: 2,
          // The third payment has no vendor yet: the rule would name it, and that is not a clash.
          preview_match_count: 3,
          collision_count: 0,
          details_samples: ['CARD PURCHASE BOOKER WHOLESALE STAINES 01', 'BOOKER WHOLESALE STAINES 02'],
        },
      }),
    ])
  })

  it('carries a category only when people gave these payments the same one', async () => {
    const agreed = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1', { expense_category: 'Sundries/Consumables', expense_category_source: 'manual' }),
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 2', { expense_category: 'Sundries/Consumables', expense_category_source: 'ai_accepted' }),
      ],
    })
    await performSuggestReceiptRules()
    expect(created(agreed)[0]).toMatchObject({ set_expense_category: 'Sundries/Consumables' })

    const disagreed = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1', { expense_category: 'Sundries/Consumables', expense_category_source: 'manual' }),
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 2', { expense_category: 'Drinks Gas', expense_category_source: 'manual' }),
      ],
    })
    await performSuggestReceiptRules()
    expect(created(disagreed)[0]).toMatchObject({ set_expense_category: null })

    // A category a rule or the AI wrote is not evidence of what people think.
    const machine = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1', { expense_category: 'Sundries/Consumables', expense_category_source: 'rule' }),
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 2', { expense_category: 'Sundries/Consumables', expense_category_source: 'ai' }),
      ],
    })
    await performSuggestReceiptRules()
    expect(created(machine)[0]).toMatchObject({ set_expense_category: null })
  })

  it('records how many payments of other vendors the keyword would also catch', async () => {
    const db = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'BOOKER 1'),
        forVendor('v-booker', 'Booker', 'BOOKER 2'),
        forVendor('v-tesco', 'Tesco', 'TESCO BOOKER PARTNERSHIP'),
      ],
    })

    await performSuggestReceiptRules()

    expect(created(db)[0]).toMatchObject({
      match_description: 'booker',
      evidence: expect.objectContaining({ preview_match_count: 3, collision_count: 1 }),
    })
  })

  it('proposes nothing from a single payment', async () => {
    const db = arrange({ payments: [forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1')] })

    expect(await performSuggestReceiptRules()).toEqual({ reviewed: 1, created: 0 })
    expect(created(db)).toEqual([])
  })

  it('proposes nothing where the payments share only how they were paid', async () => {
    const db = arrange({
      payments: [forVendor('v-booker', 'Booker', 'CARD PURCHASE 0412'), forVendor('v-booker', 'Booker', 'CARD PURCHASE 0915')],
    })

    await performSuggestReceiptRules()

    expect(created(db)).toEqual([])
  })

  it('proposes one rule per trading name when a vendor’s payments share no single text', async () => {
    const db = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1'),
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 2'),
        forVendor('v-booker', 'Booker', 'MAKRO SELF SERVICE 1'),
        forVendor('v-booker', 'Booker', 'MAKRO SELF SERVICE 2'),
        forVendor('v-booker', 'Booker', 'SOMETHING ELSE ENTIRELY'),
      ],
    })

    await performSuggestReceiptRules()

    expect(created(db).map((row) => row.match_description).sort()).toEqual(['booker wholesale', 'makro self service'])
  })

  it('proposes nothing for a vendor who is a person, or one that is merged or inactive', async () => {
    const db = arrange({
      payments: [
        forVendor('v-person', 'A Cleaner', 'CLEANING SERVICES 1'),
        forVendor('v-person', 'A Cleaner', 'CLEANING SERVICES 2'),
        forVendor('v-merged', 'Bookers', 'BOOKERS CASH 1'),
        forVendor('v-merged', 'Bookers', 'BOOKERS CASH 2'),
        forVendor('v-inactive', 'Old Supplier', 'OLD SUPPLIER 1'),
        forVendor('v-inactive', 'Old Supplier', 'OLD SUPPLIER 2'),
      ],
      vendors: [
        vendor('v-person', 'A Cleaner', { kind: 'person' }),
        vendor('v-merged', 'Bookers', { status: 'merged' }),
        vendor('v-inactive', 'Old Supplier', { status: 'inactive' }),
      ],
    })

    await performSuggestReceiptRules()

    expect(created(db)).toEqual([])
  })

  it('takes no part of a payment that names a member of staff', async () => {
    const db = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'MORWENNA TREVITHICK EXPENSES 1'),
        forVendor('v-booker', 'Booker', 'MORWENNA TREVITHICK EXPENSES 2'),
      ],
      employees: [{ employee_id: 'e1', first_name: 'Morwenna', last_name: 'Trevithick', preferred_name: null }],
    })

    await performSuggestReceiptRules()

    expect(created(db)).toEqual([])
  })

  it('leaves alone a vendor whose payments a rule set, or an active rule already covers', async () => {
    const byRule = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1', { vendor_source: 'rule', vendor_rule_id: 'r1' }),
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 2', { vendor_source: 'rule', vendor_rule_id: 'r1' }),
      ],
    })
    await performSuggestReceiptRules()
    expect(created(byRule)).toEqual([])

    const covered = arrange({
      payments: [forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1'), forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 2')],
      rules: [rule('r1', { match_description: 'booker', vendor_id: 'v-booker', set_vendor_name: 'Booker' })],
    })
    await performSuggestReceiptRules()
    expect(created(covered)).toEqual([])
  })

  it.each(['pending', 'approved', 'declined'])('does not raise again a suggestion that is %s', async (status) => {
    const db = arrange({
      payments: [forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1'), forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 2')],
      suggestions: [
        {
          id: 'old',
          status,
          suggested_name: 'Booker auto-tag',
          match_description: 'Booker Wholesale',
          match_direction: 'out',
          match_min_amount: null,
          match_max_amount: null,
          set_vendor_id: 'v-booker',
          set_vendor_name: 'Booker',
          set_expense_category: null,
          auto_status: 'pending',
        },
      ],
    })

    expect(await performSuggestReceiptRules()).toEqual({ reviewed: 2, created: 0 })
    expect(db.rows('receipt_rule_suggestions')).toHaveLength(1)
  })

  it('does not raise a suggestion identical to a rule that exists, even one switched off', async () => {
    const db = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1'),
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 2'),
      ],
      rules: [rule('r1', { is_active: false, match_description: 'booker wholesale', vendor_id: 'v-booker', set_vendor_name: 'Booker' })],
    })

    await performSuggestReceiptRules()

    expect(created(db)).toEqual([])
  })

  it('raises at most twenty-five in one run', async () => {
    const vendors: Row[] = []
    const payments: Row[] = []
    for (let index = 0; index < 30; index += 1) {
      const id = `v-${index}`
      const name = `Supplier${String.fromCharCode(65 + (index % 26))}${index} Trading`
      vendors.push(vendor(id, name))
      payments.push(forVendor(id, name, `${name.toUpperCase()} INVOICE 1`), forVendor(id, name, `${name.toUpperCase()} INVOICE 2`))
    }
    const db = arrange({ payments, vendors })

    expect(await performSuggestReceiptRules()).toEqual({ reviewed: 60, created: 25 })
    expect(created(db)).toHaveLength(25)
  })
})

describe('performSuggestReceiptRules: a category for a rule that sets none', () => {
  const vendorRule = () => rule('r-bt', { name: 'BT line', match_description: 'bt group', vendor_id: 'v-bt', set_vendor_name: 'BT' })
  const btPayment = (category: string | null, source: string | null, n: number) =>
    payment(`BT GROUP PLC ${n}`, {
      vendor_id: 'v-bt',
      vendor_name: 'BT',
      vendor_source: 'rule',
      vendor_rule_id: 'r-bt',
      expense_category: category,
      expense_category_source: source,
    })

  it('proposes the category people have given the rule’s payments', async () => {
    const db = arrange({
      payments: [btPayment('Telephone', 'manual', 1), btPayment('Telephone', 'ai_accepted', 2), btPayment(null, null, 3)],
      vendors: [vendor('v-bt', 'BT')],
      rules: [vendorRule()],
    })

    expect(await performSuggestReceiptRules()).toEqual({ reviewed: 3, created: 1 })
    expect(created(db)[0]).toMatchObject({
      suggested_name: 'BT line: add Telephone',
      match_description: 'bt group',
      set_vendor_id: 'v-bt',
      set_expense_category: 'Telephone',
      evidence: { source: 'checked', kind: 'add_category', target_rule_id: 'r-bt', target_rule_name: 'BT line', transaction_count: 2 },
    })
  })

  it('proposes nothing when people disagree, or only one has said', async () => {
    const disagree = arrange({
      payments: [btPayment('Telephone', 'manual', 1), btPayment('Licensing', 'manual', 2)],
      vendors: [vendor('v-bt', 'BT')],
      rules: [vendorRule()],
    })
    await performSuggestReceiptRules()
    expect(created(disagree)).toEqual([])

    const single = arrange({
      payments: [btPayment('Telephone', 'manual', 1), btPayment(null, null, 2)],
      vendors: [vendor('v-bt', 'BT')],
      rules: [vendorRule()],
    })
    await performSuggestReceiptRules()
    expect(created(single)).toEqual([])
  })

  it.each([
    ['already sets a category', { set_expense_category: 'Licensing' }],
    ['says no category applies', { set_no_category: true }],
    ['matches money in as well', { match_direction: 'both' }],
    ['is switched off', { is_active: false }],
  ])('proposes nothing for a rule that %s', async (_label, change) => {
    const db = arrange({
      payments: [btPayment('Telephone', 'manual', 1), btPayment('Telephone', 'manual', 2)],
      vendors: [vendor('v-bt', 'BT')],
      rules: [{ ...vendorRule(), ...change }],
    })

    await performSuggestReceiptRules()

    expect(created(db)).toEqual([])
  })

  it('proposes nothing for a rule that names a person', async () => {
    const db = arrange({
      payments: [btPayment('Total Staff', 'manual', 1), btPayment('Total Staff', 'manual', 2)],
      vendors: [vendor('v-bt', 'BT', { kind: 'person' })],
      rules: [vendorRule()],
    })

    await performSuggestReceiptRules()

    expect(created(db)).toEqual([])
  })
})

describe('performSuggestReceiptRules: when something cannot be read', () => {
  it('throws, so the job is retried and nothing half-done is stored', async () => {
    const db = arrange({ payments: [forVendor('v-booker', 'Booker', 'BOOKER 1'), forVendor('v-booker', 'Booker', 'BOOKER 2')] })
    db.failNext({ table: 'receipt_rules', operation: 'select', message: 'connection reset' })

    await expect(performSuggestReceiptRules()).rejects.toThrow('Failed to load receipt rules: connection reset')
    expect(created(db)).toEqual([])
  })

  it('throws when the suggestions cannot be stored', async () => {
    const db = arrange({ payments: [forVendor('v-booker', 'Booker', 'BOOKER 1'), forVendor('v-booker', 'Booker', 'BOOKER 2')] })
    db.failNext({ table: 'receipt_rule_suggestions', operation: 'insert', message: 'disk full' })

    await expect(performSuggestReceiptRules()).rejects.toThrow('Failed to create receipt rule suggestions: disk full')
  })
})

describe('checkSuggestionsAgainstPayments', () => {
  it('counts matches and clashes for each suggestion, with the matcher in use', async () => {
    const db = arrange({
      payments: [
        forVendor('v-booker', 'Booker', 'BOOKER WHOLESALE 1'),
        forVendor('v-tesco', 'Tesco', 'FACEBOOKER ADS'),
        payment('BOOKER NO VENDOR'),
      ],
    })

    const checks = await checkSuggestionsAgainstPayments(db.client as never, [
      { id: 's1', match_description: 'booker', set_vendor_id: 'v-booker' },
      { id: 's2', match_description: null, set_vendor_id: 'v-booker' },
    ])

    expect(checks.get('s1')).toEqual({ matchCount: 3, collisions: 1 })
    expect(checks.get('s2')).toEqual({ matchCount: 0, collisions: 0 })

    db.rows('receipt_settings').push({ key: 'rule_matcher', value: { mode: 'word' } })
    const wholeWord = await checkSuggestionsAgainstPayments(db.client as never, [
      { id: 's1', match_description: 'booker', set_vendor_id: 'v-booker' },
    ])
    // "booker" inside "facebooker" is not a whole word.
    expect(wholeWord.get('s1')).toEqual({ matchCount: 2, collisions: 0 })
  })

  it('reads nothing when there is nothing to check', async () => {
    const db = arrange({ payments: [] })
    db.failNext({ table: 'receipt_transactions', operation: 'select', message: 'should not be read' })

    expect((await checkSuggestionsAgainstPayments(db.client as never, [])).size).toBe(0)
  })
})
