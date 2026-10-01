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
  markReceiptTransaction,
  updateReceiptClassification,
  createReceiptUploadUrl,
  completeReceiptUpload,
  uploadReceiptForTransaction,
  deleteReceiptFile,
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

// ==========================================================================
// markReceiptTransaction
// ==========================================================================

describe('markReceiptTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue(TEST_USER)
  })

  it('should return error when user lacks permission', async () => {
    mockedPermission.mockResolvedValue(false)

    const result = await markReceiptTransaction({
      transactionId: TEST_UUID,
      status: 'completed',
    })

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should return error when validation fails with invalid status', async () => {
    const result = await markReceiptTransaction({
      transactionId: TEST_UUID,
      // Deliberately invalid status: the action takes any string and validates it at runtime.
      status: 'bogus_status',
    })

    expect(result).toHaveProperty('error')
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should return error when transaction is not found', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
        },
        profiles: {
          select: vi.fn().mockReturnValue({ eq: profileEq }),
        },
      })
    )

    const result = await markReceiptTransaction({
      transactionId: TEST_UUID,
      status: 'completed',
    })

    expect(result).toEqual({ error: 'Transaction not found' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('should successfully mark a transaction and log audit event', async () => {
    const existingTransaction = { id: TEST_UUID, status: 'pending' }
    const updatedTransaction = { id: TEST_UUID, status: 'completed', marked_method: 'manual' }

    const fetchSingle = vi.fn().mockResolvedValue({ data: existingTransaction, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test User' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: updatedTransaction, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const logInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        },
        profiles: {
          select: vi.fn().mockReturnValue({ eq: profileEq }),
        },
        receipt_transaction_logs: {
          insert: logInsert,
        },
      })
    )

    const result = await markReceiptTransaction({
      transactionId: TEST_UUID,
      status: 'completed',
      note: 'Found the receipt',
    })

    expect(result).toEqual({ success: true, transaction: updatedTransaction })
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'update_status',
        resource_type: 'receipt_transaction',
        resource_id: TEST_UUID,
        operation_status: 'success',
      })
    )
    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_id: TEST_UUID,
        previous_status: 'pending',
        new_status: 'completed',
        action_type: 'manual_update',
      })
    )
  })

  it("should clear receipt_required when a transaction is marked can't find", async () => {
    const existingTransaction = { id: TEST_UUID, status: 'pending' }
    const updatedTransaction = { id: TEST_UUID, status: 'cant_find', receipt_required: false }

    const fetchSingle = vi.fn().mockResolvedValue({ data: existingTransaction, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test User' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: updatedTransaction, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const logInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update,
        },
        profiles: {
          select: vi.fn().mockReturnValue({ eq: profileEq }),
        },
        receipt_transaction_logs: {
          insert: logInsert,
        },
      })
    )

    const result = await markReceiptTransaction({
      transactionId: TEST_UUID,
      status: 'cant_find',
      receiptRequired: true,
    })

    expect(result).toEqual({ success: true, transaction: updatedTransaction })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cant_find',
        receipt_required: false,
      })
    )
  })

  it('should return error when database update fails', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_UUID, status: 'pending' },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db error' },
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        },
        profiles: {
          select: vi.fn().mockReturnValue({ eq: profileEq }),
        },
      })
    )

    const result = await markReceiptTransaction({
      transactionId: TEST_UUID,
      status: 'completed',
    })

    expect(result).toEqual({ error: 'Failed to update the transaction.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })
})

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
    const expenseSecondIs = vi.fn().mockReturnValue({ not: expenseNot })
    const expenseFirstIs = vi.fn().mockReturnValue({ is: expenseSecondIs })
    const select = vi
      .fn()
      .mockReturnValueOnce({ is: vendorFirstIs })
      .mockReturnValueOnce({ is: expenseFirstIs })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return { select }
      }),
    })

    const result = await requeueUnclassifiedTransactions()

    // Two unique transactions (tx-1 appears in both reads) travel in one job;
    // the count reported and logged is transactions, not jobs.
    expect(result).toEqual({ success: true, queued: 2 })
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      user_email: 'test@example.com',
      operation_type: 'requeue',
      resource_type: 'receipt_transactions',
      operation_status: 'success',
      additional_info: {
        action: 'requeue_unclassified_transactions',
        queued: 2,
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
// uploadReceiptForTransaction
// ==========================================================================

describe('uploadReceiptForTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue(TEST_USER)
  })

  function makeReceiptFormData(transactionId: string): FormData {
    const formData = new FormData()
    formData.set('transactionId', transactionId)
    const file = new File(['pdf-content'], 'receipt.pdf', { type: 'application/pdf' })
    // Node's File implementation may lack arrayBuffer — patch it for Vitest
    ;(file as File & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () =>
      new TextEncoder().encode('pdf-content').buffer
    formData.set('receipt', file)
    return formData
  }

  it('should create a signed upload URL for large receipt files', async () => {
    const transaction = {
      id: 'tx-1',
      transaction_date: '2026-03-15',
      details: 'Coffee',
      amount_in: null,
      amount_out: 4.5,
      status: 'pending',
    }

    const txSelectSingle = vi.fn().mockResolvedValue({ data: transaction, error: null })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { path: '2026/Coffee_4.50.pdf_1770000000000', token: 'signed-token' },
      error: null,
    })
    const intentInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient(
        {
          receipt_transactions: {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
          },
          profiles: {
            select: vi.fn().mockReturnValue({ eq: profileEq }),
          },
          receipt_upload_intents: {
            insert: intentInsert,
          },
        },
        {
          createSignedUploadUrl,
        }
      )
    )

    const result = await createReceiptUploadUrl({
      transactionId: 'tx-1',
      fileName: 'large-receipt.pdf',
      fileType: 'application/pdf',
      fileSize: 8 * 1024 * 1024,
    })

    expect(result).toMatchObject({
      success: true,
      path: '2026/Coffee_4.50.pdf_1770000000000',
      token: 'signed-token',
    })
    expect(createSignedUploadUrl).toHaveBeenCalledWith(expect.stringMatching(/^2026\//), { upsert: false })
    expect(intentInsert).toHaveBeenCalledWith(expect.objectContaining({
      transaction_id: 'tx-1',
      storage_path: '2026/Coffee_4.50.pdf_1770000000000',
      issued_to: TEST_USER.user_id,
    }))
  })

  it('should reject receipt upload URLs over the app receipt file limit', async () => {
    const result = await createReceiptUploadUrl({
      transactionId: 'tx-1',
      fileName: 'too-large.pdf',
      fileType: 'application/pdf',
      fileSize: 51 * 1024 * 1024,
    })

    expect(result).toEqual({ error: 'File is too large. Please keep receipts under 50 MB.' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  // completeReceiptUpload: the file row, the payment, the log and the intent are written by one
  // database function under a lock (tests/sql/receipts covers that function on a real
  // Postgres). These tests cover what the action does around it, above all that it never
  // removes a stored object on the strength of a path the browser sent.
  const uploadTransaction = {
    id: 'tx-1',
    transaction_date: '2026-03-15',
    details: 'Coffee',
    amount_in: null,
    amount_out: 4.5,
    status: 'pending',
  }
  const uploadInput = {
    transactionId: 'tx-1',
    storagePath: '2026/Coffee_4.50.pdf_1770000000000',
    fileName: '2026-03-15 - Coffee - 4.50.pdf',
    fileType: 'application/pdf',
    fileSize: 8 * 1024 * 1024,
  }

  function arrangeUpload(
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
    transaction: Record<string, unknown> | null = uploadTransaction
  ) {
    const txSelectSingle = vi.fn().mockResolvedValue(
      transaction ? { data: transaction, error: null } : { data: null, error: { message: 'not found' } }
    )
    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test User' }, error: null })
    const storageRemove = vi.fn().mockResolvedValue({ error: null })
    const client = buildMockClient(
      {
        receipt_transactions: {
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: txSelectSingle }) }),
        },
        profiles: {
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: profileSingle }) }),
        },
      },
      { remove: storageRemove },
      rpc
    )
    mockedCreateAdminClient.mockReturnValue(client)
    return { client, storageRemove, rpc: (client as unknown as { rpc: Mock }).rpc }
  }

  it('should complete a signed receipt upload through the locked database function', async () => {
    const receiptRecord = { id: 'file-1', storage_path: uploadInput.storagePath }
    const { storageRemove, rpc } = arrangeUpload(async (name) => {
      if (name === 'complete_receipt_upload') {
        return { data: { outcome: 'completed', receipt: receiptRecord, previous_status: 'pending' }, error: null }
      }
      throw new Error(`Unexpected rpc ${name}`)
    })

    const result = await completeReceiptUpload(uploadInput)

    expect(result).toMatchObject({ success: true, receipt: receiptRecord })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('complete_receipt_upload', expect.objectContaining({
      p_transaction_id: 'tx-1',
      p_storage_path: uploadInput.storagePath,
      p_user_id: TEST_USER.user_id,
      p_user_email: TEST_USER.user_email,
      p_user_name: 'Test User',
      p_file_name: uploadInput.fileName,
      p_mime_type: 'application/pdf',
      p_file_size_bytes: 8 * 1024 * 1024,
      p_content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(storageRemove).not.toHaveBeenCalled()
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: TEST_USER.user_id,
        operation_type: 'upload_receipt',
        resource_type: 'receipt_transaction',
        resource_id: 'tx-1',
        operation_status: 'success',
      })
    )
  })

  it('should answer a repeated completion with the stored file and remove nothing', async () => {
    const receiptRecord = { id: 'file-1', storage_path: uploadInput.storagePath }
    const { storageRemove, rpc } = arrangeUpload(async () => ({
      data: { outcome: 'replayed', receipt: receiptRecord },
      error: null,
    }))

    const result = await completeReceiptUpload(uploadInput)

    expect(result).toMatchObject({ success: true, receipt: receiptRecord })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('should refuse a path that was not issued and leave the stored object alone', async () => {
    // The path has the same shape as every receipt already in the bucket. Removing it on the
    // caller's say-so deleted other payments' receipts; this used to assert exactly that.
    const forged = { ...uploadInput, storagePath: '2026/other_transaction_1770000000000' }
    const { storageRemove, rpc } = arrangeUpload(async () => ({ data: { outcome: 'not_issued' }, error: null }))

    const result = await completeReceiptUpload(forged)

    expect(result).toEqual({ error: 'Uploaded receipt path was not issued for this transaction' })
    expect(storageRemove).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith('release_receipt_upload_intent', expect.anything())
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('should remove nothing when the transaction does not exist', async () => {
    const { storageRemove, rpc } = arrangeUpload(async () => ({ data: null, error: null }), null)

    const result = await completeReceiptUpload(uploadInput)

    expect(result).toEqual({ error: 'Transaction not found' })
    expect(rpc).not.toHaveBeenCalled()
    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('should remove the object after a failed save only when the database releases the intent', async () => {
    const { storageRemove, rpc } = arrangeUpload(async (name) => {
      if (name === 'complete_receipt_upload') return { data: null, error: { message: 'boom' } }
      if (name === 'release_receipt_upload_intent') return { data: 'released', error: null }
      throw new Error(`Unexpected rpc ${name}`)
    })

    const result = await completeReceiptUpload(uploadInput)

    expect(result).toEqual({ error: 'Failed to store receipt metadata.' })
    expect(rpc).toHaveBeenCalledWith('release_receipt_upload_intent', {
      p_transaction_id: 'tx-1',
      p_storage_path: uploadInput.storagePath,
      p_user_id: TEST_USER.user_id,
    })
    expect(storageRemove).toHaveBeenCalledWith([uploadInput.storagePath])
  })

  it.each(['referenced', 'completed', 'not_issued'])(
    'should keep the object after a failed save when the database answers %s',
    async (answer) => {
      const { storageRemove } = arrangeUpload(async (name) => {
        if (name === 'complete_receipt_upload') return { data: null, error: { message: 'boom' } }
        return { data: answer, error: null }
      })

      const result = await completeReceiptUpload(uploadInput)

      expect(result).toEqual({ error: 'Failed to store receipt metadata.' })
      expect(storageRemove).not.toHaveBeenCalled()
    }
  )

  it('should tell the user to upload again when the upload was completed and its file removed', async () => {
    const { storageRemove } = arrangeUpload(async () => ({ data: { outcome: 'already_completed' }, error: null }))

    const result = await completeReceiptUpload(uploadInput)

    expect(result.error).toContain('Upload the receipt again')
    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('should return error when user lacks permission', async () => {
    mockedPermission.mockResolvedValue(false)

    const result = await uploadReceiptForTransaction(makeReceiptFormData('tx-1'))

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should return error when transactionId is missing', async () => {
    const formData = new FormData()
    const file = new File(['pdf-content'], 'receipt.pdf', { type: 'application/pdf' })
    formData.set('receipt', file)

    const result = await uploadReceiptForTransaction(formData)

    expect(result).toEqual({ error: 'Missing transaction reference' })
  })

  it('should return error when receipt file is missing', async () => {
    const formData = new FormData()
    formData.set('transactionId', 'tx-1')

    const result = await uploadReceiptForTransaction(formData)

    expect(result).toHaveProperty('error')
    // The error comes from zod schema validation
    expect(typeof (result as { error: string }).error).toBe('string')
  })

  it('should return error when transaction is not found', async () => {
    const txSelectSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient(
        {
          receipt_transactions: {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
          },
          profiles: {
            select: vi.fn().mockReturnValue({ eq: profileEq }),
          },
        },
        {
          upload: vi.fn(),
          remove: vi.fn(),
        }
      )
    )

    const result = await uploadReceiptForTransaction(makeReceiptFormData('tx-1'))

    expect(result).toEqual({ error: 'Transaction not found' })
  })

  it('should return error when storage upload fails', async () => {
    const transaction = {
      id: 'tx-1',
      transaction_date: '2026-03-15',
      details: 'Coffee',
      amount_in: null,
      amount_out: 4.5,
      status: 'pending',
    }

    const txSelectSingle = vi.fn().mockResolvedValue({ data: transaction, error: null })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient(
        {
          receipt_transactions: {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
          },
          profiles: {
            select: vi.fn().mockReturnValue({ eq: profileEq }),
          },
        },
        {
          upload: vi.fn().mockResolvedValue({ error: { message: 'storage full' } }),
          remove: vi.fn(),
        }
      )
    )

    const result = await uploadReceiptForTransaction(makeReceiptFormData('tx-1'))

    expect(result).toEqual({ error: 'Failed to upload receipt file.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('should successfully upload receipt and mark transaction completed', async () => {
    const transaction = {
      id: 'tx-1',
      transaction_date: '2026-03-15',
      details: 'Coffee',
      amount_in: null,
      amount_out: 4.5,
      status: 'pending',
    }

    const receiptRecord = { id: 'file-1', storage_path: '2026/Coffee_4.50.pdf' }

    const txSelectSingle = vi.fn().mockResolvedValue({ data: transaction, error: null })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    const txUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'tx-1' }, error: null })
    const txUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: txUpdateMaybeSingle })
    const txUpdateEq = vi.fn().mockReturnValue({ select: txUpdateSelect })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Test User' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    const receiptInsertSingle = vi.fn().mockResolvedValue({ data: receiptRecord, error: null })
    const receiptInsertSelect = vi.fn().mockReturnValue({ single: receiptInsertSingle })
    const receiptInsert = vi.fn().mockReturnValue({ select: receiptInsertSelect })

    const logInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient(
        {
          receipt_transactions: {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
            update: vi.fn().mockReturnValue({ eq: txUpdateEq }),
          },
          profiles: {
            select: vi.fn().mockReturnValue({ eq: profileEq }),
          },
          receipt_files: {
            insert: receiptInsert,
          },
          receipt_transaction_logs: {
            insert: logInsert,
          },
        },
        {
          upload: vi.fn().mockResolvedValue({ error: null }),
          remove: vi.fn(),
        }
      )
    )

    const result = await uploadReceiptForTransaction(makeReceiptFormData('tx-1'))

    expect(result).toMatchObject({ success: true, receipt: receiptRecord })
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'upload_receipt',
        resource_type: 'receipt_transaction',
        resource_id: 'tx-1',
        operation_status: 'success',
      })
    )
  })
})

