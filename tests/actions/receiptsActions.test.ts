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

vi.mock('@/lib/receipts/ai-classification', () => ({
  recordAIUsage: vi.fn(),
}))

vi.mock('@/lib/receipts/rule-matching', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/receipts/rule-matching')>()),
  selectBestReceiptRule: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: {
    enqueue: vi.fn().mockResolvedValue({ success: true }),
  },
}))

vi.mock('@/lib/openai', () => ({
  classifyReceiptTransaction: vi.fn(),
}))

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import {
  applyReceiptGroupClassification,
  createReceiptRule,
  getReceiptVendorAiSummary,
  getReceiptVendorCostReview,
  getReceiptVendorDetail,
  getReceiptVendorMovements,
  setReceiptVendorWatched,
  toggleReceiptRule,
  updateReceiptClassification,
  updateReceiptRule,
} from '@/app/actions/receipts'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

describe('receipt actions when the row has gone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'user@example.com' })
  })

  it('returns transaction-not-found when manual classification update affects no rows after prefetch', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        status: 'pending',
        vendor_name: null,
        expense_category: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    mockedCreateAdminClient.mockReturnValue({
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name !== 'resolve_receipt_vendor') throw new Error(`Unexpected rpc: ${name}`)
        return {
          data: { vendor_id: 'vendor-1', canonical_name: String(args.p_name), vendor_key: String(args.p_name).toLowerCase(), status: 'confirmed', kind: 'business', default_expense_category: null, created: false },
          error: null,
        }
      }),
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({ eq: fetchEq }),
            update: vi.fn().mockReturnValue({ eq: updateEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await updateReceiptClassification({
      transactionId: '550e8400-e29b-41d4-a716-446655440001',
      vendorName: 'New Vendor',
    })

    expect(result).toEqual({ error: 'Transaction not found' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('returns rule-not-found when rule update affects no rows', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'receipt_rules') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          // The rule is there when the save reads it, and gone by the time it writes.
          select: vi.fn().mockResolvedValue({ data: [{ id: 'rule-1', name: 'Rule A', is_active: true }], error: null }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('name', 'Rule A')
    formData.set('match_description', 'merchant')
    formData.set('match_direction', 'both')
    formData.set('auto_status', 'no_receipt_required')

    const result = await updateReceiptRule('rule-1', formData)

    expect(result).toEqual({ error: 'Rule not found' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('clears optional rule fields by writing nulls on update', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'rule-1', name: 'Rule A', is_active: true },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'receipt_rules') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          // Read first for the duplicate check and to see what the save changes.
          select: vi.fn().mockResolvedValue({ data: [{ id: 'rule-1', name: 'Rule A', is_active: true }], error: null }),
          update,
        }
      }),
    })

    const formData = new FormData()
    formData.set('name', 'Rule A')
    formData.set('description', '')
    formData.set('match_description', '')
    // A rule needs words to look for or a bank type; direction alone is no longer enough.
    formData.set('match_transaction_type', 'Direct Debit')
    formData.set('match_direction', 'out')
    formData.set('match_min_amount', '')
    formData.set('match_max_amount', '')
    formData.set('auto_status', 'no_receipt_required')
    formData.set('set_vendor_name', '')
    formData.set('set_expense_category', '')

    const result = await updateReceiptRule('rule-1', formData)

    expect('success' in result && result.success).toBe(true)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Rule A',
        description: null,
        match_description: null,
        match_transaction_type: 'Direct Debit',
        match_direction: 'out',
        match_min_amount: null,
        match_max_amount: null,
        auto_status: 'no_receipt_required',
        set_vendor_name: null,
        set_expense_category: null,
        updated_by: 'user-1',
      })
    )
  })

  it('returns rule-not-found when rule toggle affects no rows', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'receipt_rules') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const result = await toggleReceiptRule('rule-1', true)

    expect(result).toEqual({ error: 'Rule not found' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

})

describe('receipt vendor insight action permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(false)
    mockedGetCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'user@example.com' })
  })

  it('blocks vendor detail when user lacks receipt view permission', async () => {
    const result = await getReceiptVendorDetail({ vendorLabel: 'Brewery A' })

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  // These two put the figures into words with OpenAI, which costs money. A view-only user
  // could run up calls: they now need manage.
  it('blocks vendor cost review for someone who can only view', async () => {
    mockedPermission.mockImplementation(async (_module: string, action: string) => action === 'view')

    const result = await getReceiptVendorCostReview({ monthWindow: 12 })

    expect(result).toEqual({ success: false, signals: [], error: 'Insufficient permissions' })
    expect(mockedPermission).toHaveBeenCalledWith('receipts', 'manage')
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('blocks vendor movements when user lacks receipt view permission', async () => {
    const result = await getReceiptVendorMovements({ range: '36m', comparison: 'yoy' })

    expect(result).toEqual({ success: false, movements: [], signals: [], error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('requires current user context for watched-only vendor movements', async () => {
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({ user_id: null, user_email: null })

    await expect(getReceiptVendorMovements({ watchedOnly: true })).rejects.toThrow('Unauthorized')
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('blocks vendor AI summary for someone who can only view', async () => {
    mockedPermission.mockImplementation(async (_module: string, action: string) => action === 'view')

    const result = await getReceiptVendorAiSummary({ vendorLabel: 'Brewery A' })

    expect(result).toEqual({ success: false, signals: [], error: 'Insufficient permissions' })
    expect(mockedPermission).toHaveBeenCalledWith('receipts', 'manage')
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('blocks vendor watchlist updates when user lacks receipt view permission', async () => {
    const result = await setReceiptVendorWatched({ vendorLabel: 'Brewery A', watched: true })

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })
})

describe('Receipts actions expense-direction safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({
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
})
