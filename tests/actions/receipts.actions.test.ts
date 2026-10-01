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
    formData.set('match_description', 'merchant')
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
        // The existing rules are read first, for the duplicate check. There are none.
        return { insert, select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      }),
    })

    const formData = new FormData()
    formData.set('name', 'Expense out rule')
    formData.set('match_description', 'merchant')
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
    formData.set('match_description', 'merchant')
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
    const rpc = vi.fn().mockResolvedValue({
      data: { updated: 1, skippedIncomingCount: 1 },
      error: null,
    })

    mockedCreateAdminClient.mockReturnValue({
      rpc,
    })

    const result = await applyReceiptGroupClassification({
      details: 'Shared detail',
      expenseCategory: 'Entertainment',
    })

    expect(result).toEqual({ success: true, updated: 1, skippedIncomingCount: 1 })
    expect(rpc).toHaveBeenCalledWith('apply_receipt_group_classification_atomic', expect.objectContaining({
      p_details: 'Shared detail',
      p_vendor_provided: false,
      p_vendor_id: null,
      p_vendor_name: null,
      p_expense_provided: true,
      p_expense_category: 'Entertainment',
      p_user_id: 'user-1',
    }))
  })
})
