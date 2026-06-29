import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn(),
}))

vi.mock('@/lib/openai', () => ({
  classifyReceiptTransaction: vi.fn(),
  classifyReceiptTransactionsBatch: vi.fn(),
}))

import { classifyReceiptTransaction, classifyReceiptTransactionsBatch } from '@/lib/openai'
import { getOpenAIConfig } from '@/lib/openai/config'
import { classifyReceiptTransactionsWithAI, AI_SUGGESTION_MIN_CONFIDENCE } from '@/lib/receipts/ai-classification'

const mockedGetOpenAIConfig = getOpenAIConfig as unknown as Mock
const mockedClassifyReceipt = classifyReceiptTransaction as unknown as Mock
const mockedClassifyBatch = classifyReceiptTransactionsBatch as unknown as Mock

type MockOptions = {
  // Rows returned for the .select(...).in('id', ids) load of receipt_transactions.
  transactions: Record<string, unknown>[]
  // Existing pending/approved suggestions for dedupe (match_* + set_* keys).
  existingSuggestions?: Record<string, unknown>[]
  // Existing active rules for dedupe.
  existingRules?: Record<string, unknown>[]
  // Count returned by previewSuggestionMatchCount.
  previewCount?: number
}

type MockHandles = {
  supabase: unknown
  // Payloads passed to receipt_transactions.update() — must stay EMPTY in the new design.
  rowUpdatePayloads: Record<string, unknown>[]
  // Rows inserted into receipt_rule_suggestions.
  suggestionInserts: Record<string, unknown>[][]
  // Rows inserted into receipt_classification_signals.
  signalInserts: Record<string, unknown>[][]
  // True if receipt_transactions.update was ever invoked.
  rowUpdateMock: Mock
}

function makeMockSupabase(options: MockOptions): MockHandles {
  const rowUpdatePayloads: Record<string, unknown>[] = []
  const suggestionInserts: Record<string, unknown>[][] = []
  const signalInserts: Record<string, unknown>[][] = []

  // receipt_transactions.update(...) — should never be called in the new design, but we
  // still wire it so a regression would be observable rather than throwing.
  const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null })
  const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
  const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
  const rowUpdateMock = vi.fn((payload: Record<string, unknown>) => {
    rowUpdatePayloads.push(payload)
    return { eq: updateEq }
  })

  // receipt_transactions.select(...) supports BOTH:
  //  - .in('id', ids)            → load to classify
  //  - .or(...).not(...)         → previewSuggestionMatchCount (returns { count })
  const txSelect = vi.fn(() => ({
    in: vi.fn().mockResolvedValue({ data: options.transactions, error: null }),
    or: vi.fn(() => {
      const result = { count: options.previewCount ?? 0 }
      const chain: any = Promise.resolve(result)
      chain.not = vi.fn().mockResolvedValue(result)
      return chain
    }),
  }))

  // receipt_rule_suggestions.select(...).in('status', [...]) → dedupe list
  const suggestionSelectIn = vi.fn().mockResolvedValue({ data: options.existingSuggestions ?? [], error: null })
  const suggestionSelect = vi.fn().mockReturnValue({ in: suggestionSelectIn })
  const suggestionInsert = vi.fn((rows: Record<string, unknown>[]) => {
    suggestionInserts.push(rows)
    return Promise.resolve({ error: null })
  })

  // receipt_rules.select(...).eq('is_active', true) → dedupe list
  const rulesSelectEq = vi.fn().mockResolvedValue({ data: options.existingRules ?? [], error: null })
  const rulesSelect = vi.fn().mockReturnValue({ eq: rulesSelectEq })

  // fetchFewShotExamples + fetchCrossTransactionHints (both resolve empty)
  const logsSelectOrder = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })
  const logsSelectEq = vi.fn().mockReturnValue({ order: logsSelectOrder })
  const logsSelect = vi.fn().mockReturnValue({ eq: logsSelectEq })
  const logInsert = vi.fn().mockResolvedValue({ error: null })

  const signalInsert = vi.fn((rows: Record<string, unknown>[]) => {
    signalInserts.push(rows)
    return Promise.resolve({ error: null })
  })

  // crossTransactionHints query: receipt_transactions.select().in().in().not()
  // It shares the receipt_transactions handle; we already cover .in() for the load and
  // the hints query via a secondary `.in().not()` path is not reached because crossSelect
  // uses a different select shape. To keep it simple, fetchCrossTransactionHints catches.

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'receipt_transactions') {
        return { select: txSelect, update: rowUpdateMock }
      }
      if (table === 'receipt_rule_suggestions') {
        return { select: suggestionSelect, insert: suggestionInsert }
      }
      if (table === 'receipt_rules') {
        return { select: rulesSelect }
      }
      if (table === 'receipt_transaction_logs') {
        return { select: logsSelect, insert: logInsert }
      }
      if (table === 'ai_usage_events') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      if (table === 'receipt_classification_signals') {
        return { insert: signalInsert }
      }
      if (table === 'receipt_vendors') {
        const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'vendor-1' }, error: null })
        const eq = vi.fn().mockReturnValue({ maybeSingle })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'receipt_vendor_aliases') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  return { supabase, rowUpdatePayloads, suggestionInserts, signalInserts, rowUpdateMock }
}

