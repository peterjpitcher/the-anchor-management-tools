import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * A copy of our own invoice on the payment that settled it: when it is rendered, where it is
 * stored, what happens to the stored copy when the payment does not take it, and what is queued.
 * `attach_receipt_invoice_file` itself is tested on a real Postgres in tests/sql.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn() },
}))

vi.mock('@/lib/pdf-generator', () => ({
  generateInvoicePDF: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { jobQueue } from '@/lib/unified-job-queue'
import { generateInvoicePDF } from '@/lib/pdf-generator'
import {
  INVOICE_ATTACH_MATCH_STATUSES,
  enqueueInvoiceAttachment,
  enqueueMissingInvoiceAttachments,
  invoiceCopyFileName,
  performAttachInvoiceToReceipt,
  performRefreshInvoiceCopy,
} from '@/services/receipts/receiptInvoiceFiles'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'
import { createFakeReceiptStorage, type FakeReceiptStorage } from '../../helpers/fakeReceiptStorage'

type Row = Record<string, unknown>
type RpcAnswer = { data: any; error: { message: string } | null }

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedEnqueue = jobQueue.enqueue as unknown as Mock
const mockedGenerate = generateInvoicePDF as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const TX = '55555555-5555-4555-8555-555555555555'
const INVOICE = '66666666-6666-4666-8666-666666666666'
const FILE = '99999999-9999-4999-8999-999999999999'
const OLD_PATH = `2026/invoice_INV-0042_${TX}_1780000000000.pdf`
const PDF = Buffer.from('%PDF-1.7 invoice INV-0042')
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function arrange(options: {
  payments?: Row[]
  invoices?: Row[]
  files?: Row[]
  matches?: Row[]
  lock?: string
  attach?: (args: Row) => RpcAnswer
  objects?: Record<string, Uint8Array>
} = {}): { db: FakeDb; storage: FakeReceiptStorage; rpc: Mock } {
  const db = createFakeDb({
    receipt_transactions: options.payments ?? [{ id: TX, transaction_date: '2026-09-01' }],
    invoices: options.invoices ?? [{ id: INVOICE, invoice_number: 'INV-0042', deleted_at: null }],
    receipt_files: options.files ?? [],
    receipt_invoice_matches: options.matches ?? [],
    receipt_settings: options.lock ? [{ key: 'locked_before', value: { date: options.lock } }] : [],
  })
  const storage = createFakeReceiptStorage(options.objects ?? {})
  ;(db.client as unknown as { storage: unknown }).storage = storage.storage

  const rpc = vi.fn(async (name: string, args: Row): Promise<RpcAnswer> => {
    if (name !== 'attach_receipt_invoice_file') throw new Error(`Unexpected rpc: ${name}`)
    if (options.attach) return options.attach(args)
    return {
      data: { outcome: 'attached', status_updated: true, receipt: { id: FILE, storage_path: args.p_storage_path, source: 'invoice' } },
      error: null,
    }
  })
  db.onRpc((name, args) => rpc(name, args))
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, storage, rpc }
}

const render = () => vi.fn(async (_invoice: unknown) => PDF)
const existingCopy = (overrides: Row = {}): Row => ({
  id: FILE,
  transaction_id: TX,
  invoice_id: INVOICE,
  source: 'invoice',
  storage_path: OLD_PATH,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockedEnqueue.mockResolvedValue({ success: true })
})

describe('invoiceCopyFileName', () => {
  it('names the copy after the invoice, without characters a file name cannot hold', () => {
    expect(invoiceCopyFileName('INV-0042')).toBe('Invoice INV-0042.pdf')
    expect(invoiceCopyFileName('INV/00:42?')).toBe('Invoice INV0042.pdf')
    expect(invoiceCopyFileName('   ')).toBe('Invoice copy.pdf')
  })
})

describe('performAttachInvoiceToReceipt', () => {
  it('renders the invoice, stores the copy with the receipts and adds it to the payment', async () => {
    const { rpc, storage } = arrange()
    const renderer = render()

    const result = await performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: renderer })

    expect(renderer).toHaveBeenCalledTimes(1)
    expect(renderer.mock.calls[0][0]).toMatchObject({ id: INVOICE, invoice_number: 'INV-0042' })

    expect(storage.uploaded).toHaveLength(1)
    const stored = storage.uploaded[0]
    expect(stored.path).toMatch(new RegExp(`^2026/invoice_INV-0042_${TX}_\\d{13}\\.pdf$`))
    expect(stored.options).toEqual({ upsert: false, contentType: 'application/pdf' })
    expect(Buffer.from(stored.bytes).equals(PDF)).toBe(true)

    expect(rpc.mock.calls[0][1]).toEqual({
      p_transaction_id: TX,
      p_invoice_id: INVOICE,
      p_invoice_number: 'INV-0042',
      p_storage_path: stored.path,
      p_file_name: 'Invoice INV-0042.pdf',
      p_file_size_bytes: PDF.length,
      p_content_hash: sha256(PDF),
      p_replace: false,
      p_initiated_by: null,
    })
    expect(result).toEqual({
      outcome: 'attached',
      statusUpdated: true,
      receipt: { id: FILE, storage_path: stored.path, source: 'invoice' },
    })
    expect(storage.removed).toEqual([])
  })

  it('cannot be mistaken for an upload: its path is not the shape an upload is issued', async () => {
    const { storage } = arrange()

    await performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: render() })

    // receiptUploadedObjectSchema accepts only "<year>/<name>_<13 digits>" with no extension.
    expect(storage.uploaded[0].path).not.toMatch(/^\d{4}\/[^/]+_\d{13}$/)
  })

  it('keeps an odd invoice number out of the storage path', async () => {
    const { storage, rpc } = arrange({ invoices: [{ id: INVOICE, invoice_number: '../INV 42/ä', deleted_at: null }] })

    await performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: render() })

    expect(storage.uploaded[0].path).toMatch(new RegExp(`^2026/invoice_INV_42_${TX}_\\d{13}\\.pdf$`))
    expect(rpc.mock.calls[0][1].p_invoice_number).toBe('../INV 42/ä')
  })

  it('does nothing, and renders nothing, when the payment already has the copy', async () => {
    const { rpc, storage } = arrange({ files: [existingCopy()] })
    const renderer = render()

    const result = await performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: renderer })

    expect(result).toMatchObject({ outcome: 'already_attached', receipt: { id: FILE } })
    expect(renderer).not.toHaveBeenCalled()
    expect(storage.uploaded).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('leaves a payment on or before the lock date alone, and renders nothing', async () => {
    const { rpc, storage } = arrange({ lock: '2026-09-01' })
    const renderer = render()

    await expect(performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: renderer })).resolves.toEqual({
      outcome: 'locked',
    })
    expect(renderer).not.toHaveBeenCalled()
    expect(storage.uploaded).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says the payment has gone', async () => {
    arrange({ payments: [] })
    const renderer = render()

    await expect(performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: renderer })).resolves.toEqual({
      outcome: 'transaction_not_found',
    })
    expect(renderer).not.toHaveBeenCalled()
  })

  it('says the invoice has gone when it was deleted, and stores nothing', async () => {
    const { storage } = arrange({ invoices: [{ id: INVOICE, invoice_number: 'INV-0042', deleted_at: '2026-09-20T10:00:00Z' }] })
    const renderer = render()

    await expect(performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: renderer })).resolves.toEqual({
      outcome: 'invoice_not_found',
    })
    expect(renderer).not.toHaveBeenCalled()
    expect(storage.uploaded).toEqual([])
  })

  it('throws, so the job is retried, when the invoice cannot be rendered', async () => {
    const { rpc, storage } = arrange()
    const renderer = vi.fn(async () => {
      throw new Error('browser crashed')
    })

    await expect(performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: renderer })).rejects.toThrow('browser crashed')
    expect(storage.uploaded).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('throws rather than attach an empty file', async () => {
    const { rpc, storage } = arrange()

    await expect(
      performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: vi.fn(async () => Buffer.alloc(0)) })
    ).rejects.toThrow('rendered as an empty file')
    expect(storage.uploaded).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('throws when the copy cannot be stored, and adds nothing to the payment', async () => {
    const { rpc, storage } = arrange()
    storage.failNext('upload', 'bucket is full')

    await expect(performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: render() })).rejects.toThrow(
      'Failed to store the copy of invoice INV-0042: bucket is full'
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('throws when a read fails, rather than guessing', async () => {
    const { db } = arrange()
    db.failNext({ table: 'receipt_files', operation: 'select', message: 'timeout' })

    await expect(performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: render() })).rejects.toThrow(
      'Failed to check for an existing invoice copy: timeout'
    )
  })

  it('removes the copy it stored and throws when the payment could not take it', async () => {
    const { storage } = arrange({ attach: () => ({ data: null, error: { message: 'deadlock' } }) })

    await expect(performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: render() })).rejects.toThrow(
      'Failed to attach invoice INV-0042: deadlock'
    )
    expect(storage.removed).toEqual([storage.uploaded[0].path])
    expect(storage.objects.size).toBe(0)
  })

  it.each(['already_attached', 'locked', 'transaction_not_found'] as const)(
    'removes the copy it stored when the database answers "%s"',
    async (outcome) => {
      const { storage } = arrange({ attach: () => ({ data: { outcome }, error: null }) })

      const result = await performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: render() })

      expect(result.outcome).toBe(outcome)
      expect(storage.removed).toEqual([storage.uploaded[0].path])
    }
  )

  it('removes the copy it stored and throws on an answer it does not know', async () => {
    const { storage } = arrange({ attach: () => ({ data: { outcome: 'mystery' }, error: null }) })

    await expect(performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, render: render() })).rejects.toThrow(
      'unexpected outcome mystery'
    )
    expect(storage.removed).toEqual([storage.uploaded[0].path])
  })

  it('swaps the stored copy on a refresh: the new one stays, the old one goes', async () => {
    const { rpc, storage } = arrange({
      files: [existingCopy()],
      objects: { [OLD_PATH]: Buffer.from('old copy') },
      // A locked period does not stop a refresh being asked for: the database decides.
      lock: '2026-09-30',
      attach: (args) => ({
        data: { outcome: 'refreshed', old_storage_path: OLD_PATH, receipt: { id: FILE, storage_path: args.p_storage_path } },
        error: null,
      }),
    })

    const result = await performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, replace: true, initiatedBy: USER, render: render() })

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_replace: true, p_initiated_by: USER })
    expect(result.outcome).toBe('refreshed')
    expect(storage.removed).toEqual([OLD_PATH])
    expect([...storage.objects.keys()]).toEqual([storage.uploaded[0].path])
  })

  it('still reports the refresh when only the old stored copy could not be removed', async () => {
    const { storage } = arrange({
      files: [existingCopy()],
      objects: { [OLD_PATH]: Buffer.from('old copy') },
      attach: (args) => ({ data: { outcome: 'refreshed', old_storage_path: OLD_PATH, receipt: { id: FILE, storage_path: args.p_storage_path } }, error: null }),
    })
    storage.failNext('remove', 'storage is down')

    const result = await performAttachInvoiceToReceipt({ transactionId: TX, invoiceId: INVOICE, replace: true, render: render() })

    expect(result.outcome).toBe('refreshed')
  })
})

