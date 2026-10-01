// A category the AI suggests is not on the payment until a person says yes.
//
// The row and the phone card show the suggestion with Accept, Change and Dismiss. Accepting or
// changing it goes through one action that writes the category and closes the suggestion
// together; dismissing it leaves the payment as it was.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'react-hot-toast'
import { ReceiptTableRow } from '@/app/(authenticated)/receipts/_components/ui/ReceiptTableRow'
import { ReceiptMobileCard } from '@/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard'
import type { WorkspaceTransaction } from '@/app/(authenticated)/receipts/_components/ui/expenseChoice'
import { NO_CATEGORY_LABEL, NO_CATEGORY_VALUE } from '@/lib/receipts/no-category'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  updateClassification: vi.fn(),
  canManage: true,
}))

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() })
  return { toast, default: toast }
})

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => mocks.canManage }),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

vi.mock('@/app/actions/receipts', () => ({
  deleteReceiptFile: vi.fn(),
  getReceiptSignedUrl: vi.fn(),
  markReceiptTransaction: vi.fn(),
  updateReceiptNote: vi.fn(),
  updateReceiptClassification: (...args: unknown[]) => mocks.updateClassification(...args),
}))

vi.mock('@/app/actions/receipt-ai', () => ({
  decideReceiptAiCategory: (...args: unknown[]) => mocks.decide(...args),
}))

const base = {
  id: 'tx-1',
  batch_id: null,
  transaction_date: '2026-10-01',
  details: 'BT GROUP PLC DD',
  transaction_type: null,
  amount_in: null,
  amount_out: 54.2,
  amount_total: 54.2,
  balance: null,
  dedupe_hash: 'hash-1',
  source_type: 'bank',
  status: 'pending',
  receipt_required: true,
  vendor_id: 'v-bt',
  vendor_name: 'BT',
  vendor_source: 'ai',
  vendor_rule_id: null,
  expense_category: null,
  expense_category_source: null,
  expense_rule_id: null,
  no_category_applies: false,
  notes: null,
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  files: [],
  autoRule: null,
  aiSuggestion: null,
  aiNote: null,
} as unknown as WorkspaceTransaction

const SUGGESTED: WorkspaceTransaction = {
  ...base,
  aiSuggestion: { category: 'Telephone', noCategoryApplies: false, confidence: 91, reasoning: 'A phone line' },
}

const SLOW = { timeout: 10_000 }

/** Every message shown as a toast. The design system's toast calls the library's base function. */
function toasted(): unknown[] {
  return (toast as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0])
}
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.decide.mockReset()
  mocks.updateClassification.mockReset()
  mocks.canManage = true
})

type RenderRow = (transaction: WorkspaceTransaction, onUpdate: (...args: unknown[]) => void) => void

const renderers: Array<[string, RenderRow]> = [
  [
    'table row',
    (transaction, onUpdate) => {
      render(
        <table>
          <tbody>
            <ReceiptTableRow transaction={transaction} vendorOptions={['BT']} onUpdate={onUpdate} onRemove={vi.fn()} onRuleSuggestion={vi.fn()} />
          </tbody>
        </table>
      )
    },
  ],
  [
    'phone card',
    (transaction, onUpdate) => {
      render(<ReceiptMobileCard transaction={transaction} vendorOptions={['BT']} onUpdate={onUpdate} onRuleSuggestion={vi.fn()} />)
    },
  ],
]

