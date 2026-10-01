import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Attaching, removing and completing: what the services send to the database functions, what
 * they do with each answer, and which stored objects they remove. The functions themselves
 * (`complete_receipt_upload`, `delete_receipt_file`, `mark_receipt_transaction`,
 * `release_receipt_upload_intent`) are tested on a real Postgres in tests/sql.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn().mockResolvedValue({ success: true }) },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  performCancelReceiptUpload,
  performCompleteReceiptUpload,
  performDeleteReceiptFile,
  performMarkReceiptTransaction,
} from '@/services/receipts/receiptMutations'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'
import { createFakeReceiptStorage, type FakeReceiptStorage } from '../../helpers/fakeReceiptStorage'

type Row = Record<string, unknown>
type RpcAnswer = { data: unknown; error: { message: string } | null }

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const EMAIL = 'peter@example.test'
const TX = '55555555-5555-4555-8555-555555555555'
const FILE = '99999999-9999-4999-8999-999999999999'
const PATH = '2026/tesco_20_00_1790000000000'

const PDF = new TextEncoder().encode('%PDF-1.7 a till receipt')
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const HEIC = Uint8Array.from([0, 0, 0, 0x18, ...[...'ftypheic'].map((char) => char.charCodeAt(0)), 0, 0])
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function arrange(options: {
  objects?: Record<string, Uint8Array>
  rpc?: Record<string, (args: Row) => RpcAnswer>
  payments?: Row[]
} = {}): { db: FakeDb; storage: FakeReceiptStorage; rpc: Mock } {
  const db = createFakeDb({
    receipt_transactions: options.payments ?? [
      { id: TX, transaction_date: '2026-09-01', details: 'CARD PURCHASE TESCO', amount_in: null, amount_out: 20, status: 'pending' },
    ],
    profiles: [{ id: USER, full_name: 'Peter Pitcher' }],
    receipt_classification_signals: [],
  })
  const storage = createFakeReceiptStorage(options.objects ?? { [PATH]: PDF })
  ;(db.client as unknown as { storage: unknown }).storage = storage.storage

  const rpc = vi.fn(async (name: string, args: Row): Promise<RpcAnswer> => {
    const handler = options.rpc?.[name]
    if (handler) return handler(args)
    if (name === 'release_receipt_upload_intent') return { data: 'released', error: null }
    throw new Error(`Unexpected rpc: ${name}`)
  })
  db.onRpc((name, args) => rpc(name, args) as Promise<any>)
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, storage, rpc }
}

const callsOf = (rpc: Mock, name: string) => rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args as Row)

function upload(overrides: Row = {}) {
  return {
    transactionId: TX,
    storagePath: PATH,
    fileName: 'till.pdf',
    fileType: 'application/pdf',
    fileSize: 999,
    ...overrides,
  } as Parameters<typeof performCompleteReceiptUpload>[2]
}

