import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// ---------- Module mocks (must come before imports) ----------

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

vi.mock('@/lib/receipts/ai-classification', () => ({
  recordAIUsage: vi.fn(),
}))

vi.mock('@/lib/receipts/rule-matching', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/receipts/rule-matching')>()),
  selectBestReceiptRule: vi.fn(),
  getRuleMatch: vi.fn(),
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

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// ---------- Imports ----------

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import {
  updateReceiptClassification,
  createReceiptRule,
  requeueUnclassifiedTransactions,
} from '@/app/actions/receipts'

// ---------- Typed mock aliases ----------

const mockedPermission = checkUserPermission as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

// ---------- Helpers ----------

const TEST_USER = { user_id: 'user-1', user_email: 'test@example.com' }
const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000'

/**
 * Builds a chainable Supabase mock client. Tables are registered as a map of
 * table name → object with method stubs (select, insert, update, delete, etc.).
 */
function buildMockClient(
  tables: Record<string, Record<string, unknown>>,
  storage?: Record<string, unknown>,
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
) {
  const defaultTables: Record<string, Record<string, unknown>> = {
    receipt_classification_signals: {
      insert: vi.fn().mockResolvedValue({ error: null }),
    },
  }

  const storageClient = storage
    ? {
        download: vi.fn().mockResolvedValue({
          data: {
            arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('receipt-content').buffer),
          },
          error: null,
        }),
        ...storage,
      }
    : undefined

  return {
    from: vi.fn((table: string) => {
      // A rule save reads the existing rules first, for the duplicate check. There are none here.
      if (table === 'receipt_rules') {
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }), ...tables[table] }
      }
      if (tables[table]) return tables[table]
      if (defaultTables[table]) return defaultTables[table]
      throw new Error(`Unexpected table: ${table}`)
    }),
    ...(storageClient ? { storage: { from: vi.fn().mockReturnValue(storageClient) } } : {}),
    // Every vendor name is on the vendor list here, under the spelling it was typed in. The
    // "not on the list" path is covered in tests/services/receipts/receiptVendors.test.ts.
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'resolve_receipt_vendor') {
        return {
          data: {
            vendor_id: 'vendor-1',
            canonical_name: String(args.p_name),
            vendor_key: String(args.p_name).toLowerCase(),
            status: 'confirmed',
            kind: 'business',
            default_expense_category: null,
            created: false,
          },
          error: null,
        }
      }
      if (rpc) return rpc(name, args)
      throw new Error(`Unexpected rpc: ${name}`)
    }),
  }
}