describe('enqueueInvoiceAttachment', () => {
  it('queues one job per payment and invoice, behind other work', async () => {
    await expect(enqueueInvoiceAttachment(TX, INVOICE)).resolves.toBe(true)

    expect(mockedEnqueue).toHaveBeenCalledWith(
      'attach_invoice_to_receipt',
      { transactionId: TX, invoiceId: INVOICE },
      { priority: -10, unique: `receipts:attach_invoice:${TX}:${INVOICE}` }
    )
  })

  it('says it did not queue, and does not throw, when the queue refuses or fails', async () => {
    mockedEnqueue.mockResolvedValueOnce({ success: false, error: 'queue is paused' })
    await expect(enqueueInvoiceAttachment(TX, INVOICE)).resolves.toBe(false)

    mockedEnqueue.mockRejectedValueOnce(new Error('no database'))
    await expect(enqueueInvoiceAttachment(TX, INVOICE)).resolves.toBe(false)
  })
})

describe('enqueueMissingInvoiceAttachments', () => {
  const match = (n: number, overrides: Row = {}): Row => ({
    id: `match-${String(n).padStart(4, '0')}`,
    receipt_transaction_id: `tx-${n}`,
    invoice_id: `inv-${n}`,
    transaction_date: '2026-09-01',
    match_status: 'payment_recorded',
    ...overrides,
  })

  it('queues a copy for every payment matched to a real invoice that has none', async () => {
    const { db } = arrange({
      matches: [
        match(1),
        match(2, { match_status: 'already_paid' }),
        // Has its copy already.
        match(3),
        // No invoice was found for the number on the payment.
        match(4, { invoice_id: null, match_status: 'invoice_not_found' }),
        // Not a match that names one invoice with confidence.
        match(5, { match_status: 'review_required' }),
        // Behind the lock date.
        match(6, { transaction_date: '2026-06-30' }),
        // The same pair twice is one job.
        match(7, { receipt_transaction_id: 'tx-1', invoice_id: 'inv-1' }),
      ],
      files: [
        { id: 'f-3', transaction_id: 'tx-3', invoice_id: 'inv-3', source: 'invoice' },
        // An uploaded receipt on payment 1 is not its invoice copy.
        { id: 'f-1', transaction_id: 'tx-1', invoice_id: null, source: 'upload' },
      ],
      lock: '2026-06-30',
    })

    const queued = await enqueueMissingInvoiceAttachments(db.client as any)

    expect(queued).toBe(2)
    expect(mockedEnqueue.mock.calls.map(([, payload]) => payload)).toEqual([
      { transactionId: 'tx-1', invoiceId: 'inv-1' },
      { transactionId: 'tx-2', invoiceId: 'inv-2' },
    ])
  })

  it('covers every status that names a real invoice', () => {
    expect([...INVOICE_ATTACH_MATCH_STATUSES].sort()).toEqual(
      ['already_paid', 'amount_mismatch', 'matched', 'payment_recorded', 'vendor_amount_matched'].sort()
    )
  })

  it('counts only what was really queued', async () => {
    const { db } = arrange({ matches: [match(1), match(2), match(3)] })
    mockedEnqueue.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'x' }).mockResolvedValueOnce({ success: true })

    await expect(enqueueMissingInvoiceAttachments(db.client as any)).resolves.toBe(2)
  })

  it('queues at most 200 in one run and reads every match to get there', async () => {
    const { db } = arrange({ matches: Array.from({ length: 1250 }, (_, index) => match(index + 1)) })

    await expect(enqueueMissingInvoiceAttachments(db.client as any)).resolves.toBe(200)
    expect(mockedEnqueue).toHaveBeenCalledTimes(200)
  })

  it('sees a copy that sits beyond the first thousand files', async () => {
    const files = Array.from({ length: 1100 }, (_, index) => ({
      id: `f-${String(index).padStart(5, '0')}`,
      transaction_id: `other-${index}`,
      invoice_id: `other-inv-${index}`,
      source: 'invoice',
    }))
    files.push({ id: 'f-99999', transaction_id: 'tx-1', invoice_id: 'inv-1', source: 'invoice' })
    const { db } = arrange({ matches: [match(1)], files })

    await expect(enqueueMissingInvoiceAttachments(db.client as any)).resolves.toBe(0)
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('throws when the matches cannot be read, so the caller knows nothing was queued', async () => {
    const { db } = arrange({ matches: [match(1)] })
    db.failNext({ table: 'receipt_invoice_matches', operation: 'select', message: 'timeout' })

    await expect(enqueueMissingInvoiceAttachments(db.client as any)).rejects.toThrow('timeout')
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })
})

