import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn(),
}))

vi.mock('@/lib/openai', () => ({
  classifyReceiptTransaction: vi.fn(),
}))

import { classifyReceiptTransaction } from '@/lib/openai'
import { getOpenAIConfig } from '@/lib/openai/config'
import { classifyReceiptTransactionsWithAI } from '@/lib/receipts/ai-classification'

const mockedGetOpenAIConfig = getOpenAIConfig as unknown as Mock
const mockedClassifyReceipt = classifyReceiptTransaction as unknown as Mock

describe('AI receipt classification incoming expense guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-api-key' })
    mockedClassifyReceipt.mockResolvedValue({
      result: {
        vendorName: 'AI Vendor',
        expenseCategory: 'Entertainment',
        reasoning: 'Matched sample',
      },
      usage: undefined,
    })
  })

  it('skips expense assignment for incoming-only transactions while still allowing vendor tagging', async () => {
    const updatePayloads: Record<string, unknown>[] = []

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
    }

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

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return { select: txSelect, update }
        }
        if (table === 'receipt_transaction_logs') {
          return { insert: logInsert }
        }
        if (table === 'ai_usage_events') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await classifyReceiptTransactionsWithAI(supabase as never, [tx.id])

    expect(mockedClassifyReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'in',
      })
    )
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).toMatchObject({
      vendor_name: 'AI Vendor',
      vendor_source: 'ai',
    })
    expect(updatePayloads[0]).not.toHaveProperty('expense_category')
    expect(updatePayloads[0]).not.toHaveProperty('expense_category_source')
  })
})