describe('requeueUnclassifiedTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue(TEST_USER)
  })

  it('logs the requeue result without transaction details', async () => {
    // Both reads page now, so each chain ends .order().range() rather than .limit().
    // A first page shorter than the page size tells the pager it has everything.
    const vendorRange = vi.fn().mockResolvedValue({
      data: [{ id: 'tx-1', batch_id: 'batch-1' }],
      error: null,
    })
    const vendorOrder = vi.fn().mockReturnValue({ range: vendorRange })
    const vendorSecondIs = vi.fn().mockReturnValue({ order: vendorOrder })
    const vendorFirstIs = vi.fn().mockReturnValue({ is: vendorSecondIs })

    const expenseRange = vi.fn().mockResolvedValue({
      data: [
        { id: 'tx-1', batch_id: 'batch-1' },
        { id: 'tx-2', batch_id: 'batch-1' },
      ],
      error: null,
    })
    const expenseOrder = vi.fn().mockReturnValue({ range: expenseRange })
    const expenseGt = vi.fn().mockReturnValue({ order: expenseOrder })
    const expenseNot = vi.fn().mockReturnValue({ gt: expenseGt })
    // Transactions marked "no category applies" are left out of the expense read.
    const expenseEq = vi.fn().mockReturnValue({ not: expenseNot })
    const expenseSecondIs = vi.fn().mockReturnValue({ eq: expenseEq })
    const expenseFirstIs = vi.fn().mockReturnValue({ is: expenseSecondIs })
    const select = vi
      .fn()
      .mockReturnValueOnce({ is: vendorFirstIs })
      .mockReturnValueOnce({ is: expenseFirstIs })

    // What the AI has already been asked: tx-3 is not in either read, so nothing is held back.
    const attemptRange = vi.fn().mockResolvedValue({
      data: [{ transaction_id: 'tx-3', outcome: 'nothing_identified' }],
      error: null,
    })
    const attemptOrder = vi.fn().mockReturnValue({ range: attemptRange })
    const attemptEq = vi.fn().mockReturnValue({ order: attemptOrder })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'receipt_ai_attempts') {
          return { select: vi.fn().mockReturnValue({ eq: attemptEq }) }
        }
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return { select }
      }),
    })

    const result = await requeueUnclassifiedTransactions()

    // Two unique transactions (tx-1 appears in both reads) travel in one job;
    // the count reported and logged is transactions, not jobs.
    expect(result).toEqual({ success: true, queued: 2, alreadyAsked: 0 })
    expect(expenseEq).toHaveBeenCalledWith('no_category_applies', false)
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      user_email: 'test@example.com',
      operation_type: 'requeue',
      resource_type: 'receipt_transactions',
      operation_status: 'success',
      additional_info: {
        action: 'requeue_unclassified_transactions',
        queued: 2,
        already_asked: 0,
      },
    }))
    expect(mockedLogAuditEvent.mock.calls[0][0].additional_info.transaction_ids).toBeUndefined()
  })
})

// ==========================================================================
// updateReceiptClassification
// ==========================================================================

describe('updateReceiptClassification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue(TEST_USER)
  })

  it('should return error when user lacks permission', async () => {
    mockedPermission.mockResolvedValue(false)

    const result = await updateReceiptClassification({
      transactionId: TEST_UUID,
      vendorName: 'Tesco',
    })

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should return error when neither vendor nor expense is provided', async () => {
    const result = await updateReceiptClassification({
      transactionId: TEST_UUID,
    })

    expect(result).toEqual({ error: 'Nothing to update' })
  })

  it('should return error when transaction is not found', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
        },
      })
    )

    const result = await updateReceiptClassification({
      transactionId: TEST_UUID,
      vendorName: 'Tesco',
    })

    expect(result).toEqual({ error: 'Transaction not found' })
  })

  it('should reject expense category on incoming-only transactions', async () => {
    const incomingTx = {
      id: TEST_UUID,
      status: 'pending',
      amount_in: 100,
      amount_out: null,
      vendor_name: null,
      expense_category: null,
    }

    const fetchSingle = vi.fn().mockResolvedValue({ data: incomingTx, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
        },
      })
    )

    const result = await updateReceiptClassification({
      transactionId: TEST_UUID,
      expenseCategory: 'Entertainment',
    })

    expect(result).toEqual({ error: 'Expense categories can only be set on outgoing transactions' })
  })

  it('should successfully update vendor classification and log audit event', async () => {
    const existingTx = {
      id: TEST_UUID,
      status: 'pending',
      amount_in: null,
      amount_out: 50,
      vendor_name: null,
      expense_category: null,
      details: 'Coffee shop payment',
    }

    const updatedTx = {
      ...existingTx,
      vendor_name: 'Costa Coffee',
      vendor_source: 'manual',
    }

    const fetchSingle = vi.fn().mockResolvedValue({ data: existingTx, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: updatedTx, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const logInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        },
        receipt_transaction_logs: {
          insert: logInsert,
        },
      })
    )

    const result = await updateReceiptClassification({
      transactionId: TEST_UUID,
      vendorName: 'Costa Coffee',
    })

    expect(result).toMatchObject({ success: true, transaction: updatedTx })
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'update_classification',
        resource_type: 'receipt_transaction',
        resource_id: TEST_UUID,
        operation_status: 'success',
      })
    )
  })

  it('should return success with no-op when values are unchanged', async () => {
    const existingTx = {
      id: TEST_UUID,
      status: 'pending',
      amount_in: null,
      amount_out: 50,
      vendor_name: 'Costa Coffee',
      vendor_id: 'vendor-1',
      expense_category: null,
    }

    const fetchSingle = vi.fn().mockResolvedValue({ data: existingTx, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
        },
      })
    )

    const result = await updateReceiptClassification({
      transactionId: TEST_UUID,
      vendorName: 'Costa Coffee',
    })

    // No change detected — returns early with no DB update
    expect(result).toMatchObject({ success: true, transaction: existingTx, ruleSuggestion: null })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })
})