// ==========================================================================
// deleteReceiptFile
// ==========================================================================

describe('deleteReceiptFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue(TEST_USER)
  })

  const RECEIPT = {
    id: 'file-1',
    transaction_id: 'tx-1',
    storage_path: '2026/receipt.pdf',
    file_name: 'receipt.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 5000,
    uploaded_by: 'user-1',
    uploaded_at: '2026-03-15T00:00:00.000Z',
  }

  it('should return error when user lacks permission', async () => {
    mockedPermission.mockResolvedValue(false)

    const result = await deleteReceiptFile('file-1')

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('should return error when receipt record is not found', async () => {
    const selectSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const selectEq = vi.fn().mockReturnValue({ single: selectSingle })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient({
        receipt_files: {
          select: vi.fn().mockReturnValue({ eq: selectEq }),
        },
      })
    )

    const result = await deleteReceiptFile('file-1')

    expect(result).toEqual({ error: 'Receipt not found' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('should return error when DB file delete fails', async () => {
    const receiptSelectSingle = vi.fn().mockResolvedValue({ data: RECEIPT, error: null })
    const receiptSelectEq = vi.fn().mockReturnValue({ single: receiptSelectSingle })
    const receiptDeleteEq = vi.fn().mockResolvedValue({ error: { message: 'db error' } })

    const txSelectSingle = vi.fn().mockResolvedValue({
      data: { id: 'tx-1', status: 'completed' },
      error: null,
    })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient(
        {
          receipt_files: {
            select: vi.fn().mockReturnValue({ eq: receiptSelectEq }),
            delete: vi.fn().mockReturnValue({ eq: receiptDeleteEq }),
          },
          receipt_transactions: {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
          },
        },
        {
          remove: vi.fn(),
        }
      )
    )

    const result = await deleteReceiptFile('file-1')

    expect(result).toEqual({ error: 'Failed to remove receipt record.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('should successfully delete receipt and reset transaction to pending when no files remain', async () => {
    const receiptSelectSingle = vi.fn().mockResolvedValue({ data: RECEIPT, error: null })
    const receiptSelectEq = vi.fn().mockReturnValue({ single: receiptSelectSingle })
    const receiptDeleteEq = vi.fn().mockResolvedValue({ error: null })
    // After deletion, check remaining files — returns empty
    const remainingEq = vi.fn().mockResolvedValue({ data: [], error: null })

    const txSelectSingle = vi.fn().mockResolvedValue({
      data: { id: 'tx-1', status: 'completed' },
      error: null,
    })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    const txUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'tx-1' }, error: null })
    const txUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: txUpdateMaybeSingle })
    const txUpdateEq = vi.fn().mockReturnValue({ select: txUpdateSelect })

    const logInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue(
      buildMockClient(
        {
          receipt_files: {
            select: vi.fn((columns?: string) =>
              columns === '*'
                ? { eq: receiptSelectEq }
                : { eq: remainingEq }
            ),
            delete: vi.fn().mockReturnValue({ eq: receiptDeleteEq }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          },
          receipt_transactions: {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
            update: vi.fn().mockReturnValue({ eq: txUpdateEq }),
          },
          receipt_transaction_logs: {
            insert: logInsert,
          },
        },
        {
          remove: vi.fn().mockResolvedValue({ error: null }),
        }
      )
    )

    const result = await deleteReceiptFile('file-1')

    expect(result).toEqual({ success: true })
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'delete_receipt',
        resource_type: 'receipt_file',
        resource_id: 'file-1',
        operation_status: 'success',
      })
    )
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
