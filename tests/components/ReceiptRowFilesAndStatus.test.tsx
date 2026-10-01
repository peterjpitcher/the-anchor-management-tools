// What one transaction in the list can do with its files and its status, on the table row and
// on the phone card. The two share one hook, so every case here runs against both: they used
// to carry their own copies of these handlers and had drifted.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'react-hot-toast'
import { ReceiptTableRow } from '@/app/(authenticated)/receipts/_components/ui/ReceiptTableRow'
import { ReceiptMobileCard } from '@/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard'
import { historyActionLabel, isInvoiceCopy } from '@/app/(authenticated)/receipts/_components/ui/ReceiptRowParts'
import type { WorkspaceTransaction } from '@/app/(authenticated)/receipts/_components/ui/expenseChoice'
import { HEIC_UNREADABLE_MESSAGE } from '@/lib/receipts/heic-convert'

const mocks = vi.hoisted(() => ({
  canManage: true,
  mark: vi.fn(),
  deleteFile: vi.fn(),
  signedUrl: vi.fn(),
  history: vi.fn(),
  refresh: vi.fn(),
  createUploadUrl: vi.fn(),
  completeUpload: vi.fn(),
  cancelUpload: vi.fn(),
  uploadToSignedUrl: vi.fn(),
}))

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() })
  return { toast, default: toast }
})

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => mocks.canManage }),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({ storage: { from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }) } }),
}))

vi.mock('@/app/actions/receipts', () => ({
  deleteReceiptFile: (...args: unknown[]) => mocks.deleteFile(...args),
  getReceiptSignedUrl: (...args: unknown[]) => mocks.signedUrl(...args),
  getReceiptTransactionHistory: (...args: unknown[]) => mocks.history(...args),
  markReceiptTransaction: (...args: unknown[]) => mocks.mark(...args),
  refreshReceiptInvoiceCopy: (...args: unknown[]) => mocks.refresh(...args),
  createReceiptUploadUrl: (...args: unknown[]) => mocks.createUploadUrl(...args),
  completeReceiptUpload: (...args: unknown[]) => mocks.completeUpload(...args),
  cancelReceiptUpload: (...args: unknown[]) => mocks.cancelUpload(...args),
  updateReceiptNote: vi.fn(),
  updateReceiptClassification: vi.fn(),
}))

vi.mock('@/app/actions/receipt-ai', () => ({
  decideReceiptAiCategory: vi.fn(),
}))

const base = {
  id: 'tx-1',
  batch_id: null,
  transaction_date: '2026-09-01',
  details: 'CARD PURCHASE TESCO',
  transaction_type: null,
  amount_in: null,
  amount_out: 20,
  amount_total: 20,
  balance: null,
  dedupe_hash: 'hash-1',
  source_type: 'bank',
  status: 'pending',
  receipt_required: true,
  completed_reason: null,
  vendor_id: 'v-tesco',
  vendor_name: 'Tesco',
  vendor_source: 'manual',
  vendor_rule_id: null,
  expense_category: null,
  expense_category_source: null,
  expense_rule_id: null,
  no_category_applies: false,
  notes: null,
  created_at: '2026-09-01T09:00:00.000Z',
  updated_at: '2026-09-01T09:00:00.000Z',
  files: [],
  autoRule: null,
  aiSuggestion: null,
  aiNote: null,
} as unknown as WorkspaceTransaction

const TILL = { id: 'f-till', transaction_id: 'tx-1', storage_path: '2026/till_1790000000000', file_name: 'till.pdf', source: 'upload', invoice_id: null }
const INVOICE = { id: 'f-inv', transaction_id: 'tx-1', storage_path: '2026/invoice_INV-0042.pdf', file_name: 'Invoice INV-0042.pdf', source: 'invoice', invoice_id: 'inv-1' }

function withFiles(files: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}): WorkspaceTransaction {
  return { ...base, ...overrides, files } as unknown as WorkspaceTransaction
}

const SLOW = { timeout: 10_000 }
vi.setConfig({ testTimeout: 30_000 })