function baseTx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tx-1',
    details: 'TESCO STORE 2047 STAINES',
    transaction_type: null,
    amount_in: null,
    amount_out: 42.5,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    expense_category_source: null,
    expense_rule_id: null,
    status: 'pending',
    ai_confidence: null,
    ai_suggested_keywords: null,
    source_type: 'amex',
    merchant_category: null,
    merchant_town: null,
    ...overrides,
  }
}

describe('classifyReceiptTransactionsWithAI — guarded suggestions (no row writes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
  })

  it('above-confidence results create a grouped suggestion and never write to rows', async () => {
    mockedClassifyBatch.mockResolvedValue({
      results: [
        { id: 'tx-1', vendorName: 'Tesco', expenseCategory: 'General Purchases', reasoning: 'r', confidence: 90, suggestedRuleKeywords: 'tesco' },
        { id: 'tx-2', vendorName: 'Tesco', expenseCategory: 'General Purchases', reasoning: 'r', confidence: 88, suggestedRuleKeywords: 'tesco' },
      ],
      usage: undefined,
    })

    const handles = makeMockSupabase({
      transactions: [
        baseTx({ id: 'tx-1' }),
        baseTx({ id: 'tx-2', details: 'TESCO STORE 1199 SUNBURY' }),
      ],
      previewCount: 7,
    })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-1', 'tx-2'])

    // No row writes.
    expect(handles.rowUpdateMock).not.toHaveBeenCalled()
    expect(handles.rowUpdatePayloads).toHaveLength(0)

    // One grouped suggestion inserted.
    expect(handles.suggestionInserts).toHaveLength(1)
    const inserted = handles.suggestionInserts[0]
    expect(inserted).toHaveLength(1)
    const suggestion = inserted[0]
    expect(suggestion.match_transaction_type).toBeNull()
    expect(suggestion.match_description).toBe('tesco')
    expect(suggestion.evidence_transaction_ids).toEqual(expect.arrayContaining(['tx-1', 'tx-2']))
    expect((suggestion.evidence as Record<string, unknown>).ai_confidence).toBe(90)
    expect((suggestion.evidence as Record<string, unknown>).preview_match_count).toBe(7)
  })

  it('skips results below the confidence floor — no suggestion and no row update', async () => {
    mockedClassifyBatch.mockResolvedValue({
      results: [
        { id: 'tx-1', vendorName: 'Tesco', expenseCategory: 'General Purchases', reasoning: 'r', confidence: AI_SUGGESTION_MIN_CONFIDENCE - 1, suggestedRuleKeywords: 'tesco' },
      ],
      usage: undefined,
    })

    const handles = makeMockSupabase({ transactions: [baseTx({ id: 'tx-1' })] })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-1'])

    expect(handles.rowUpdateMock).not.toHaveBeenCalled()
    expect(handles.suggestionInserts).toHaveLength(0)
  })

  it('skips a vendor that already matches an active rule (dedupe)', async () => {
    mockedClassifyBatch.mockResolvedValue({
      results: [
        { id: 'tx-1', vendorName: 'Tesco', expenseCategory: null, reasoning: 'r', confidence: 95, suggestedRuleKeywords: 'tesco' },
      ],
      usage: undefined,
    })

    // An active rule with the same dedupe key (match_description tesco, direction out, vendor Tesco).
    const handles = makeMockSupabase({
      transactions: [baseTx({ id: 'tx-1' })],
      existingRules: [
        { match_description: 'tesco', match_direction: 'out', set_vendor_name: 'Tesco', set_expense_category: null },
      ],
    })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-1'])

    expect(handles.rowUpdateMock).not.toHaveBeenCalled()
    expect(handles.suggestionInserts).toHaveLength(0)
  })

  it('skips a vendor that already has a pending suggestion (dedupe)', async () => {
    mockedClassifyBatch.mockResolvedValue({
      results: [
        { id: 'tx-1', vendorName: 'Tesco', expenseCategory: null, reasoning: 'r', confidence: 95, suggestedRuleKeywords: 'tesco' },
      ],
      usage: undefined,
    })

    const handles = makeMockSupabase({
      transactions: [baseTx({ id: 'tx-1' })],
      existingSuggestions: [
        { match_description: 'tesco', match_direction: 'out', set_vendor_name: 'Tesco', set_expense_category: null },
      ],
    })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-1'])

    expect(handles.suggestionInserts).toHaveLength(0)
  })

  it('still sends a single batch call and never falls back to per-transaction classification', async () => {
    mockedClassifyBatch.mockResolvedValue({
      results: [
        { id: 'tx-1', vendorName: 'Tesco', expenseCategory: null, reasoning: 'r', confidence: 90, suggestedRuleKeywords: 'tesco' },
      ],
      usage: undefined,
    })

    const handles = makeMockSupabase({ transactions: [baseTx({ id: 'tx-1' })], previewCount: 1 })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-1'])

    expect(mockedClassifyBatch).toHaveBeenCalledTimes(1)
    expect(mockedClassifyReceipt).not.toHaveBeenCalled()
  })
})

