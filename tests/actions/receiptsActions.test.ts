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

vi.mock('@/lib/receipts/rule-matching', () => ({
  selectBestReceiptRule: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: {
    enqueue: vi.fn(),
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
  deleteReceiptFile,
  markReceiptTransaction,
  toggleReceiptRule,
  updateReceiptClassification,
  updateReceiptRule,
  uploadReceiptForTransaction,
} from '@/app/actions/receipts'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

describe('deleteReceiptFile rollback safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'user@example.com' })
  })

  it('re-inserts metadata when storage delete fails after DB delete', async () => {
    const receipt = {
      id: 'file-1',
      transaction_id: 'tx-1',
      storage_path: 'receipts/tx-1.pdf',
      file_name: 'tx-1.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 12000,
      uploaded_by: 'user-1',
      uploaded_at: '2026-02-14T00:00:00.000Z',
    }

    const receiptSelectSingle = vi.fn().mockResolvedValue({ data: receipt, error: null })
    const receiptSelectEq = vi.fn().mockReturnValue({ single: receiptSelectSingle })
    const receiptDeleteEq = vi.fn().mockResolvedValue({ error: null })
    const receiptInsert = vi.fn().mockResolvedValue({ error: null })

    const txSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'tx-1', status: 'completed' }, error: null })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'receipt_files') {
          return {
            select: vi.fn().mockReturnValue({ eq: receiptSelectEq }),
            delete: vi.fn().mockReturnValue({ eq: receiptDeleteEq }),
            insert: receiptInsert,
          }
        }

        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
          }
        }

        if (table === 'receipt_transaction_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          remove: vi.fn().mockResolvedValue({ error: { message: 'storage down' } }),
        }),
      },
    }

    mockedCreateAdminClient.mockReturnValue(mockClient)

    const result = await deleteReceiptFile('file-1')

    expect(result).toEqual({ error: 'Failed to remove stored receipt file.' })
    expect(receiptInsert).toHaveBeenCalledWith({
      id: receipt.id,
      transaction_id: receipt.transaction_id,
      storage_path: receipt.storage_path,
      file_name: receipt.file_name,
      mime_type: receipt.mime_type,
      file_size_bytes: receipt.file_size_bytes,
      uploaded_by: receipt.uploaded_by,
      uploaded_at: receipt.uploaded_at,
    })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('returns transaction-not-found when manual status update affects no rows after prefetch', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: { id: '550e8400-e29b-41d4-a716-446655440000', status: 'pending' },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Alex' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({ eq: fetchEq }),
            update: vi.fn().mockReturnValue({ eq: updateEq }),
          }
        }

        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({ eq: profileEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await markReceiptTransaction({
      transactionId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'pending',
      receiptRequired: true,
    })

    expect(result).toEqual({ error: 'Transaction not found' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
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
      from: vi.fn((table: string) => {
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
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
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('name', 'Rule A')
    formData.set('match_direction', 'both')
    formData.set('auto_status', 'no_receipt_required')

    const result = await updateReceiptRule('rule-1', formData)

    expect(result).toEqual({ error: 'Rule not found' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
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

  it('returns manual-reconciliation error when metadata insert fails and cleanup storage remove also fails', async () => {
    const transaction = {
      id: 'tx-1',
      status: 'pending',
      details: 'Coffee beans',
      transaction_date: '2026-02-14',
      amount_out: 15.25,
      amount_in: null,
    }

    const txSelectSingle = vi.fn().mockResolvedValue({ data: transaction, error: null })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    const receiptInsertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'insert failed' },
    })
    const receiptInsertSelect = vi.fn().mockReturnValue({ single: receiptInsertSingle })
    const receiptInsert = vi.fn().mockReturnValue({ select: receiptInsertSelect })

    const storageUpload = vi.fn().mockResolvedValue({ data: { path: '2026/file.pdf' }, error: null })
    const storageRemove = vi.fn().mockResolvedValue({ error: { message: 'cleanup failed' } })

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
          }
        }

        if (table === 'receipt_files') {
          return {
            insert: receiptInsert,
          }
        }

        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn() }) }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: storageUpload,
          remove: storageRemove,
        }),
      },
    }

    mockedCreateAdminClient.mockReturnValue(mockClient)

    const formData = new FormData()
    formData.set('transactionId', 'tx-1')
    const receiptFile = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })
    ;(receiptFile as File & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () =>
      new TextEncoder().encode('receipt').buffer
    formData.set('receipt', receiptFile)

    const result = await uploadReceiptForTransaction(formData)

    expect(result).toEqual({
      error: 'Failed to store receipt metadata. Uploaded file cleanup requires manual reconciliation.'
    })
    expect(storageUpload).toHaveBeenCalled()
    expect(storageRemove).toHaveBeenCalled()
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('returns transaction-not-found when receipt upload transaction update affects no rows and rollback succeeds', async () => {
    const transaction = {
      id: 'tx-2',
      status: 'pending',
      details: 'Coffee beans',
      transaction_date: '2026-02-14',
      amount_out: 15.25,
      amount_in: null,
    }

    const txSelectSingle = vi.fn().mockResolvedValue({ data: transaction, error: null })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })

    const txUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const txUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: txUpdateMaybeSingle })
    const txUpdateEq = vi.fn().mockReturnValue({ select: txUpdateSelect })

    const receiptInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'file-2' },
      error: null,
    })
    const receiptInsertSelect = vi.fn().mockReturnValue({ single: receiptInsertSingle })
    const receiptInsert = vi.fn().mockReturnValue({ select: receiptInsertSelect })
    const receiptDeleteEq = vi.fn().mockResolvedValue({ error: null })

    const profileSingle = vi.fn().mockResolvedValue({ data: { full_name: 'Alex' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    const storageUpload = vi.fn().mockResolvedValue({ error: null })
    const storageRemove = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
            update: vi.fn().mockReturnValue({ eq: txUpdateEq }),
          }
        }

        if (table === 'receipt_files') {
          return {
            insert: receiptInsert,
            delete: vi.fn().mockReturnValue({ eq: receiptDeleteEq }),
          }
        }

        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({ eq: profileEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: storageUpload,
          remove: storageRemove,
        }),
      },
    })

    const formData = new FormData()
    formData.set('transactionId', 'tx-2')
    const receiptFile = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })
    ;(receiptFile as File & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () =>
      new TextEncoder().encode('receipt').buffer
    formData.set('receipt', receiptFile)

    const result = await uploadReceiptForTransaction(formData)

    expect(result).toEqual({ error: 'Transaction not found' })
    expect(receiptDeleteEq).toHaveBeenCalledWith('id', 'file-2')
    expect(storageRemove).toHaveBeenCalledTimes(1)
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('returns missing-transaction error when reset-after-delete affects no rows', async () => {
    const receipt = {
      id: 'file-3',
      transaction_id: 'tx-3',
      storage_path: 'receipts/tx-3.pdf',
      file_name: 'tx-3.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 2222,
      uploaded_by: 'user-1',
      uploaded_at: '2026-02-14T00:00:00.000Z',
    }

    const receiptSelectSingle = vi.fn().mockResolvedValue({ data: receipt, error: null })
    const receiptSelectEq = vi.fn().mockReturnValue({ single: receiptSelectSingle })
    const remainingEq = vi.fn().mockResolvedValue({ data: [], error: null })
    const receiptDeleteEq = vi.fn().mockResolvedValue({ error: null })

    const txSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'tx-3', status: 'completed' }, error: null })
    const txSelectEq = vi.fn().mockReturnValue({ single: txSelectSingle })
    const txUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const txUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: txUpdateMaybeSingle })
    const txUpdateEq = vi.fn().mockReturnValue({ select: txUpdateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'receipt_files') {
          return {
            select: vi.fn((columns?: string) =>
              columns === '*'
                ? { eq: receiptSelectEq }
                : { eq: remainingEq }
            ),
            delete: vi.fn().mockReturnValue({ eq: receiptDeleteEq }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({ eq: txSelectEq }),
            update: vi.fn().mockReturnValue({ eq: txUpdateEq }),
          }
        }

        if (table === 'receipt_transaction_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          remove: vi.fn().mockResolvedValue({ error: null }),
        }),
      },
    })

    const result = await deleteReceiptFile('file-3')

    expect(result).toEqual({ error: 'Receipt was removed, but transaction no longer exists.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })
})
