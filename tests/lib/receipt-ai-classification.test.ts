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
import { classifyReceiptTransactionsWithAI } from '@/lib/receipts/ai-classification'

const mockedGetOpenAIConfig = getOpenAIConfig as unknown as Mock
const mockedClassifyReceipt = classifyReceiptTransaction as unknown as Mock
const mockedClassifyBatch = classifyReceiptTransactionsBatch as unknown as Mock

function makeMockSupabase(tx: Record<string, unknown>) {
  const updatePayloads: Record<string, unknown>[] = []

  const txSelectIn = vi.fn().mockResolvedValue({ data: [tx], error: null })
  const txSelect = vi.fn().mockReturnValue({ in: txSelectIn })
  const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: tx.id }, error: null })
  const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
  const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
  const update = vi.fn((payload: Record<string, unknown>) => {
    updatePayloads.push(payload)
    return { eq: updateEq }
  })
  const logInsert = vi.fn().mockResolvedValue({ error: null })

  // For fetchFewShotExamples and fetchCrossTransactionHints
  const logsSelectOrder = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })
  const logsSelectEq = vi.fn().mockReturnValue({ order: logsSelectOrder })
  const logsSelect = vi.fn().mockReturnValue({ eq: logsSelectEq })

  const crossSelectIn = vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ not: vi.fn().mockResolvedValue({ data: [], error: null }) }) })
  const crossSelectNotNull = vi.fn().mockResolvedValue({ data: [], error: null })

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'receipt_transactions') {
        return { select: txSelect, update }
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

  return { supabase, updatePayloads }
}

describe('AI receipt classification batch — incoming expense guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue({
      results: [{
        id: 'tx-incoming',
        vendorName: 'AI Vendor',
        expenseCategory: 'Entertainment',
        reasoning: 'Matched sample',
        confidence: 85,
        suggestedRuleKeywords: 'amazon,refund',
      }],
      usage: undefined,
    })
  })

  it('skips expense assignment for incoming-only transactions while still allowing vendor tagging', async () => {
    const tx = {
      id: 'tx-incoming',
      details: 'Card Purchase Refund AMAZON',
      transaction_type: 'Card Transaction',
      amount_in: 45.5,
      amount_out: null,
      vendor_name: null,
      vendor_source: null,
      vendor_rule_id: null,
      expense_category: null,
      expense_category_source: null,
      expense_rule_id: null,
      status: 'pending',
      ai_confidence: null,
      ai_suggested_keywords: null,
    }

    const { supabase, updatePayloads } = makeMockSupabase(tx)

    await classifyReceiptTransactionsWithAI(supabase as never, [tx.id])

    expect(mockedClassifyBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: tx.id,
            direction: 'in',
          }),
        ]),
      })
    )
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).toMatchObject({
      vendor_name: 'AI Vendor',
      vendor_source: 'ai',
      ai_confidence: 85,
      ai_suggested_keywords: 'amazon,refund',
    })
    expect(updatePayloads[0]).not.toHaveProperty('expense_category')
    expect(updatePayloads[0]).not.toHaveProperty('expense_category_source')
  })
})

describe('AI receipt classification batch — single API call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue({
      results: [
        {
          id: 'tx-1',
          vendorName: 'Sky',
          expenseCategory: 'Sky / PRS / Vidimix',
          reasoning: 'Sky subscription',
          confidence: 90,
          suggestedRuleKeywords: 'sky',
        },
        {
          id: 'tx-2',
          vendorName: 'HMRC',
          expenseCategory: 'Total Staff',
          reasoning: 'PAYE payment',
          confidence: 95,
          suggestedRuleKeywords: 'hmrc,paye',
        },
      ],
      usage: undefined,
    })
  })

  it('sends all transactions in a single batch API call', async () => {
    const txs = [
      {
        id: 'tx-1',
        details: 'SKY SUBSCRIPTION',
        transaction_type: 'Direct Debit',
        amount_in: null,
        amount_out: 85.0,
        vendor_name: null,
        vendor_source: null,
        vendor_rule_id: null,
        expense_category: null,
        expense_category_source: null,
        expense_rule_id: null,
        status: 'pending',
        ai_confidence: null,
        ai_suggested_keywords: null,
      },
      {
        id: 'tx-2',
        details: 'HMRC PAYE 123456',
        transaction_type: 'BACS',
        amount_in: null,
        amount_out: 4500.0,
        vendor_name: null,
        vendor_source: null,
        vendor_rule_id: null,
        expense_category: null,
        expense_category_source: null,
        expense_rule_id: null,
        status: 'pending',
        ai_confidence: null,
        ai_suggested_keywords: null,
      },
    ]

    const updatePayloadsAll: Record<string, unknown>[] = []
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'tx-1' }, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn((payload: Record<string, unknown>) => {
      updatePayloadsAll.push(payload)
      return { eq: updateEq }
    })

    const logsSelectOrder = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })
    const logsSelectEq = vi.fn().mockReturnValue({ order: logsSelectOrder })
    const logsSelect = vi.fn().mockReturnValue({ eq: logsSelectEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: txs, error: null }),
              not: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            }),
            update,
          }
        }
        if (table === 'receipt_transaction_logs') {
          return { select: logsSelect, insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'ai_usage_events') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await classifyReceiptTransactionsWithAI(supabase as never, ['tx-1', 'tx-2'])

    // Should only call batch once, not classifyReceiptTransaction
    expect(mockedClassifyBatch).toHaveBeenCalledTimes(1)
    expect(mockedClassifyReceipt).not.toHaveBeenCalled()

    // Should have sent both transactions in one call
    const callArgs = mockedClassifyBatch.mock.calls[0][0]
    expect(callArgs.items).toHaveLength(2)
    expect(callArgs.items.map((i: { id: string }) => i.id)).toEqual(['tx-1', 'tx-2'])
  })
})