const completed = (extra: Row = {}) => () => ({
  data: { outcome: 'completed', previous_status: 'pending', receipt: { id: FILE, transaction_id: TX, storage_path: PATH }, ...extra },
  error: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('performCompleteReceiptUpload', () => {
  it('records what was stored, not what the browser said it would send', async () => {
    const { db, rpc, storage } = arrange({ rpc: { complete_receipt_upload: completed() } })

    // Declared as a 999-byte JPEG. The stored bytes are a PDF of another size.
    const result = await performCompleteReceiptUpload(USER, EMAIL, upload({ fileType: 'image/jpeg' }))

    expect(result).toEqual({ success: true, receipt: { id: FILE, transaction_id: TX, storage_path: PATH } })
    expect(callsOf(rpc, 'complete_receipt_upload')).toEqual([
      {
        p_transaction_id: TX,
        p_storage_path: PATH,
        p_user_id: USER,
        p_user_email: EMAIL,
        p_user_name: 'Peter Pitcher',
        p_file_name: 'till.pdf',
        p_mime_type: 'application/pdf',
        p_file_size_bytes: PDF.length,
        p_content_hash: sha256(PDF),
        p_duplicate: 'check',
      },
    ])
    expect(storage.removed).toEqual([])
    expect(db.rows('receipt_classification_signals')).toHaveLength(1)
    expect(db.rows('receipt_classification_signals')[0]).toMatchObject({
      transaction_id: TX,
      signal_type: 'receipt_upload',
      prior_status: 'pending',
      new_status: 'completed',
      performed_by: USER,
      payload: { file_name: 'till.pdf', content_hash: sha256(PDF) },
    })
  })

  it('keeps the declared type when the bytes say nothing', async () => {
    const odd = new TextEncoder().encode('not a known kind of file')
    const { rpc } = arrange({ objects: { [PATH]: odd }, rpc: { complete_receipt_upload: completed() } })

    await performCompleteReceiptUpload(USER, EMAIL, upload({ fileType: 'image/png' }))

    expect(callsOf(rpc, 'complete_receipt_upload')[0]).toMatchObject({ p_mime_type: 'image/png', p_file_size_bytes: odd.length })
  })

  it('asks the database to check for the same file elsewhere, and only skips that once the person has confirmed', async () => {
    const { rpc } = arrange({ rpc: { complete_receipt_upload: completed() } })

    await performCompleteReceiptUpload(USER, EMAIL, upload())
    await performCompleteReceiptUpload(USER, EMAIL, upload({ confirmDuplicate: true }))

    expect(callsOf(rpc, 'complete_receipt_upload').map((args) => args.p_duplicate)).toEqual(['check', 'confirmed'])
  })

  it('warns about a file that is already on other payments, and writes and removes nothing', async () => {
    const { db, rpc, storage } = arrange({
      rpc: {
        complete_receipt_upload: () => ({
          data: {
            outcome: 'duplicate',
            count: 12,
            payments: [
              { transaction_id: 'other-1', transaction_date: '2026-08-02', details: 'TESCO STORES', amount: '20.00', file_name: 'till.pdf' },
              { transaction_id: 'other-2', transaction_date: '2026-08-09', details: 'TESCO EXTRA', amount: null, file_name: null },
            ],
          },
          error: null,
        }),
      },
    })

    const result = await performCompleteReceiptUpload(USER, EMAIL, upload())

    expect(result).toEqual({
      duplicate: {
        count: 12,
        payments: [
          { transactionId: 'other-1', transactionDate: '2026-08-02', details: 'TESCO STORES', amount: 20, fileName: 'till.pdf' },
          { transactionId: 'other-2', transactionDate: '2026-08-09', details: 'TESCO EXTRA', amount: null, fileName: null },
        ],
      },
    })
    // The upload stays open so that "attach anyway" can finish it.
    expect(callsOf(rpc, 'release_receipt_upload_intent')).toHaveLength(0)
    expect(storage.removed).toEqual([])
    expect(storage.objects.has(PATH)).toBe(true)
    expect(db.rows('receipt_classification_signals')).toHaveLength(0)
  })

  it('answers a second call for the same upload with the file the first one stored, and counts it once', async () => {
    const { db } = arrange({
      rpc: { complete_receipt_upload: () => ({ data: { outcome: 'replayed', receipt: { id: FILE } }, error: null }) },
    })

    await expect(performCompleteReceiptUpload(USER, EMAIL, upload())).resolves.toEqual({ success: true, receipt: { id: FILE } })
    expect(db.rows('receipt_classification_signals')).toHaveLength(0)
  })

  it('attaches nothing when the stored file cannot be read back', async () => {
    const { rpc, storage } = arrange({ objects: {} })

    const result = await performCompleteReceiptUpload(USER, EMAIL, upload())

    expect(result).toEqual({ error: 'The uploaded file could not be read. Nothing was attached. Please upload it again.' })
    expect(callsOf(rpc, 'complete_receipt_upload')).toHaveLength(0)
    expect(callsOf(rpc, 'release_receipt_upload_intent')).toEqual([{ p_transaction_id: TX, p_storage_path: PATH, p_user_id: USER }])
    expect(storage.removed).toEqual([PATH])
  })

  it('attaches nothing when the stored file is empty', async () => {
    const { rpc } = arrange({ objects: { [PATH]: new Uint8Array() } })

    const result = await performCompleteReceiptUpload(USER, EMAIL, upload())

    expect(result.error).toContain('could not be read')
    expect(callsOf(rpc, 'complete_receipt_upload')).toHaveLength(0)
  })

  it('refuses an iPhone photo that arrived unconverted, whatever it was declared as', async () => {
    const { rpc, storage } = arrange({ objects: { [PATH]: HEIC } })

    const result = await performCompleteReceiptUpload(USER, EMAIL, upload({ fileName: 'IMG_1.jpg', fileType: 'image/jpeg' }))

    expect(result.error).toContain('iPhone photo (HEIC) was not converted')
    expect(result.success).toBeUndefined()
    expect(callsOf(rpc, 'complete_receipt_upload')).toHaveLength(0)
    expect(storage.removed).toEqual([PATH])
  })

  it('accepts a JPEG that came from a converted iPhone photo', async () => {
    const { rpc } = arrange({ objects: { [PATH]: JPEG }, rpc: { complete_receipt_upload: completed() } })

    const result = await performCompleteReceiptUpload(USER, EMAIL, upload({ fileName: 'IMG_1.jpg', fileType: 'image/jpeg' }))

    expect(result.success).toBe(true)
    expect(callsOf(rpc, 'complete_receipt_upload')[0]).toMatchObject({ p_mime_type: 'image/jpeg' })
  })

  it('refuses a path that is not the shape of an issued upload, before touching anything', async () => {
    const { rpc, storage } = arrange()

    for (const storagePath of ['2026/../2025/x_1790000000000', '2026/invoice_INV-1_abc_1790000000000.pdf', 'tesco_1790000000000', '']) {
      const result = await performCompleteReceiptUpload(USER, EMAIL, upload({ storagePath }))
      expect(result.error).toBeTruthy()
      expect(result.success).toBeUndefined()
    }
    expect(rpc).not.toHaveBeenCalled()
    expect(storage.downloads).toEqual([])
    expect(storage.removed).toEqual([])
  })

  it('refuses a path from another year than the payment', async () => {
    const { rpc, storage } = arrange({ objects: { '2025/tesco_1790000000000': PDF } })

    const result = await performCompleteReceiptUpload(USER, EMAIL, upload({ storagePath: '2025/tesco_1790000000000' }))

    expect(result).toEqual({ error: 'Uploaded receipt path is invalid' })
    expect(storage.downloads).toEqual([])
    expect(callsOf(rpc, 'complete_receipt_upload')).toHaveLength(0)
  })

  it('says the payment has gone and touches nothing', async () => {
    const { rpc, storage } = arrange({ payments: [] })

    await expect(performCompleteReceiptUpload(USER, EMAIL, upload())).resolves.toEqual({ error: 'Transaction not found' })
    expect(rpc).not.toHaveBeenCalled()
    expect(storage.removed).toEqual([])
  })

  it('never removes a stored object the database says is on a payment', async () => {
    const { storage } = arrange({
      objects: {},
      rpc: { release_receipt_upload_intent: () => ({ data: 'referenced', error: null }) },
    })
    storage.objects.set(PATH, PDF)
    storage.failNext('download', 'network blip')

    const result = await performCompleteReceiptUpload(USER, EMAIL, upload())

    expect(result.error).toContain('could not be read')
    expect(storage.removed).toEqual([])
    expect(storage.objects.has(PATH)).toBe(true)
  })

  it('never removes a stored object when the release itself fails', async () => {
    const { storage } = arrange({
      rpc: {
        complete_receipt_upload: () => ({ data: null, error: { message: 'deadlock' } }),
        release_receipt_upload_intent: () => ({ data: null, error: { message: 'deadlock' } }),
      },
    })

    await expect(performCompleteReceiptUpload(USER, EMAIL, upload())).resolves.toEqual({ error: 'Failed to store receipt metadata.' })
    expect(storage.removed).toEqual([])
  })

  it('releases the upload when the database could not store the file', async () => {
    const { db, storage } = arrange({ rpc: { complete_receipt_upload: () => ({ data: null, error: { message: 'timeout' } }) } })

    await expect(performCompleteReceiptUpload(USER, EMAIL, upload())).resolves.toEqual({ error: 'Failed to store receipt metadata.' })
    expect(storage.removed).toEqual([PATH])
    expect(db.rows('receipt_classification_signals')).toHaveLength(0)
  })

  it.each([
    ['transaction_not_found', 'Transaction not found'],
    ['already_completed', 'This upload was already completed and its file has since been removed. Upload the receipt again.'],
    ['not_issued', 'Uploaded receipt path was not issued for this transaction'],
    ['something_new', 'Uploaded receipt path was not issued for this transaction'],
  ])('reports "%s" as a failure and leaves the stored object alone', async (outcome, message) => {
    const { storage, rpc } = arrange({ rpc: { complete_receipt_upload: () => ({ data: { outcome }, error: null }) } })

    await expect(performCompleteReceiptUpload(USER, EMAIL, upload())).resolves.toEqual({ error: message })
    // A path that was not issued to this person for this payment is not theirs to remove.
    expect(callsOf(rpc, 'release_receipt_upload_intent')).toHaveLength(0)
    expect(storage.removed).toEqual([])
  })

  it('does not call a completion without a file a success', async () => {
    arrange({ rpc: { complete_receipt_upload: () => ({ data: { outcome: 'completed' }, error: null }) } })

    const result = await performCompleteReceiptUpload(USER, EMAIL, upload())

    expect(result.success).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})

describe('performCancelReceiptUpload', () => {
  it('releases the open upload and removes its stored object', async () => {
    const { rpc, storage } = arrange()

    await expect(performCancelReceiptUpload(USER, { transactionId: TX, storagePath: PATH })).resolves.toEqual({ success: true })
    expect(callsOf(rpc, 'release_receipt_upload_intent')).toEqual([{ p_transaction_id: TX, p_storage_path: PATH, p_user_id: USER }])
    expect(storage.removed).toEqual([PATH])
  })

  it.each(['referenced', 'not_found', null])('removes nothing when the database answers %s', async (answer) => {
    const { storage } = arrange({ rpc: { release_receipt_upload_intent: () => ({ data: answer, error: null }) } })

    await performCancelReceiptUpload(USER, { transactionId: TX, storagePath: PATH })

    expect(storage.removed).toEqual([])
    expect(storage.objects.has(PATH)).toBe(true)
  })

  it('does nothing with a request that names no upload', async () => {
    const { rpc } = arrange()

    await expect(performCancelReceiptUpload(USER, { transactionId: TX, storagePath: '' })).resolves.toEqual({ success: false })
    await expect(performCancelReceiptUpload(USER, { transactionId: TX, storagePath: undefined as unknown as string })).resolves.toEqual({
      success: false,
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('performDeleteReceiptFile', () => {
  const deleted = (extra: Row = {}) => () => ({
    data: {
      outcome: 'deleted',
      transaction_id: TX,
      storage_path: PATH,
      remove_object: true,
      remaining_files: 0,
      previous_status: 'completed',
      new_status: 'pending',
      ...extra,
    },
    error: null,
  })

  it('removes the file in the database first, then its stored object, and says what the payment became', async () => {
    const { rpc, storage } = arrange({ rpc: { delete_receipt_file: deleted() } })

    const result = await performDeleteReceiptFile(USER, FILE)

    expect(result).toEqual({ success: true, transactionId: TX, newStatus: 'pending', remainingFiles: 0 })
    expect(callsOf(rpc, 'delete_receipt_file')).toEqual([{ p_file_id: FILE, p_user_id: USER }])
    expect(storage.removed).toEqual([PATH])
  })

  it('leaves the stored object when the database says something else still uses it', async () => {
    const { storage } = arrange({ rpc: { delete_receipt_file: deleted({ remove_object: false, remaining_files: 2, new_status: 'completed' }) } })

    const result = await performDeleteReceiptFile(USER, FILE)

    expect(result).toEqual({ success: true, transactionId: TX, newStatus: 'completed', remainingFiles: 2 })
    expect(storage.removed).toEqual([])
  })

  it('still reports the file as removed when only the stored object could not be removed', async () => {
    const { storage } = arrange({ rpc: { delete_receipt_file: deleted() } })
    storage.failNext('remove', 'storage is down')

    await expect(performDeleteReceiptFile(USER, FILE)).resolves.toMatchObject({ success: true, newStatus: 'pending' })
    // It is referenced by nothing now: the sweep reports it.
    expect(storage.objects.has(PATH)).toBe(true)
  })

  it('says so when the file has already gone', async () => {
    const { storage } = arrange({ rpc: { delete_receipt_file: () => ({ data: { outcome: 'not_found' }, error: null }) } })

    await expect(performDeleteReceiptFile(USER, FILE)).resolves.toEqual({ error: 'Receipt not found' })
    expect(storage.removed).toEqual([])
  })

  it.each([
    ['an error', { data: null, error: { message: 'timeout' } }],
    ['no answer', { data: null, error: null }],
    ['an answer it does not know', { data: { outcome: 'locked', storage_path: PATH, remove_object: true }, error: null }],
  ])('removes nothing from storage when the database gives %s', async (_label, answer) => {
    const { storage } = arrange({ rpc: { delete_receipt_file: () => answer as RpcAnswer } })

    await expect(performDeleteReceiptFile(USER, FILE)).resolves.toEqual({ error: 'Failed to remove the receipt. Nothing was changed.' })
    expect(storage.removed).toEqual([])
  })
})

describe('performMarkReceiptTransaction', () => {
  const updated = () => ({ data: { outcome: 'updated', transaction: { id: TX, status: 'completed' } }, error: null })

  it('sends the status, the reason and who did it in one call', async () => {
    const { db, rpc } = arrange({ rpc: { mark_receipt_transaction: updated } })

    const result = await performMarkReceiptTransaction(USER, EMAIL, {
      transactionId: TX,
      status: 'completed',
      reason: '  Paid in cash, no till receipt  ',
    })

    expect(result).toEqual({ success: true, transaction: { id: TX, status: 'completed' } })
    expect(callsOf(rpc, 'mark_receipt_transaction')).toEqual([
      {
        p_transaction_id: TX,
        p_status: 'completed',
        p_reason: 'Paid in cash, no till receipt',
        p_user_id: USER,
        p_user_email: EMAIL,
        p_user_name: 'Peter Pitcher',
      },
    ])
    // The status change is the database function's job: nothing is written from here.
    expect(db.writes).toHaveLength(0)
  })

  it('sends no reason when none, or only spaces, was given', async () => {
    const { rpc } = arrange({ rpc: { mark_receipt_transaction: updated } })

    await performMarkReceiptTransaction(USER, EMAIL, { transactionId: TX, status: 'pending' })
    await performMarkReceiptTransaction(USER, EMAIL, { transactionId: TX, status: 'completed', reason: '   ' })

    expect(callsOf(rpc, 'mark_receipt_transaction').map((args) => args.p_reason)).toEqual([null, null])
  })

  it('asks for a reason when the payment has no file, and says nothing was changed', async () => {
    arrange({ rpc: { mark_receipt_transaction: () => ({ data: { outcome: 'reason_required' }, error: null }) } })

    const result = await performMarkReceiptTransaction(USER, EMAIL, { transactionId: TX, status: 'completed' })

    expect(result).toEqual({
      error: 'This transaction has no receipt. Add one, or say why there is none.',
      reasonRequired: true,
    })
  })

  it('refuses a reason longer than the column holds, without calling the database', async () => {
    const { rpc } = arrange({ rpc: { mark_receipt_transaction: updated } })

    const result = await performMarkReceiptTransaction(USER, EMAIL, { transactionId: TX, status: 'completed', reason: 'x'.repeat(501) })

    expect(result).toEqual({ error: 'Keep the reason under 500 characters.' })
    expect(rpc).not.toHaveBeenCalled()

    await performMarkReceiptTransaction(USER, EMAIL, { transactionId: TX, status: 'completed', reason: 'x'.repeat(500) })
    expect(callsOf(rpc, 'mark_receipt_transaction')).toHaveLength(1)
  })

  it('refuses a status it does not know and a reference that is not one', async () => {
    const { rpc } = arrange({ rpc: { mark_receipt_transaction: updated } })

    const badStatus = await performMarkReceiptTransaction(USER, EMAIL, { transactionId: TX, status: 'archived' as any })
    const badId = await performMarkReceiptTransaction(USER, EMAIL, { transactionId: 'abc', status: 'pending' })

    expect(badStatus.error).toBeTruthy()
    expect(badId).toEqual({ error: 'Transaction reference is invalid' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['not_found', 'Transaction not found'],
    ['invalid_status', 'Failed to update the transaction.'],
    ['locked', 'Failed to update the transaction.'],
  ])('reports "%s" as a failure', async (outcome, message) => {
    arrange({ rpc: { mark_receipt_transaction: () => ({ data: { outcome }, error: null }) } })

    await expect(performMarkReceiptTransaction(USER, EMAIL, { transactionId: TX, status: 'completed', reason: 'x' })).resolves.toEqual({
      error: message,
    })
  })

  it('reports a database error as a failure', async () => {
    arrange({ rpc: { mark_receipt_transaction: () => ({ data: null, error: { message: 'timeout' } }) } })

    await expect(performMarkReceiptTransaction(USER, EMAIL, { transactionId: TX, status: 'pending' })).resolves.toEqual({
      error: 'Failed to update the transaction.',
    })
  })
})
