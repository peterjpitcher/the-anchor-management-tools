import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: {
    enqueue: vi.fn().mockResolvedValue({ success: true }),
  },
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  applyReceiptGroupClassification,
  createReceiptRule,
  runReceiptRuleRetroactivelyStep,
  updateReceiptClassification,
  updateReceiptRule,
} from '@/app/actions/receipts'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCurrentUser = getCurrentUser as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('Receipts actions expense-direction safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      user_email: 'user@example.com',
    })
  })

  it('rejects creating expense auto-tag rules unless match_direction is out', async () => {
    const formData = new FormData()
    formData.set('name', 'Expense rule')
    formData.set('match_direction', 'both')
    formData.set('set_expense_category', 'Entertainment')

    const result = await createReceiptRule(formData)

    expect(result).toEqual({ error: 'Expense auto-tagging rules must use outgoing direction' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('allows creating expense auto-tag rules when match_direction is out', async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: 'rule-1', name: 'Expense out rule', is_active: true },
      error: null,
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'receipt_rules') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return { insert }
      }),
    })

    const formData = new FormData()
    formData.set('name', 'Expense out rule')
    formData.set('match_direction', 'out')
    formData.set('set_expense_category', 'Entertainment')

    const result = await createReceiptRule(formData)

    expect('success' in result && result.success).toBe(true)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        match_direction: 'out',
        set_expense_category: 'Entertainment',
        created_by: 'user-1',
      })
    )
  })

  it('rejects updating expense auto-tag rules unless match_direction is out', async () => {
    const formData = new FormData()
    formData.set('name', 'Updated expense rule')
    formData.set('match_direction', 'in')
    formData.set('set_expense_category', 'Entertainment')

    const result = await updateReceiptRule('rule-1', formData)

    expect(result).toEqual({ error: 'Expense auto-tagging rules must use outgoing direction' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('rejects manual expense assignment on incoming-only transactions', async () => {
    const incomingTransactionId = '11111111-1111-4111-8111-111111111111'
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: incomingTransactionId,
        status: 'pending',
        amount_in: 25,
        amount_out: null,
        vendor_name: null,
        expense_category: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const select = vi.fn().mockReturnValue({ eq: fetchEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return { select }
      }),
    })

    const result = await updateReceiptClassification({
      transactionId: incomingTransactionId,
      expenseCategory: 'Entertainment',
    })

    expect(result).toEqual({
      error: 'Expense categories can only be set on outgoing transactions',
    })
  })

  it('applies bulk expense classification only to outgoing rows and reports skips', async () => {
    const updateCalls: Array<{ payload: Record<string, unknown>; field: string; ids: string[] }> = []
    const selectionRows = [
      { id: 'tx-in', status: 'pending', amount_in: 18.5, amount_out: null },
      { id: 'tx-out', status: 'pending', amount_in: null, amount_out: 42.3 },
    ]

    const selectIn = vi.fn().mockResolvedValue({ data: selectionRows, error: null })
    const selectEq = vi.fn().mockReturnValue({ in: selectIn })
    const select = vi.fn().mockReturnValue({ eq: selectEq })

    const update = vi.fn((payload: Record<string, unknown>) => ({
      in: vi.fn(async (field: string, ids: string[]) => {
        updateCalls.push({ payload, field, ids })
        return { error: null }
      }),
    }))

    const logInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return { select, update }
        }
        if (table === 'receipt_transaction_logs') {
          return { insert: logInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await applyReceiptGroupClassification({
      details: 'Shared detail',
      expenseCategory: 'Entertainment',
    })

    expect(result).toEqual({ success: true, updated: 1, skippedIncomingCount: 1 })
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].field).toBe('id')
    expect(updateCalls[0].ids).toEqual(['tx-out'])
    expect(updateCalls[0].payload).toMatchObject({
      expense_category: 'Entertainment',
      expense_category_source: 'manual',
    })
  })

  it('does not apply expense updates during retro rules run for incoming-only transactions', async () => {
    const updatePayloads: Record<string, unknown>[] = []
    const rule = {
      id: 'rule-legacy-both',
      name: 'Legacy refund rule',
      is_active: true,
      match_description: 'refund',
      match_transaction_type: null,
      match_direction: 'both',
      match_min_amount: null,
      match_max_amount: null,
      auto_status: 'no_receipt_required',
      set_vendor_name: 'Vendor from rule',
      set_expense_category: 'Entertainment',
    }

    const incomingTx = {
      id: 'tx-incoming',
      status: 'pending',
      details: 'Card Purchase Refund AMAZON',
      transaction_type: 'Card Transaction',
      amount_in: 12.34,
      amount_out: null,
      vendor_name: null,
      vendor_source: null,
      vendor_rule_id: null,
      expense_category: null,
      expense_category_source: null,
      expense_rule_id: null,
      receipt_required: true,
      marked_by: null,
      marked_by_email: null,
      marked_by_name: null,
      marked_at: null,
      marked_method: null,
      rule_applied_id: null,
    }

    const receiptRulesSelect = vi.fn(() => {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        eq: vi.fn((field: string, value: unknown) => {
          filters[field] = value
          return chain
        }),
        order: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({
          data: filters.id === rule.id ? rule : null,
          error: null,
        })),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [rule], error: null }),
      }
      return chain
    })

    const idsRange = vi.fn().mockResolvedValue({
      data: [{ id: incomingTx.id }],
      count: 1,
      error: null,
    })
    const idsEq = vi.fn().mockReturnValue({ range: idsRange })
    const idsOrder = vi.fn().mockReturnValue({ eq: idsEq })

    const txDetailIn = vi.fn().mockResolvedValue({ data: [incomingTx], error: null })
    const txDetailSelect = vi.fn().mockReturnValue({ in: txDetailIn })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: incomingTx.id }, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn((payload: Record<string, unknown>) => {
      updatePayloads.push(payload)
      return { eq: updateEq }
    })

    const receiptTxSelect = vi.fn((columns: string) => {
      if (columns === 'id') {
        return { order: idsOrder }
      }
      if (columns === '*') {
        return txDetailSelect()
      }
      throw new Error(`Unexpected select columns: ${columns}`)
    })

    const logInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'receipt_rules') {
          return { select: receiptRulesSelect }
        }
        if (table === 'receipt_transactions') {
          return { select: receiptTxSelect, update }
        }
        if (table === 'receipt_transaction_logs') {
          return { insert: logInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await runReceiptRuleRetroactivelyStep({ ruleId: rule.id })

    expect(result.success).toBe(true)
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).toMatchObject({
      vendor_name: 'Vendor from rule',
      vendor_source: 'rule',
    })
    expect(updatePayloads[0]).not.toHaveProperty('expense_category')
    expect(updatePayloads[0]).not.toHaveProperty('expense_category_source')
  })
})