describe.each(renderers)('a suggested category on the %s', (_name, renderRow) => {
  it('is shown as a suggestion, and the category is still to be set', () => {
    renderRow(SUGGESTED, vi.fn())

    expect(screen.getByText('Telephone')).toBeTruthy()
    expect(screen.getByText(/Suggested:/)).toBeTruthy()
    // The payment itself still has no category.
    expect(screen.getByRole('button', { name: 'Add category' })).toBeTruthy()
    for (const name of ['Accept', 'Change', 'Dismiss']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('shows nothing of the kind without a suggestion', () => {
    renderRow(base, vi.fn())

    expect(screen.queryByText(/Suggested:/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('accepts: the category is written and the suggestion goes', async () => {
    mocks.decide.mockResolvedValue({
      success: true,
      transaction: { ...base, expense_category: 'Telephone', expense_category_source: 'ai_accepted' },
    })
    const onUpdate = vi.fn()
    renderRow(SUGGESTED, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.decide).toHaveBeenCalledWith({ transactionId: 'tx-1', decision: 'accept' })
    expect(onUpdate.mock.calls[0][0]).toMatchObject({
      id: 'tx-1',
      expense_category: 'Telephone',
      expense_category_source: 'ai_accepted',
      aiSuggestion: null,
      files: [],
    })
    expect(toasted()).toEqual(['Category accepted'])
    expect(mocks.updateClassification).not.toHaveBeenCalled()
  })

  it('dismisses: the suggestion goes and the payment is left as it was', async () => {
    mocks.decide.mockResolvedValue({ success: true })
    const onUpdate = vi.fn()
    renderRow(SUGGESTED, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.decide).toHaveBeenCalledWith({ transactionId: 'tx-1', decision: 'dismiss' })
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ expense_category: null, aiSuggestion: null })
    expect(toasted()).toEqual(['Suggestion dismissed'])
  })

  it('changes: the picker opens on what was suggested, and another choice is recorded as a change', async () => {
    mocks.decide.mockResolvedValue({
      success: true,
      transaction: { ...base, expense_category: 'Licensing', expense_category_source: 'manual' },
    })
    const onUpdate = vi.fn()
    renderRow(SUGGESTED, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('Telephone')

    fireEvent.change(select, { target: { value: 'Licensing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.decide).toHaveBeenCalledWith({
      transactionId: 'tx-1',
      decision: 'edit',
      expenseCategory: 'Licensing',
      noCategoryApplies: false,
    })
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ expense_category: 'Licensing', aiSuggestion: null })
    // One call writes the category and closes the suggestion. The ordinary save is not used.
    expect(mocks.updateClassification).not.toHaveBeenCalled()
  })

  it('saving the suggested category from the picker is an accept', async () => {
    mocks.decide.mockResolvedValue({ success: true, transaction: { ...base, expense_category: 'Telephone' } })
    renderRow(SUGGESTED, vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.decide.mock.calls[0][0]).toMatchObject({ decision: 'accept' })
  })

  it('"No category applies" can be chosen in place of the suggestion', async () => {
    mocks.decide.mockResolvedValue({ success: true, transaction: { ...base, no_category_applies: true } })
    renderRow(SUGGESTED, vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: NO_CATEGORY_VALUE } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.decide).toHaveBeenCalledWith({
      transactionId: 'tx-1',
      decision: 'edit',
      expenseCategory: null,
      noCategoryApplies: true,
    })
  })

  it('says so when a rule or a person got there first, and shows the payment as it now is', async () => {
    mocks.decide.mockResolvedValue({
      error: 'This transaction has been categorised in the meantime. The suggestion has been closed.',
      superseded: true,
      transaction: { ...base, expense_category: 'Licensing', expense_category_source: 'rule' },
    })
    const onUpdate = vi.fn()
    renderRow(SUGGESTED, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(toasted()).toEqual([expect.stringMatching(/in the meantime/)]), SLOW)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ expense_category: 'Licensing', aiSuggestion: null })
  })

  it('keeps the suggestion on screen when accepting fails', async () => {
    mocks.decide.mockResolvedValue({ error: 'The suggestion could not be saved. Nothing was changed.' })
    const onUpdate = vi.fn()
    renderRow(SUGGESTED, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(toasted()).toEqual(['The suggestion could not be saved. Nothing was changed.']), SLOW)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('shows the suggestion to someone who cannot manage receipts, without the buttons', () => {
    mocks.canManage = false
    renderRow(SUGGESTED, vi.fn())

    expect(screen.getByText(/Suggested:/)).toBeTruthy()
    for (const name of ['Accept', 'Change', 'Dismiss']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('names a suggestion that no category applies', () => {
    renderRow({ ...base, aiSuggestion: { category: null, noCategoryApplies: true, confidence: 88, reasoning: null } }, vi.fn())

    expect(screen.getByText(NO_CATEGORY_LABEL)).toBeTruthy()
  })
})

describe.each(renderers)('"no category applies" on the %s', (_name, renderRow) => {
  it('is offered in the category picker and saved as its own answer', async () => {
    mocks.updateClassification.mockResolvedValue({
      success: true,
      changed: true,
      transaction: { ...base, no_category_applies: true, expense_category_source: 'manual' },
    })
    const onUpdate = vi.fn()
    renderRow(base, onUpdate)

    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect([...select.options].map((option) => option.label)).toContain(NO_CATEGORY_LABEL)

    fireEvent.change(select, { target: { value: NO_CATEGORY_VALUE } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.updateClassification).toHaveBeenCalledWith({
      transactionId: 'tx-1',
      expenseCategory: null,
      noCategoryApplies: true,
    })
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ no_category_applies: true })
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('is shown on a payment that has it, and the picker opens on it', () => {
    renderRow({ ...base, no_category_applies: true, expense_category_source: 'manual' } as WorkspaceTransaction, vi.fn())

    const button = screen.getByRole('button', { name: NO_CATEGORY_LABEL })
    expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull()

    fireEvent.click(button)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(NO_CATEGORY_VALUE)
  })

  it('clearing a category sends neither a category nor the marker', async () => {
    mocks.updateClassification.mockResolvedValue({ success: true, changed: true, transaction: { ...base } })
    renderRow({ ...base, expense_category: 'Telephone', expense_category_source: 'manual' } as WorkspaceTransaction, vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'Telephone' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateClassification).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.updateClassification).toHaveBeenCalledWith({
      transactionId: 'tx-1',
      expenseCategory: null,
      noCategoryApplies: false,
    })
  })
})

describe.each(renderers)('what the AI could not do, on the %s', (_name, renderRow) => {
  it('says so on the payment', () => {
    renderRow({ ...base, aiNote: 'The AI could not classify this transaction.' }, vi.fn())

    expect(screen.getByText('The AI could not classify this transaction.')).toBeTruthy()
  })
})