describe('AI receipt classification batch — skip vendor-locked transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue({
      results: [{
        id: 'tx-rule-locked',
        vendorName: null,
        expenseCategory: 'Sky / PRS / Vidimix',
        reasoning: 'Sky sub',
        confidence: 80,
        suggestedRuleKeywords: 'sky',
      }],
      usage: undefined,
    })
  })

  it('sets skipVendor=true when vendor is rule-locked', async () => {
    const tx = {
      id: 'tx-rule-locked',
      details: 'SKY SUBSCRIPTION',
      transaction_type: 'Direct Debit',
      amount_in: null,
      amount_out: 85.0,
      vendor_name: 'Sky TV',
      vendor_source: 'rule',
      vendor_rule_id: 'rule-123',
      expense_category: null,
      expense_category_source: null,
      expense_rule_id: null,
      status: 'pending',
      ai_confidence: null,
      ai_suggested_keywords: null,
    }

    const updatePayloads: Record<string, unknown>[] = []
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: tx.id }, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn((payload: Record<string, unknown>) => {
      updatePayloads.push(payload)
      return { eq: updateEq }
    })

    const logsSelectOrder = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })
    const logsSelectEq = vi.fn().mockReturnValue({ order: logsSelectOrder })
    const logsSelect = vi.fn().mockReturnValue({ eq: logsSelectEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [tx], error: null }),
              not: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            }),
            update,
          }
        }
        if (table === 'receipt_transaction_logs') {
          return { select: logsSelect, insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'ai_usage_events') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await classifyReceiptTransactionsWithAI(supabase as never, [tx.id])

    expect(mockedClassifyBatch).toHaveBeenCalledTimes(1)
    const callArgs = mockedClassifyBatch.mock.calls[0][0]
    expect(callArgs.items[0].skipVendor).toBe(true)
  })
})

describe('AI receipt classification batch — failure logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue(null)
  })

  it('logs ai_classification_failed for all items when batch returns null', async () => {
    const tx = {
      id: 'tx-fail',
      details: 'TEST TRANSACTION',
      transaction_type: null,
      amount_in: null,
      amount_out: 100,
      vendor_name: null,
      vendor_source: null,
      vendor_rule_id: null,
      expense_category: null,
      expense_category_source: null,
      expense_rule_id: null,
      status: 'pending',
      ai_confidence: null,
      ai_suggested_keywords: null,
    }

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

    await classifyReceiptTransactionsWithAI(supabase as never, [tx.id])

    const failLogs = insertedLogs.filter(
      (log: unknown) => (log as Record<string, string>).action_type === 'ai_classification_failed'
    )
    expect(failLogs).toHaveLength(1)
  })
})

describe('AI receipt classification batch — re-classification guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyBatch.mockResolvedValue({
      results: [],
      usage: undefined,
    })
  })

  it('skips transactions already vendor-set by AI when no expense is needed', async () => {
    const tx = {
      id: 'tx-already-ai',
      details: 'EXISTING VENDOR TRANSACTION',
      transaction_type: null,
      amount_in: null,
      amount_out: 50,
      vendor_name: 'Existing Vendor',
      vendor_source: 'ai',
      vendor_rule_id: null,
      expense_category: 'Entertainment',
      expense_category_source: 'ai',
      expense_rule_id: null,
      status: 'pending',
      ai_confidence: null,
      ai_suggested_keywords: null,
    }

    const updatePayloads: Record<string, unknown>[] = []
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const updateFn = vi.fn((p: Record<string, unknown>) => {
      updatePayloads.push(p)
      return { eq: updateEq }
    })
    const logsSelectOrder = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const logsSelectEq = vi.fn().mockReturnValue({ order: logsSelectOrder })
    const logsSelect = vi.fn().mockReturnValue({ eq: logsSelectEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [tx], error: null }),
              not: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
            update: updateFn,
          }
        }
        if (table === 'receipt_transaction_logs') {
          return { select: logsSelect, insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'ai_usage_events') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await classifyReceiptTransactionsWithAI(supabase as never, [tx.id])

    // Batch should not be called because nothing needs classification
    expect(mockedClassifyBatch).not.toHaveBeenCalled()
    expect(updatePayloads).toHaveLength(0)
  })
})