describe('performRefreshInvoiceCopy', () => {
  it('renders the invoice again with the invoice generator and swaps the copy', async () => {
    mockedGenerate.mockResolvedValue(PDF)
    const { rpc, storage } = arrange({
      files: [existingCopy()],
      objects: { [OLD_PATH]: Buffer.from('old copy') },
      attach: (args) => ({
        data: { outcome: 'refreshed', old_storage_path: OLD_PATH, receipt: { id: FILE, storage_path: args.p_storage_path } },
        error: null,
      }),
    })

    const result = await performRefreshInvoiceCopy(USER, FILE)

    expect(result.success).toBe(true)
    expect(result.receipt).toMatchObject({ id: FILE })
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_replace: true, p_initiated_by: USER, p_transaction_id: TX, p_invoice_id: INVOICE })
    expect(storage.removed).toEqual([OLD_PATH])
  })

  it('refuses a file that is not a copy of one of our invoices', async () => {
    const { rpc } = arrange({ files: [existingCopy({ source: 'upload', invoice_id: null })] })

    await expect(performRefreshInvoiceCopy(USER, FILE)).resolves.toEqual({ error: 'Only a copy of one of our invoices can be refreshed.' })
    expect(mockedGenerate).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says so when the file has gone or cannot be read', async () => {
    const { db } = arrange()

    await expect(performRefreshInvoiceCopy(USER, FILE)).resolves.toEqual({ error: 'That file no longer exists.' })

    db.failNext({ table: 'receipt_files', operation: 'select', message: 'timeout', times: 1 })
    await expect(performRefreshInvoiceCopy(USER, FILE)).resolves.toEqual({ error: 'The file could not be loaded.' })
  })

  it('keeps the stored copy when the invoice has since been deleted', async () => {
    const { storage } = arrange({
      files: [existingCopy()],
      invoices: [{ id: INVOICE, invoice_number: 'INV-0042', deleted_at: '2026-09-20T10:00:00Z' }],
      objects: { [OLD_PATH]: Buffer.from('old copy') },
    })

    await expect(performRefreshInvoiceCopy(USER, FILE)).resolves.toEqual({
      error: 'The invoice has been deleted, so the copy cannot be refreshed. The stored copy is unchanged.',
    })
    expect(storage.objects.has(OLD_PATH)).toBe(true)
    expect(storage.removed).toEqual([])
  })

  it('keeps the stored copy when the invoice cannot be rendered', async () => {
    mockedGenerate.mockRejectedValue(new Error('browser crashed'))
    const { storage } = arrange({ files: [existingCopy()], objects: { [OLD_PATH]: Buffer.from('old copy') } })

    await expect(performRefreshInvoiceCopy(USER, FILE)).resolves.toEqual({
      error: 'The copy could not be refreshed. The stored copy is unchanged.',
    })
    expect(storage.objects.has(OLD_PATH)).toBe(true)
    expect(storage.removed).toEqual([])
  })

  it('calls only "refreshed" a success: any other answer keeps the stored copy and removes the new one', async () => {
    mockedGenerate.mockResolvedValue(PDF)
    const { storage } = arrange({
      files: [existingCopy()],
      objects: { [OLD_PATH]: Buffer.from('old copy') },
      // Not an answer the database gives to a refresh today. If it ever does, it is not a success.
      attach: () => ({ data: { outcome: 'locked' }, error: null }),
    })

    const result = await performRefreshInvoiceCopy(USER, FILE)

    expect(result).toEqual({ error: 'The copy could not be refreshed. The stored copy is unchanged.' })
    expect(storage.objects.has(OLD_PATH)).toBe(true)
    expect([...storage.objects.keys()]).toEqual([OLD_PATH])
  })
})