describe('AI receipt classification batch — single API call (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue({
      results: [
        { id: 'tx-1', vendorName: 'Sky', expenseCategory: 'Sky / PRS / Vidimix', reasoning: 'Sky subscription', confidence: 90, suggestedRuleKeywords: 'sky' },
        { id: 'tx-2', vendorName: 'HMRC', expenseCategory: 'Total Staff', reasoning: 'PAYE payment', confidence: 95, suggestedRuleKeywords: 'hmrc' },
      ],
      usage: undefined,
    })
  })

  it('sends all transactions in a single batch API call', async () => {
    const txs = [
      baseTx({ id: 'tx-1', details: 'SKY SUBSCRIPTION', transaction_type: 'Direct Debit', amount_out: 85.0, source_type: 'bank' }),
      baseTx({ id: 'tx-2', details: 'HMRC PAYE 123456', transaction_type: 'BACS', amount_out: 4500.0, source_type: 'bank' }),
    ]

    const handles = makeMockSupabase({ transactions: txs, previewCount: 2 })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-1', 'tx-2'])

    expect(mockedClassifyBatch).toHaveBeenCalledTimes(1)
    expect(mockedClassifyReceipt).not.toHaveBeenCalled()
    const callArgs = mockedClassifyBatch.mock.calls[0][0]
    expect(callArgs.items).toHaveLength(2)
    expect(callArgs.items.map((i: { id: string }) => i.id)).toEqual(['tx-1', 'tx-2'])
  })
})

describe('AI receipt classification batch — skip vendor-locked transactions (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue({
      results: [{ id: 'tx-rule-locked', vendorName: null, expenseCategory: 'Sky / PRS / Vidimix', reasoning: 'Sky sub', confidence: 80, suggestedRuleKeywords: 'sky' }],
      usage: undefined,
    })
  })

  it('sets skipVendor=true when vendor is rule-locked', async () => {
    const tx = baseTx({
      id: 'tx-rule-locked',
      details: 'SKY SUBSCRIPTION',
      transaction_type: 'Direct Debit',
      amount_out: 85.0,
      vendor_name: 'Sky TV',
      vendor_source: 'rule',
      vendor_rule_id: 'rule-123',
      source_type: 'bank',
    })

    const handles = makeMockSupabase({ transactions: [tx], previewCount: 1 })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-rule-locked'])

    expect(mockedClassifyBatch).toHaveBeenCalledTimes(1)
    const callArgs = mockedClassifyBatch.mock.calls[0][0]
    expect(callArgs.items[0].skipVendor).toBe(true)
  })
})