/** Every message shown as a toast. The design system's toast calls the library's base function. */
function toasted(): unknown[] {
  return (toast as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0])
}

function chooseFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

const PDF = () => new File([new Uint8Array([37, 80, 68, 70])], 'till.pdf', { type: 'application/pdf' })

/**
 * Clicks a button in a dialog once it can be clicked. The dialog opens while the upload that
 * raised it is still settling, and its buttons are disabled until it has.
 */
async function clickWhenReady(name: string) {
  const button = (await screen.findByRole('button', { name }, SLOW)) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false), SLOW)
  fireEvent.click(button)
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const mock of Object.values(mocks)) {
    if (typeof mock === 'function') (mock as ReturnType<typeof vi.fn>).mockReset()
  }
  mocks.canManage = true
  mocks.createUploadUrl.mockResolvedValue({ success: true, path: '2026/till_1790000000000', token: 'token', friendlyName: 'Tesco till.pdf' })
  mocks.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

type Layout = {
  render: (transaction: WorkspaceTransaction, onUpdate: (...args: unknown[]) => void) => HTMLElement
  done: string
  skip: string
}

const layouts: Array<[string, Layout]> = [
  [
    'table row',
    {
      render: (transaction, onUpdate) =>
        render(
          <table>
            <tbody>
              <ReceiptTableRow transaction={transaction} vendorOptions={['Tesco']} onUpdate={onUpdate} onRuleSuggestion={vi.fn()} />
            </tbody>
          </table>
        ).container,
      done: 'Mark as done',
      skip: 'Skip (no receipt needed)',
    },
  ],
  [
    'phone card',
    {
      render: (transaction, onUpdate) =>
        render(<ReceiptMobileCard transaction={transaction} vendorOptions={['Tesco']} onUpdate={onUpdate} onRuleSuggestion={vi.fn()} />).container,
      done: 'Done',
      skip: 'Skip',
    },
  ],
]