// ==========================================================================
// createReceiptRule
// ==========================================================================

describe('createReceiptRule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue(TEST_USER)
  })

  function makeRuleFormData(overrides: Record<string, string> = {}): FormData {
    const formData = new FormData()
    formData.set('name', overrides.name ?? 'Test Rule')
    formData.set('match_description', overrides.match_description ?? 'test merchant')
    formData.set('match_direction', overrides.match_direction ?? 'both')
    formData.set('auto_status', overrides.auto_status ?? 'no_receipt_required')
    for (const [key, value] of Object.entries(overrides)) {
      if (!['name', 'match_description', 'match_direction', 'auto_status'].includes(key)) {
        formData.set(key, value)
      }
    }
    return formData
  }

  it('should return error when user lacks permission', async () => {
    mockedPermission.mockResolvedValue(false)

    const result = await createReceiptRule(makeRuleFormData())

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should return error when expense category is set but direction is not out', async () => {
    const result = await createReceiptRule(
      makeRuleFormData({
        match_direction: 'both',
        set_expense_category: 'Entertainment',
      })
    )

    expect(result).toEqual({ error: 'Expense auto-tagging rules must use outgoing direction' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should reject rules without any match condition', async () => {
    const result = await createReceiptRule(
      makeRuleFormData({
        match_description: '',
        match_direction: 'both',
      })
    )

    expect(result).toEqual({ error: 'Add match keywords or a bank transaction type before saving this rule' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should reject a rule that only names a direction', async () => {
    // "Money out" alone would match every otherwise unmatched outgoing payment.
    const result = await createReceiptRule(
      makeRuleFormData({
        match_description: '',
        match_direction: 'out',
      })
    )

    expect(result).toEqual({ error: 'Add match keywords or a bank transaction type before saving this rule' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should successfully create a rule', async () => {
    const createdRule = { id: 'rule-1', name: 'Test Rule', is_active: true }

    const insertSingle = vi.fn().mockResolvedValue({ data: createdRule, error: null })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_rules: { insert },
      })
    )

    const result = await createReceiptRule(makeRuleFormData())

    expect(result).toMatchObject({ success: true, rule: createdRule })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Rule',
        match_description: 'test merchant',
        match_direction: 'both',
        auto_status: 'no_receipt_required',
        created_by: 'user-1',
      })
    )
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'create',
        resource_type: 'receipt_rule',
        operation_status: 'success',
      })
    )
  })

  it('should return error when database insert fails', async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'unique constraint violation' },
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_rules: { insert },
      })
    )

    const result = await createReceiptRule(makeRuleFormData())

    expect(result).toEqual({ error: 'Failed to create rule.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('should allow expense category when direction is out', async () => {
    const createdRule = { id: 'rule-2', name: 'Expense Rule', is_active: true }

    const insertSingle = vi.fn().mockResolvedValue({ data: createdRule, error: null })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_rules: { insert },
      })
    )

    const result = await createReceiptRule(
      makeRuleFormData({
        name: 'Expense Rule',
        match_direction: 'out',
        set_expense_category: 'Entertainment',
      })
    )

    expect('success' in result && result.success).toBe(true)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        match_direction: 'out',
        set_expense_category: 'Entertainment',
      })
    )
  })
})