describe('AI receipt classification batch — failure logging (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue(null)
  })

  it('logs ai_classification_failed for all items when batch returns null', async () => {
    const tx = baseTx({ id: 'tx-fail', details: 'TEST TRANSACTION', amount_out: 100, source_type: 'bank' })

    const insertedLogs: unknown[] = []
    const logsSelectOrder = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })
    const logsSelectEq = vi.fn().mockReturnValue({ order: logsSelectOrder })
    const logsSelect = vi.fn().mockReturnValue({ eq: logsSelectEq })
    const logInsert = vi.fn((logs: unknown[]) => {
      insertedLogs.push(...logs)
      return Promise.resolve({ error: null })
    })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [tx], error: null }),
              not: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            }),
          }
        }
        if (table === 'receipt_transaction_logs') {
          return { select: logsSelect, insert: logInsert }
        }
        if (table === 'ai_usage_events') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await classifyReceiptTransactionsWithAI(supabase as never, ['tx-fail'])

    const failLogs = insertedLogs.filter(
      (log: unknown) => (log as Record<string, string>).action_type === 'ai_classification_failed'
    )
    expect(failLogs).toHaveLength(1)
  })
})

describe('AI receipt classification batch — re-classification guard (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue({ results: [], usage: undefined })
  })

  it('skips transactions already vendor-set by AI when no expense is needed', async () => {
    const tx = baseTx({
      id: 'tx-already-ai',
      details: 'EXISTING VENDOR TRANSACTION',
      amount_out: 50,
      vendor_name: 'Existing Vendor',
      vendor_source: 'ai',
      expense_category: 'Entertainment',
      expense_category_source: 'ai',
      source_type: 'bank',
    })

    const handles = makeMockSupabase({ transactions: [tx] })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-already-ai'])

    expect(mockedClassifyBatch).not.toHaveBeenCalled()
    expect(handles.rowUpdateMock).not.toHaveBeenCalled()
    expect(handles.suggestionInserts).toHaveLength(0)
  })
})

describe('AI receipt classification batch — Amex merchant hints (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue({
      results: [{ id: 'tx-amex', vendorName: 'AI Vendor', expenseCategory: 'Entertainment', reasoning: 'Matched merchant hint', confidence: 90, suggestedRuleKeywords: 'merchant' }],
      usage: undefined,
    })
  })

  it('passes merchantHint built from category + town for Amex rows', async () => {
    const tx = baseTx({
      id: 'tx-amex',
      details: 'AMZN MKTP UK',
      amount_out: 42.5,
      source_type: 'amex',
      merchant_category: 'General Purchases-Groceries',
      merchant_town: 'London',
    })

    const handles = makeMockSupabase({ transactions: [tx], previewCount: 1 })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-amex'])

    expect(mockedClassifyBatch).toHaveBeenCalledTimes(1)
    const callArgs = mockedClassifyBatch.mock.calls[0][0]
    expect(callArgs.items[0].merchantHint).toBe('General Purchases-Groceries · London')
  })

  it('leaves merchantHint undefined for bank rows', async () => {
    const tx = baseTx({
      id: 'tx-amex',
      details: 'SKY SUBSCRIPTION',
      transaction_type: 'Direct Debit',
      amount_out: 85.0,
      source_type: 'bank',
    })

    const handles = makeMockSupabase({ transactions: [tx], previewCount: 1 })

    await classifyReceiptTransactionsWithAI(handles.supabase as never, ['tx-amex'])

    expect(mockedClassifyBatch).toHaveBeenCalledTimes(1)
    const callArgs = mockedClassifyBatch.mock.calls[0][0]
    expect(callArgs.items[0].merchantHint).toBeUndefined()
  })
})
