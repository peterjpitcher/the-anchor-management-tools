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

vi.mock('@/lib/receipts/rule-matching', () => ({
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
  storage?: Record<string, unknown>
) {
  return {
    from: vi.fn((table: string) => {
      if (tables[table]) return tables[table]
      throw new Error(`Unexpected table: ${table}`)
    }),
    ...(storage ? { storage: { from: vi.fn().mockReturnValue(storage) } } : {}),
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
      // @ts-expect-error — deliberately invalid status for test
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

  it('should complete a signed receipt upload and mark transaction completed', async () => {
    const transaction = {
      id: 'tx-1',
      transaction_date: '2026-03-15',
      details: 'Coffee',
      amount_in: null,
      amount_out: 4.5,
      status: 'pending',
    }
    const receiptRecord = { id: 'file-1', storage_path: '2026/Coffee_4.50.pdf_1770000000000' }

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
    const storageRemove = vi.fn().mockResolvedValue({ error: null })

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
          remove: storageRemove,
        }
      )
    )

    const result = await completeReceiptUpload({
      transactionId: 'tx-1',
      storagePath: '2026/Coffee_4.50.pdf_1770000000000',
      fileName: '2026-03-15 - Coffee - 4.50.pdf',
      fileType: 'application/pdf',
      fileSize: 8 * 1024 * 1024,
    })

    expect(result).toMatchObject({ success: true, receipt: receiptRecord })
    expect(receiptInsert).toHaveBeenCalledWith(expect.objectContaining({
      transaction_id: 'tx-1',
      storage_path: '2026/Coffee_4.50.pdf_1770000000000',
      file_name: '2026-03-15 - Coffee - 4.50.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 8 * 1024 * 1024,
    }))
    expect(storageRemove).not.toHaveBeenCalled()
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'upload_receipt',
        resource_type: 'receipt_transaction',
        resource_id: 'tx-1',
        operation_status: 'success',
      })
    )
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
    formData.set('match_direction', overrides.match_direction ?? 'both')
    formData.set('auto_status', overrides.auto_status ?? 'no_receipt_required')
    for (const [key, value] of Object.entries(overrides)) {
      if (!['name', 'match_direction', 'auto_status'].includes(key)) {
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