describe.each(layouts)('completing a transaction on the %s', (_name, layout) => {
  it('asks why there is no receipt before completing a transaction with no file', () => {
    const onUpdate = vi.fn()
    layout.render(base, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: layout.done }))

    expect(screen.getByText('Complete without a receipt')).toBeTruthy()
    expect(mocks.mark).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('does not accept an empty reason', () => {
    layout.render(base, vi.fn())
    fireEvent.click(screen.getByRole('button', { name: layout.done }))

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Done' }))

    expect(mocks.mark).not.toHaveBeenCalled()
    expect(toasted()).toContain('Say why there is no receipt, or attach one.')
    expect(screen.getByText('Complete without a receipt')).toBeTruthy()
  })

  it('completes with the reason, and shows what the server stored', async () => {
    mocks.mark.mockResolvedValue({ success: true, transaction: { ...base, status: 'completed', completed_reason: 'Parking meter', files: undefined } })
    const onUpdate = vi.fn()
    layout.render(base, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: layout.done }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  Parking meter ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Done' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2), SLOW)
    expect(mocks.mark).toHaveBeenCalledWith({ transactionId: 'tx-1', status: 'completed', reason: 'Parking meter' })
    // Shown at once, then replaced by the stored row.
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ status: 'completed' })
    expect(onUpdate.mock.calls[1][0]).toMatchObject({ status: 'completed', completed_reason: 'Parking meter', files: [] })
    // The summary tiles move once: the second update is counted from the status already shown.
    expect(onUpdate.mock.calls.map((call) => call[1])).toEqual(['pending', 'completed'])
    await waitFor(() => expect(screen.queryByText('Complete without a receipt')).toBeNull(), SLOW)
  })

  it('cancelling the reason changes nothing', () => {
    const onUpdate = vi.fn()
    layout.render(base, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: layout.done }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Complete without a receipt')).toBeNull()
    expect(mocks.mark).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('completes a transaction that has a file without asking for a reason', async () => {
    mocks.mark.mockResolvedValue({ success: true, transaction: { ...base, status: 'completed' } })
    layout.render(withFiles([TILL]), vi.fn())

    fireEvent.click(screen.getByRole('button', { name: layout.done }))

    await waitFor(() => expect(mocks.mark).toHaveBeenCalledWith({ transactionId: 'tx-1', status: 'completed', reason: null }), SLOW)
    expect(screen.queryByText('Complete without a receipt')).toBeNull()
  })

  it('needs no reason for "no receipt needed"', async () => {
    mocks.mark.mockResolvedValue({ success: true, transaction: { ...base, status: 'no_receipt_required' } })
    layout.render(base, vi.fn())

    fireEvent.click(screen.getByRole('button', { name: layout.skip }))

    await waitFor(() => expect(mocks.mark).toHaveBeenCalledWith({ transactionId: 'tx-1', status: 'no_receipt_required', reason: null }), SLOW)
  })

  it('puts the transaction back exactly as it was when the server says no', async () => {
    mocks.mark.mockResolvedValue({ error: 'Failed to update the transaction.' })
    const original = withFiles([TILL], { notes: '01 Sep 2026, 10:00 | keep me' })
    const onUpdate = vi.fn()
    layout.render(original, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: layout.done }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2), SLOW)
    // The very object that was on screen, and counted back from the status it was shown as.
    expect(onUpdate.mock.calls[1][0]).toBe(original)
    expect(onUpdate.mock.calls[1][1]).toBe('completed')
    expect(toasted()).toContain('Failed to update the transaction.')
  })

  it('asks for the reason after all when the file went while the list was open', async () => {
    mocks.mark.mockResolvedValue({ error: 'This transaction has no receipt. Add one, or say why there is none.', reasonRequired: true })
    const original = withFiles([TILL])
    const onUpdate = vi.fn()
    layout.render(original, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: layout.done }))

    await waitFor(() => expect(screen.getByText('Complete without a receipt')).toBeTruthy(), SLOW)
    expect(onUpdate.mock.calls[1][0]).toBe(original)
    expect(toasted()).toEqual([])
  })

  it('shows why a completed transaction has no receipt', () => {
    layout.render({ ...base, status: 'completed', completed_reason: 'Parking meter' } as WorkspaceTransaction, vi.fn())

    expect(screen.getByText('No receipt:')).toBeTruthy()
    expect(screen.getByText(/Parking meter/)).toBeTruthy()
  })

  it('lets someone who can only view change nothing', () => {
    mocks.canManage = false
    layout.render(withFiles([INVOICE]), vi.fn())

    expect((screen.getByRole('button', { name: layout.done }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Delete Invoice INV-0042.pdf' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh the copy of Invoice INV-0042.pdf' })).toBeNull()
    // Reading is still allowed: the file and the history.
    expect(screen.getByRole('button', { name: 'Download Invoice INV-0042.pdf' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'History of CARD PURCHASE TESCO' })).toBeTruthy()
  })
})

