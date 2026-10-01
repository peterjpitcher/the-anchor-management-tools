// A vendor typed on a payment is added to the vendor list only after the person has been asked.
//
// Typing an unseen spelling used to create a vendor without a word, which is how the list came
// to hold "Oak Farm Gas Co" and "Oak Farm Gas Co Ltd". The row now shows what the name might
// be, and saves under the existing vendor or creates the new one, as the person chooses.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiptTableRow } from '@/app/(authenticated)/receipts/_components/ui/ReceiptTableRow'
import { ReceiptMobileCard } from '@/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard'
import type { ReceiptFile, ReceiptTransaction } from '@/types/database'

const updateReceiptClassification = vi.hoisted(() => vi.fn())

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() })
  return { toast, default: toast }
})

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

vi.mock('@/app/actions/receipts', () => ({
  deleteReceiptFile: vi.fn(),
  getReceiptSignedUrl: vi.fn(),
  markReceiptTransaction: vi.fn(),
  updateReceiptNote: vi.fn(),
  updateReceiptClassification: (...args: unknown[]) => updateReceiptClassification(...args),
}))

type WorkspaceTransaction = ReceiptTransaction & {
  files: ReceiptFile[]
  autoRule?: { id: string; name: string } | null
}

const transaction = {
  id: 'tx-1',
  batch_id: null,
  transaction_date: '2026-10-01',
  details: 'OAK FARM GAS',
  transaction_type: null,
  amount_in: 0,
  amount_out: 80,
  amount_total: 80,
  balance: null,
  dedupe_hash: 'hash-1',
  source_type: 'bank',
  status: 'pending',
  receipt_required: true,
  vendor_id: null,
  vendor_name: null,
  vendor_source: null,
  vendor_rule_id: null,
  expense_category: null,
  expense_category_source: null,
  expense_rule_id: null,
  notes: null,
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  files: [],
  autoRule: null,
} as unknown as WorkspaceTransaction

const PROMPT = { name: 'Oak Farm Gas', similar: [{ id: 'vendor-oak', name: 'Oak Farm Gas Co' }] }
const SAVED = { success: true, changed: true, transaction: { ...transaction, vendor_name: 'Oak Farm Gas Co', vendor_id: 'vendor-oak' } }

// The dialog opens through a transition, which is slow when the whole suite runs at once.
const SLOW = { timeout: 10_000 }

/**
 * A button in the dialog, once it can be pressed. The dialog opens while the first save is still
 * settling, and its buttons are disabled for that moment; a click then would do nothing.
 */
async function enabledButton(name: string): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name }, SLOW)
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), SLOW)
  return button
}

function typeNewVendor(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '__custom__' } })
  fireEvent.change(screen.getByPlaceholderText(/Vendor/), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  vi.clearAllMocks()
  // Also drops any queued one-off answers, so one failing test cannot upset the next.
  updateReceiptClassification.mockReset()
})

describe.each([
  [
    'table row',
    (onUpdate: () => void) =>
      render(
        <table>
          <tbody>
            <ReceiptTableRow transaction={transaction} vendorOptions={['Tesco']} onUpdate={onUpdate} onRuleSuggestion={vi.fn()} />
          </tbody>
        </table>
      ),
  ],
  [
    'phone card',
    (onUpdate: () => void) =>
      render(<ReceiptMobileCard transaction={transaction} vendorOptions={['Tesco']} onUpdate={onUpdate} onRuleSuggestion={vi.fn()} />),
  ],
])('a new vendor typed on the %s', (_name, renderRow) => {
  it('asks first, and nothing is created until the person says so', async () => {
    updateReceiptClassification.mockResolvedValueOnce({ vendorConfirmation: PROMPT })
    const onUpdate = vi.fn()
    renderRow(onUpdate)

    typeNewVendor('Oak Farm Gas')

    expect(await screen.findByText('"Oak Farm Gas" is not on the vendor list.', undefined, SLOW)).toBeTruthy()
    expect(updateReceiptClassification).toHaveBeenCalledTimes(1)
    expect(updateReceiptClassification.mock.calls[0][0]).toEqual({ transactionId: 'tx-1', vendorName: 'Oak Farm Gas' })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('saves under the existing vendor when the person picks it', async () => {
    updateReceiptClassification.mockResolvedValueOnce({ vendorConfirmation: PROMPT }).mockResolvedValueOnce(SAVED)
    const onUpdate = vi.fn()
    renderRow(onUpdate)

    typeNewVendor('Oak Farm Gas')
    fireEvent.click(await enabledButton('Use Oak Farm Gas Co'))

    await waitFor(() => expect(updateReceiptClassification).toHaveBeenCalledTimes(2), SLOW)
    expect(updateReceiptClassification.mock.calls[1][0]).toEqual({ transactionId: 'tx-1', vendorName: 'Oak Farm Gas Co' })
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
  })

  it('creates the vendor when the person confirms it is new', async () => {
    updateReceiptClassification.mockResolvedValueOnce({ vendorConfirmation: PROMPT }).mockResolvedValueOnce(SAVED)
    const onUpdate = vi.fn()
    renderRow(onUpdate)

    typeNewVendor('Oak Farm Gas')
    fireEvent.click(await enabledButton('Create New Vendor'))

    await waitFor(() => expect(updateReceiptClassification).toHaveBeenCalledTimes(2), SLOW)
    expect(updateReceiptClassification.mock.calls[1][0]).toEqual({ transactionId: 'tx-1', vendorName: 'Oak Farm Gas', createVendor: true })
  })

  it('saves nothing when the person cancels', async () => {
    updateReceiptClassification.mockResolvedValueOnce({ vendorConfirmation: PROMPT })
    const onUpdate = vi.fn()
    renderRow(onUpdate)

    typeNewVendor('Oak Farm Gas')
    // The vendor edit has its own Cancel, so the dialog's is the last one on the page.
    await screen.findByText('"Oak Farm Gas" is not on the vendor list.', undefined, SLOW)
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' })
    const dialogCancel = cancelButtons[cancelButtons.length - 1]
    await waitFor(() => expect((dialogCancel as HTMLButtonElement).disabled).toBe(false), SLOW)
    fireEvent.click(dialogCancel)

    await waitFor(() => expect(screen.queryByText('"Oak Farm Gas" is not on the vendor list.')).toBeNull(), SLOW)

    expect(updateReceiptClassification).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
