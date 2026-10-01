import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The receipts actions for files, statuses and bulk apply: who may call each one, what reaches
 * the service, and what is written to the audit trail. The services are stood in for here and
 * tested on their own in tests/services/receipts.
 */

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

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn().mockResolvedValue({ success: true }) },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => {
    throw new Error('An action reached the database without going through its service')
  }),
}))

vi.mock('@/services/receipts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/receipts')>()),
  performMarkReceiptTransaction: vi.fn(),
  performCompleteReceiptUpload: vi.fn(),
  performCancelReceiptUpload: vi.fn(),
  performDeleteReceiptFile: vi.fn(),
  performRefreshInvoiceCopy: vi.fn(),
  performCreateReceiptUploadUrl: vi.fn(),
  queryReceiptSignedUrl: vi.fn(),
  queryReceiptTransactionHistory: vi.fn(),
  queryReceiptVendorCostReview: vi.fn(),
  queryReceiptVendorAiSummary: vi.fn(),
}))

vi.mock('@/services/receipts/receiptBulkApply', () => ({
  performApplyReceiptBulkClassification: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import {
  performCancelReceiptUpload,
  performCompleteReceiptUpload,
  performCreateReceiptUploadUrl,
  performDeleteReceiptFile,
  performMarkReceiptTransaction,
  performRefreshInvoiceCopy,
  queryReceiptSignedUrl,
  queryReceiptTransactionHistory,
} from '@/services/receipts'
import { performApplyReceiptBulkClassification } from '@/services/receipts/receiptBulkApply'
import {
  applyReceiptGroupClassification,
  cancelReceiptUpload,
  completeReceiptUpload,
  createReceiptUploadUrl,
  deleteReceiptFile,
  getReceiptSignedUrl,
  getReceiptTransactionHistory,
  markReceiptTransaction,
  refreshReceiptInvoiceCopy,
} from '@/app/actions/receipts'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedRevalidate = revalidatePath as unknown as Mock
const mockedMark = performMarkReceiptTransaction as unknown as Mock
const mockedComplete = performCompleteReceiptUpload as unknown as Mock
const mockedCancel = performCancelReceiptUpload as unknown as Mock
const mockedDelete = performDeleteReceiptFile as unknown as Mock
const mockedRefresh = performRefreshInvoiceCopy as unknown as Mock
const mockedUploadUrl = performCreateReceiptUploadUrl as unknown as Mock
const mockedSignedUrl = queryReceiptSignedUrl as unknown as Mock
const mockedHistory = queryReceiptTransactionHistory as unknown as Mock
const mockedBulk = performApplyReceiptBulkClassification as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const EMAIL = 'peter@example.test'
const TX = '55555555-5555-4555-8555-555555555555'
const FILE = '99999999-9999-4999-8999-999999999999'
const PATH = '2026/tesco_1790000000000'

/** The person can do only what is listed. */
function allow(...actions: string[]) {
  mockedPermission.mockImplementation(async (module: string, action: string) => module === 'receipts' && actions.includes(action))
}

const audited = () => mockedAudit.mock.calls.map(([entry]) => entry as Record<string, any>)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  allow('view', 'manage')
  mockedGetCurrentUser.mockResolvedValue({ user_id: USER, user_email: EMAIL })
})

describe('who may change files and statuses', () => {
  const changes: Array<[string, () => Promise<unknown>, Mock]> = [
    ['markReceiptTransaction', () => markReceiptTransaction({ transactionId: TX, status: 'completed', reason: 'x' }), mockedMark],
    [
      'completeReceiptUpload',
      () => completeReceiptUpload({ transactionId: TX, storagePath: PATH, fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 1 }),
      mockedComplete,
    ],
    ['cancelReceiptUpload', () => cancelReceiptUpload({ transactionId: TX, storagePath: PATH }), mockedCancel],
    ['deleteReceiptFile', () => deleteReceiptFile(FILE), mockedDelete],
    ['refreshReceiptInvoiceCopy', () => refreshReceiptInvoiceCopy(FILE), mockedRefresh],
    [
      'createReceiptUploadUrl',
      () => createReceiptUploadUrl({ transactionId: TX, fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 1 }),
      mockedUploadUrl,
    ],
    [
      'applyReceiptGroupClassification',
      () => applyReceiptGroupClassification({ details: 'TESCO', transactionIds: [TX], vendorName: 'Tesco', confirm: true }),
      mockedBulk,
    ],
  ]

  it.each(changes)('%s is refused for someone who can only view', async (_name, call, service) => {
    allow('view')

    await expect(call()).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockedPermission).toHaveBeenCalledWith('receipts', 'manage')
    expect(service).not.toHaveBeenCalled()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it.each(changes)('%s is refused when nobody is signed in', async (_name, call, service) => {
    mockedGetCurrentUser.mockResolvedValue({ user_id: null, user_email: null })

    await expect(call()).rejects.toThrow('Unauthorized')
    expect(service).not.toHaveBeenCalled()
  })

  it('a file link and the history need view, and nothing more', async () => {
    allow('view')
    mockedSignedUrl.mockResolvedValue({ success: true, url: 'https://storage.test/signed' })
    mockedHistory.mockResolvedValue([])

    await expect(getReceiptSignedUrl(FILE)).resolves.toEqual({ success: true, url: 'https://storage.test/signed' })
    await expect(getReceiptTransactionHistory(TX)).resolves.toEqual({ entries: [] })

    allow()
    await expect(getReceiptSignedUrl(FILE)).resolves.toEqual({ error: 'Insufficient permissions' })
    await expect(getReceiptTransactionHistory(TX)).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockedSignedUrl).toHaveBeenCalledTimes(1)
    expect(mockedHistory).toHaveBeenCalledTimes(1)
  })
})

describe('markReceiptTransaction', () => {
  it('passes the reason through and records who completed it and why', async () => {
    mockedMark.mockResolvedValue({ success: true, transaction: { id: TX, status: 'completed', completed_reason: 'Paid in cash' } })

    const result = await markReceiptTransaction({ transactionId: TX, status: 'completed', reason: 'Paid in cash' })

    expect(result.success).toBe(true)
    expect(mockedMark).toHaveBeenCalledWith(USER, EMAIL, { transactionId: TX, status: 'completed', reason: 'Paid in cash' })
    expect(audited()).toEqual([
      {
        user_id: USER,
        user_email: EMAIL,
        operation_type: 'update_status',
        resource_type: 'receipt_transaction',
        resource_id: TX,
        operation_status: 'success',
        additional_info: { new_status: 'completed', completed_reason: 'Paid in cash' },
      },
    ])
    expect(mockedRevalidate).toHaveBeenCalledWith('/receipts')
  })

  it('hands back "a reason is needed" untouched, and records nothing because nothing changed', async () => {
    const refusal = { error: 'This transaction has no receipt. Add one, or say why there is none.', reasonRequired: true }
    mockedMark.mockResolvedValue(refusal)

    await expect(markReceiptTransaction({ transactionId: TX, status: 'completed' })).resolves.toEqual(refusal)
    expect(mockedMark).toHaveBeenCalledWith(USER, EMAIL, { transactionId: TX, status: 'completed', reason: null })
    expect(mockedAudit).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })
})

describe('completeReceiptUpload', () => {
  const input = { transactionId: TX, storagePath: PATH, fileName: 'till.pdf', fileType: 'application/pdf', fileSize: 999 }

  it('records the size that was stored, not the size the browser declared', async () => {
    mockedComplete.mockResolvedValue({ success: true, receipt: { id: FILE, file_size_bytes: 1234 } })

    await completeReceiptUpload(input)

    expect(mockedComplete).toHaveBeenCalledWith(USER, EMAIL, { ...input, confirmDuplicate: false })
    expect(audited()[0]).toMatchObject({
      user_id: USER,
      operation_type: 'upload_receipt',
      resource_id: TX,
      additional_info: { file_name: 'till.pdf', file_size: 1234, duplicate_confirmed: false },
    })
  })

  it('hands back a duplicate warning and records nothing, because nothing was attached', async () => {
    const warning = { duplicate: { count: 1, payments: [{ transactionId: 'other', transactionDate: '2026-08-01', details: 'TESCO', amount: 20, fileName: 'till.pdf' }] } }
    mockedComplete.mockResolvedValue(warning)

    await expect(completeReceiptUpload(input)).resolves.toEqual(warning)
    expect(mockedAudit).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('records that the person attached the file knowing it was on another transaction', async () => {
    mockedComplete.mockResolvedValue({ success: true, receipt: { id: FILE, file_size_bytes: 1234 } })

    await completeReceiptUpload({ ...input, confirmDuplicate: true })

    expect(mockedComplete.mock.calls[0][2]).toMatchObject({ confirmDuplicate: true })
    expect(audited()[0].additional_info).toMatchObject({ duplicate_confirmed: true })
  })

  it('only a real true confirms a duplicate', async () => {
    mockedComplete.mockResolvedValue({ duplicate: { count: 1, payments: [] } })

    await completeReceiptUpload({ ...input, confirmDuplicate: 'yes' as unknown as boolean })

    expect(mockedComplete.mock.calls[0][2]).toMatchObject({ confirmDuplicate: false })
  })

  it('refuses a call that names no transaction', async () => {
    await expect(completeReceiptUpload({ ...input, transactionId: '' })).resolves.toEqual({ error: 'Missing transaction reference' })
    expect(mockedComplete).not.toHaveBeenCalled()
  })
})

describe('cancelReceiptUpload', () => {
  it('releases the upload as the signed-in person and records it', async () => {
    mockedCancel.mockResolvedValue({ success: true })

    await expect(cancelReceiptUpload({ transactionId: TX, storagePath: PATH })).resolves.toEqual({ success: true })
    expect(mockedCancel).toHaveBeenCalledWith(USER, { transactionId: TX, storagePath: PATH })
    expect(audited()[0]).toMatchObject({
      user_id: USER,
      operation_type: 'cancel_upload',
      resource_id: TX,
      operation_status: 'success',
      additional_info: { reason: 'duplicate_file_warning' },
    })
  })

  it('copes with a call that carries nothing', async () => {
    mockedCancel.mockResolvedValue({ success: false })

    await expect(cancelReceiptUpload(undefined as any)).resolves.toEqual({ success: false })
    expect(mockedCancel).toHaveBeenCalledWith(USER, { transactionId: '', storagePath: '' })
    expect(audited()[0]).toMatchObject({ operation_status: 'failure' })
  })
})

describe('deleteReceiptFile', () => {
  it('records which transaction lost the file and what it became', async () => {
    mockedDelete.mockResolvedValue({ success: true, transactionId: TX, newStatus: 'pending', remainingFiles: 0 })

    await deleteReceiptFile(FILE)

    expect(mockedDelete).toHaveBeenCalledWith(USER, FILE)
    expect(audited()).toEqual([
      {
        user_id: USER,
        user_email: EMAIL,
        operation_type: 'delete_receipt',
        resource_type: 'receipt_file',
        resource_id: FILE,
        operation_status: 'success',
        additional_info: { transaction_id: TX, new_status: 'pending', remaining_files: 0 },
      },
    ])
  })

  it('records nothing when nothing was removed', async () => {
    mockedDelete.mockResolvedValue({ error: 'Receipt not found' })

    await expect(deleteReceiptFile(FILE)).resolves.toEqual({ error: 'Receipt not found' })
    expect(mockedAudit).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })
})

describe('refreshReceiptInvoiceCopy', () => {
  it('records a refresh, and a refresh that failed with why', async () => {
    mockedRefresh.mockResolvedValueOnce({ success: true, receipt: { id: FILE } })
    await refreshReceiptInvoiceCopy(FILE)

    mockedRefresh.mockResolvedValueOnce({ error: 'The copy could not be refreshed. The stored copy is unchanged.' })
    await refreshReceiptInvoiceCopy(FILE)

    expect(mockedRefresh).toHaveBeenCalledWith(USER, FILE)
    expect(audited().map((entry) => [entry.operation_type, entry.operation_status, entry.error_message])).toEqual([
      ['refresh_invoice_copy', 'success', undefined],
      ['refresh_invoice_copy', 'failure', 'The copy could not be refreshed. The stored copy is unchanged.'],
    ])
    expect(mockedRevalidate).toHaveBeenCalledTimes(1)
  })
})

describe('getReceiptSignedUrl and getReceiptTransactionHistory', () => {
  it('asks for a download only when told to', async () => {
    mockedSignedUrl.mockResolvedValue({ success: true, url: 'https://storage.test/signed' })

    await getReceiptSignedUrl(FILE)
    await getReceiptSignedUrl(FILE, { download: true })
    await getReceiptSignedUrl(FILE, { download: 'yes' as unknown as boolean })

    expect(mockedSignedUrl.mock.calls.map(([, options]) => options)).toEqual([{ download: false }, { download: true }, { download: false }])
  })

  it('refuses a history request for something that is not a transaction reference', async () => {
    await expect(getReceiptTransactionHistory("x' or 1=1")).resolves.toEqual({ error: 'Transaction reference is invalid' })
    await expect(getReceiptTransactionHistory(undefined as unknown as string)).resolves.toEqual({ error: 'Transaction reference is invalid' })
    expect(mockedHistory).not.toHaveBeenCalled()
  })

  it('says the history could not be loaded, without the detail', async () => {
    mockedHistory.mockRejectedValue(new Error('relation "secret" does not exist'))

    await expect(getReceiptTransactionHistory(TX)).resolves.toEqual({ error: 'The history could not be loaded.' })
  })
})

describe('applyReceiptGroupClassification', () => {
  it('sends the transactions themselves, and only the fields that were given', async () => {
    mockedBulk.mockResolvedValue({ success: true, preview: { total: 1, willChange: 1, unchanged: 0, decidedByPerson: 0, locked: 0, incomingSkipped: 0 } })

    await applyReceiptGroupClassification({ details: '  CARD PURCHASE TESCO  ', transactionIds: [TX], vendorName: 'Tesco' })

    const [userId, request] = mockedBulk.mock.calls[0]
    expect(userId).toBe(USER)
    expect(request).toEqual({
      transactionIds: [TX],
      vendorName: 'Tesco',
      noCategoryApplies: false,
      createVendor: false,
      includeDecided: false,
      confirm: false,
      label: 'Bulk: CARD PURCHASE TESCO',
    })
    // A missing key means "leave it": it must not arrive as null, which means "clear it".
    expect(Object.prototype.hasOwnProperty.call(request, 'expenseCategory')).toBe(false)
  })

  it('passes a null through as "clear it"', async () => {
    mockedBulk.mockResolvedValue({ success: true, preview: {} })

    await applyReceiptGroupClassification({ details: 'x', transactionIds: [TX], vendorName: null, expenseCategory: undefined })

    expect(mockedBulk.mock.calls[0][1]).toMatchObject({ vendorName: null, expenseCategory: null })
  })

  it('records nothing for a preview: nothing was changed', async () => {
    mockedBulk.mockResolvedValue({ success: true, preview: { total: 3, willChange: 2 } })

    await applyReceiptGroupClassification({ details: 'x', transactionIds: [TX], vendorName: 'Tesco' })

    expect(mockedAudit).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('records the run, the counts and whether decided transactions were included', async () => {
    mockedBulk.mockResolvedValue({
      success: true,
      preview: { total: 5, willChange: 3, unchanged: 0, decidedByPerson: 2, locked: 0, incomingSkipped: 0 },
      runId: 'run-1',
      applied: 3,
      skippedChanged: 1,
      skippedLocked: 0,
    })

    await applyReceiptGroupClassification({ details: 'CARD PURCHASE TESCO', transactionIds: [TX], vendorName: 'Tesco', includeDecided: true, confirm: true })

    expect(audited()).toHaveLength(1)
    expect(audited()[0]).toMatchObject({
      user_id: USER,
      user_email: EMAIL,
      operation_type: 'bulk_classification',
      resource_type: 'receipt_transaction_group',
      operation_status: 'success',
      additional_info: {
        details: 'CARD PURCHASE TESCO',
        run_id: 'run-1',
        count: 3,
        skipped_changed: 1,
        skipped_locked: 0,
        decided_by_person: 2,
        included_decided: true,
      },
    })
    expect(mockedRevalidate).toHaveBeenCalledWith('/receipts/bulk')
  })

  it('records a run that stopped part-way as a failure, with its run', async () => {
    mockedBulk.mockResolvedValue({ error: 'This stopped part-way.', runId: 'run-2', applied: 1, skippedChanged: 0, skippedLocked: 0 })

    await applyReceiptGroupClassification({ details: 'x', transactionIds: [TX], vendorName: 'Tesco', confirm: true })

    expect(audited()[0]).toMatchObject({
      operation_status: 'failure',
      error_message: 'This stopped part-way.',
      additional_info: { run_id: 'run-2', count: 1 },
    })
  })

  it('records nothing when the change was refused before anything was written', async () => {
    mockedBulk.mockResolvedValue({ vendorConfirmation: { name: 'Bookers', similar: [] } })

    await applyReceiptGroupClassification({ details: 'x', transactionIds: [TX], vendorName: 'Bookers', confirm: true })

    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('copes with a call that carries nothing', async () => {
    mockedBulk.mockResolvedValue({ error: 'Nothing to update' })

    await expect(applyReceiptGroupClassification(undefined as any)).resolves.toEqual({ error: 'Nothing to update' })
    expect(mockedBulk.mock.calls[0][1]).toMatchObject({ transactionIds: [], confirm: false, label: 'Bulk: group' })
  })
})