describe.each(layouts)('attaching a file on the %s', (_name, layout) => {
  const receipt = { id: 'f-new', transaction_id: 'tx-1', storage_path: '2026/till_1790000000000', file_name: 'Tesco till.pdf', source: 'upload' }
  const warning = {
    count: 12,
    payments: [
      { transactionId: 'other-1', transactionDate: '2026-08-02', details: 'TESCO STORES 2041', amount: 20, fileName: 'till.pdf' },
      { transactionId: 'other-2', transactionDate: '2026-08-09', details: 'TESCO EXTRA', amount: null, fileName: null },
    ],
  }

  it('attaches the file and completes the transaction', async () => {
    mocks.completeUpload.mockResolvedValue({ success: true, receipt })
    const onUpdate = vi.fn()
    const container = layout.render(base, onUpdate)

    chooseFile(container, PDF())

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.createUploadUrl).toHaveBeenCalledWith({ transactionId: 'tx-1', fileName: 'till.pdf', fileType: 'application/pdf', fileSize: 4 })
    expect(mocks.completeUpload).toHaveBeenCalledWith({
      transactionId: 'tx-1',
      storagePath: '2026/till_1790000000000',
      fileName: 'Tesco till.pdf',
      fileType: 'application/pdf',
      fileSize: 4,
    })
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ status: 'completed', files: [receipt] })
    expect(onUpdate.mock.calls[0][1]).toBe('pending')
    expect(toasted()).toContain('Receipt uploaded')
  })

  it('warns that the file is already on other transactions, and attaches nothing yet', async () => {
    mocks.completeUpload.mockResolvedValue({ duplicate: warning })
    const onUpdate = vi.fn()
    const container = layout.render(base, onUpdate)

    chooseFile(container, PDF())

    await waitFor(() => expect(screen.getByText('This file is already on another transaction')).toBeTruthy(), SLOW)
    expect(screen.getByText(/The same file is attached to 12 other transactions\. The 2 most recent are shown/)).toBeTruthy()
    expect(screen.getByText('TESCO STORES 2041')).toBeTruthy()
    expect(screen.getByText('TESCO EXTRA')).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(toasted()).toEqual([])
  })

  it('attaches it anyway once the person has read the warning', async () => {
    mocks.completeUpload.mockResolvedValueOnce({ duplicate: warning }).mockResolvedValueOnce({ success: true, receipt })
    const onUpdate = vi.fn()
    const container = layout.render(base, onUpdate)

    chooseFile(container, PDF())
    await clickWhenReady('Attach Anyway')

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.completeUpload).toHaveBeenCalledTimes(2)
    expect(mocks.completeUpload.mock.calls[1][0]).toMatchObject({ storagePath: '2026/till_1790000000000', confirmDuplicate: true })
    // The file was stored once: it is not uploaded again.
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ status: 'completed', files: [receipt] })
    await waitFor(() => expect(screen.queryByText('This file is already on another transaction')).toBeNull(), SLOW)
  })

  it('removes the stored file and attaches nothing when the person says no', async () => {
    mocks.completeUpload.mockResolvedValue({ duplicate: warning })
    mocks.cancelUpload.mockResolvedValue({ success: true })
    const onUpdate = vi.fn()
    const container = layout.render(base, onUpdate)

    chooseFile(container, PDF())
    await clickWhenReady('Do Not Attach')

    await waitFor(() => expect(mocks.cancelUpload).toHaveBeenCalledWith({ transactionId: 'tx-1', storagePath: '2026/till_1790000000000' }), SLOW)
    expect(mocks.completeUpload).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.queryByText('This file is already on another transaction')).toBeNull()
  })

  it('never asks twice: a second warning after confirming is a failure', async () => {
    mocks.completeUpload.mockResolvedValue({ duplicate: warning })
    const onUpdate = vi.fn()
    const container = layout.render(base, onUpdate)

    chooseFile(container, PDF())
    await clickWhenReady('Attach Anyway')

    await waitFor(() => expect(toasted()).toContain('The file could not be attached. Please upload it again.'), SLOW)
    expect(screen.queryByText('This file is already on another transaction')).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('says what went wrong and attaches nothing when the server refuses the file', async () => {
    mocks.completeUpload.mockResolvedValue({ error: 'The uploaded file could not be read. Nothing was attached. Please upload it again.' })
    const onUpdate = vi.fn()
    const container = layout.render(base, onUpdate)

    chooseFile(container, PDF())

    await waitFor(() => expect(toasted()).toContain('The uploaded file could not be read. Nothing was attached. Please upload it again.'), SLOW)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('stops an iPhone photo this browser cannot convert, before anything is sent', async () => {
    // A browser with no HEIC decoder: neither route to a drawable image works.
    vi.stubGlobal('createImageBitmap', undefined)
    const originalCreateObjectURL = URL.createObjectURL
    URL.createObjectURL = () => {
      throw new Error('no decoder for this image')
    }
    try {
      const container = layout.render(base, vi.fn())

      chooseFile(container, new File([new Uint8Array(64)], 'IMG_0042.HEIC', { type: 'image/heic' }))

      await waitFor(() => expect(toasted()).toContain(HEIC_UNREADABLE_MESSAGE), SLOW)
      expect(mocks.createUploadUrl).not.toHaveBeenCalled()
      expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled()
    } finally {
      URL.createObjectURL = originalCreateObjectURL
      vi.unstubAllGlobals()
    }
  })
})

describe.each(layouts)('the files on the %s', (_name, layout) => {
  it('marks a copy of our own invoice and a file that is on other transactions', () => {
    layout.render(withFiles([{ ...TILL, shared_with: 2 }, INVOICE, { ...TILL, id: 'f-one', file_name: 'slip.jpg', shared_with: 1 }]), vi.fn())

    expect(screen.getByText('Invoice')).toBeTruthy()
    expect(screen.getByText('Also on 2 others')).toBeTruthy()
    expect(screen.getByText('Also on 1 other')).toBeTruthy()
    // Only the invoice copy can be refreshed.
    expect(screen.getAllByRole('button', { name: /^Refresh the copy of / })).toHaveLength(1)
  })

  it('opens a file in a new tab, and downloads it under its own name', async () => {
    mocks.signedUrl.mockResolvedValue({ success: true, url: 'https://storage.test/signed' })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    layout.render(withFiles([TILL]), vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'till.pdf' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.test/signed', '_blank', 'noopener'), SLOW)
    expect(mocks.signedUrl).toHaveBeenLastCalledWith('f-till', {})

    fireEvent.click(screen.getByRole('button', { name: 'Download till.pdf' }))
    await waitFor(() => expect(mocks.signedUrl).toHaveBeenLastCalledWith('f-till', { download: true }), SLOW)
    open.mockRestore()
  })

  it('says so when a file cannot be opened, and opens no empty tab', async () => {
    mocks.signedUrl.mockResolvedValue({ error: 'The file could not be opened. It may have been removed from storage.' })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    layout.render(withFiles([TILL]), vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'till.pdf' }))

    await waitFor(() => expect(toasted()).toContain('The file could not be opened. It may have been removed from storage.'), SLOW)
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('warns that removing the only file reopens a completed transaction, then shows what the server made of it', async () => {
    mocks.deleteFile.mockResolvedValue({ success: true, transactionId: 'tx-1', newStatus: 'pending', remainingFiles: 0 })
    const onUpdate = vi.fn()
    layout.render(withFiles([TILL], { status: 'completed' }), onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Delete till.pdf' }))
    expect(screen.getByText(/It is the only file, so the transaction will no longer be completed/)).toBeTruthy()
    expect(mocks.deleteFile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.deleteFile).toHaveBeenCalledWith('f-till')
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ status: 'pending', files: [] })
    expect(onUpdate.mock.calls[0][1]).toBe('completed')
  })

  it('does not give that warning when a reason, or another file, keeps the transaction completed', () => {
    layout.render(withFiles([TILL, INVOICE], { status: 'completed' }), vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'Delete till.pdf' }))

    expect(screen.getByText('Delete this file from the transaction? This cannot be undone.')).toBeTruthy()
  })

  it('keeps the file on screen when it could not be removed', async () => {
    mocks.deleteFile.mockResolvedValue({ error: 'Failed to remove the receipt. Nothing was changed.' })
    const onUpdate = vi.fn()
    layout.render(withFiles([TILL]), onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Delete till.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toasted()).toContain('Failed to remove the receipt. Nothing was changed.'), SLOW)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('swaps in the fresh copy of an invoice', async () => {
    const fresh = { ...INVOICE, storage_path: '2026/invoice_INV-0042_new.pdf' }
    mocks.refresh.mockResolvedValue({ success: true, receipt: fresh })
    const onUpdate = vi.fn()
    layout.render(withFiles([TILL, INVOICE], { status: 'completed' }), onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh the copy of Invoice INV-0042.pdf' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.refresh).toHaveBeenCalledWith('f-inv')
    expect(onUpdate.mock.calls[0][0].files).toEqual([TILL, fresh])
    expect(toasted()).toContain('Invoice copy refreshed')
  })

  it('says why an invoice copy could not be refreshed, and leaves it as it was', async () => {
    mocks.refresh.mockResolvedValue({ error: 'The invoice has been deleted, so the copy cannot be refreshed. The stored copy is unchanged.' })
    const onUpdate = vi.fn()
    layout.render(withFiles([INVOICE]), onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh the copy of Invoice INV-0042.pdf' }))

    await waitFor(() => expect(toasted()).toContain('The invoice has been deleted, so the copy cannot be refreshed. The stored copy is unchanged.'), SLOW)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe.each(layouts)('the history on the %s', (_name, layout) => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'History of CARD PURCHASE TESCO' }))

  it('lists what happened, who did it and how the status moved', async () => {
    mocks.history.mockResolvedValue({
      entries: [
        { id: 'l3', at: '2026-09-03T10:00:00Z', action: 'receipt_upload', note: 'Receipt added: till.pdf', previousStatus: 'pending', newStatus: 'completed', by: 'Peter Pitcher' },
        { id: 'l2', at: '2026-09-02T10:00:00Z', action: 'rule_classification', note: null, previousStatus: 'pending', newStatus: 'pending', by: null },
        { id: 'l1', at: '2026-09-01T10:00:00Z', action: 'something_new', note: null, previousStatus: null, newStatus: 'pending', by: null },
      ],
    })
    layout.render(base, vi.fn())

    open()
    expect(screen.getByText('Loading the history.')).toBeTruthy()

    const dialog = await screen.findByRole('dialog', {}, SLOW)
    await waitFor(() => expect(within(dialog).getByText('Receipt attached')).toBeTruthy(), SLOW)
    expect(mocks.history).toHaveBeenCalledWith('tx-1')
    expect(within(dialog).getByText('Receipt added: till.pdf')).toBeTruthy()
    // 10:00 UTC on 3 September is 11:00 in London.
    expect(within(dialog).getByText(/11:00, Peter Pitcher/)).toBeTruthy()
    expect(within(dialog).getByText('Classified by a rule')).toBeTruthy()
    expect(within(dialog).getAllByText(/, automatic$/)).toHaveLength(2)
    // An entry of a kind added later is shown by its own name, not hidden.
    expect(within(dialog).getByText('Something new')).toBeTruthy()
    // A status line only where the status moved.
    expect(within(dialog).getAllByText(/ to /)).toHaveLength(1)
  })

  it('says there is nothing yet, and says when it could not be loaded', async () => {
    mocks.history.mockResolvedValueOnce({ entries: [] })
    layout.render(base, vi.fn())

    open()
    await waitFor(() => expect(screen.getByText('Nothing has been recorded for this transaction yet.')).toBeTruthy(), SLOW)

    mocks.history.mockResolvedValueOnce({ error: 'The history could not be loaded.' })
    open()
    await waitFor(() => expect(screen.getByText('The history could not be loaded')).toBeTruthy(), SLOW)

    mocks.history.mockRejectedValueOnce(new Error('network'))
    open()
    await waitFor(() => expect(screen.getByText('The history could not be loaded')).toBeTruthy(), SLOW)
    expect(screen.queryByText('Loading the history.')).toBeNull()
  })
})

describe('row helpers', () => {
  it('names the kinds of history entry in plain words', () => {
    expect(historyActionLabel('bulk_classification')).toBe('Classified in bulk')
    expect(historyActionLabel('invoice_attached')).toBe('Invoice attached')
    expect(historyActionLabel('some_new_kind')).toBe('Some new kind')
    expect(historyActionLabel('')).toBe('Change')
  })

  it('knows an invoice copy by its source or by the invoice it names', () => {
    expect(isInvoiceCopy({ source: 'invoice', invoice_id: null })).toBe(true)
    expect(isInvoiceCopy({ source: 'upload', invoice_id: 'inv-1' })).toBe(true)
    expect(isInvoiceCopy({ source: 'upload', invoice_id: null })).toBe(false)
  })
})
