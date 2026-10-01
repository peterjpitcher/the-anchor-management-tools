// Bulk apply on the bulk review page is two steps: the numbers first, then a yes. The first
// step writes nothing. It sends the group's own transactions, and an empty box means "leave it".
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'react-hot-toast'
import ReceiptBulkReviewClient from '@/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient'
import { NO_CATEGORY_LABEL } from '@/lib/receipts/no-category'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  refresh: vi.fn(),
  canManage: true,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() })
  return { toast, default: toast }
})

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => mocks.canManage }),
}))

vi.mock('@/app/actions/receipts', () => ({
  applyReceiptGroupClassification: (...args: unknown[]) => mocks.apply(...args),
  createReceiptRuleFromGroup: vi.fn(),
}))

vi.mock('@/hooks/useRetroRuleRunner', () => ({
  useRetroRuleRunner: () => ({ previewRetro: vi.fn(), runRetro: vi.fn(), isRunning: false, isPreviewing: false, activeRuleId: null }),
}))

const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
const DETAILS = 'CARD PURCHASE TESCO'

function data(suggestion: Record<string, unknown> = {}): any {
  return {
    generatedAt: '2026-10-01T10:00:00Z',
    config: { limit: 25, statuses: ['pending'], onlyUnclassified: true, useFuzzyGrouping: true },
    groups: [
      {
        details: DETAILS,
        transactionIds: IDS,
        transactionCount: 3,
        needsVendorCount: 3,
        needsExpenseCount: 3,
        totalIn: 0,
        totalOut: 60,
        firstDate: '2026-09-01',
        lastDate: '2026-09-20',
        dominantVendor: null,
        dominantExpense: null,
        sampleTransaction: null,
        suggestion: { vendorName: 'Tesco', expenseCategory: null, reasoning: null, source: 'existing', model: null, ...suggestion },
      },
    ],
  }
}

const FILTERS = { limit: 25, statuses: ['pending' as const], onlyUnclassified: true }
const PREVIEW = { total: 3, willChange: 2, unchanged: 0, decidedByPerson: 1, locked: 0, incomingSkipped: 0 }

const SLOW = { timeout: 10_000 }
vi.setConfig({ testTimeout: 30_000 })

function toasted(): unknown[] {
  return (toast as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0])
}

async function clickWhenReady(name: string) {
  const button = (await screen.findByRole('button', { name }, SLOW)) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false), SLOW)
  fireEvent.click(button)
}

const startApply = () => fireEvent.click(screen.getByRole('button', { name: 'Apply Classification' }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.apply.mockReset()
  mocks.canManage = true
})

describe('bulk apply', () => {
  it('first asks what would change, sending the transactions themselves and writing nothing', async () => {
    mocks.apply.mockResolvedValue({ success: true, preview: PREVIEW })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()

    await screen.findByText('2 transactions will change', {}, SLOW)
    expect(mocks.apply).toHaveBeenCalledTimes(1)
    expect(mocks.apply.mock.calls[0][0]).toEqual({ details: DETAILS, transactionIds: IDS, vendorName: 'Tesco' })
    expect(screen.getByText('1 was decided by a person and will not change.')).toBeTruthy()
    expect(screen.getByText(/Statuses are not changed/)).toBeTruthy()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('leaves alone a field whose box is ticked but empty: it used to be cleared on every transaction', async () => {
    mocks.apply.mockResolvedValue({ success: true, preview: PREVIEW })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    // Both boxes start ticked for a group that needs both. The category is still "Leave unset".
    expect((screen.getByLabelText(`Apply expense category suggestion for ${DETAILS}`) as HTMLInputElement).checked).toBe(true)
    startApply()

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1), SLOW)
    expect(Object.prototype.hasOwnProperty.call(mocks.apply.mock.calls[0][0], 'expenseCategory')).toBe(false)
  })

  it('asks for something to apply when both boxes are empty', () => {
    render(<ReceiptBulkReviewClient initialData={data({ vendorName: null })} initialFilters={FILTERS} />)

    startApply()

    expect(toasted()).toContain('Enter a vendor or choose a category to apply')
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('sends a chosen category, and "no category applies" as its own choice', async () => {
    mocks.apply.mockResolvedValue({ success: true, preview: PREVIEW })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    fireEvent.change(screen.getByLabelText('Expense category'), { target: { value: 'Total Staff' } })
    startApply()
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.apply.mock.calls[0][0]).toMatchObject({ vendorName: 'Tesco', expenseCategory: 'Total Staff' })
    await clickWhenReady('Cancel')

    const select = screen.getByLabelText('Expense category') as HTMLSelectElement
    const none = [...select.options].find((option) => option.textContent === NO_CATEGORY_LABEL) as HTMLOptionElement
    fireEvent.change(select, { target: { value: none.value } })
    startApply()
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2), SLOW)
    expect(mocks.apply.mock.calls[1][0]).toMatchObject({ expenseCategory: null, noCategoryApplies: true })
  })

  it('makes the change only after a yes, and says how to undo it', async () => {
    mocks.apply
      .mockResolvedValueOnce({ success: true, preview: PREVIEW })
      .mockResolvedValueOnce({ success: true, preview: PREVIEW, runId: 'run-1', applied: 2, skippedChanged: 0, skippedLocked: 0 })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()
    await clickWhenReady('Apply')

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2), SLOW)
    expect(mocks.apply.mock.calls[1][0]).toEqual({
      details: DETAILS,
      transactionIds: IDS,
      vendorName: 'Tesco',
      createVendor: false,
      includeDecided: false,
      confirm: true,
    })
    await waitFor(() => expect(toasted()).toContain('Changed 2 transactions. Undo it from Recent runs in the rules section.'), SLOW)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('2 transactions will change')).toBeNull()
  })

  it('changes what a person decided only when the box is ticked', async () => {
    mocks.apply
      .mockResolvedValueOnce({ success: true, preview: PREVIEW })
      .mockResolvedValueOnce({ success: true, runId: 'run-1', applied: 3, skippedChanged: 0, skippedLocked: 0 })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()
    fireEvent.click(await screen.findByLabelText('Also change the 1 a person decided', {}, SLOW))
    await clickWhenReady('Apply')

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2), SLOW)
    expect(mocks.apply.mock.calls[1][0]).toMatchObject({ includeDecided: true, confirm: true })
  })

  it('will not apply when nothing would change, until the decided ones are included', async () => {
    mocks.apply.mockResolvedValue({ success: true, preview: { ...PREVIEW, willChange: 0, decidedByPerson: 3 } })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()
    const dialog = await screen.findByRole('dialog', {}, SLOW)
    const apply = within(dialog).getByRole('button', { name: 'Apply' }) as HTMLButtonElement
    await waitFor(() => expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(false), SLOW)
    expect(apply.disabled).toBe(true)

    fireEvent.click(within(dialog).getByLabelText('Also change the 3 a person decided'))
    expect(apply.disabled).toBe(false)
  })

  it('opens no dialog when every transaction already has what was asked for', async () => {
    mocks.apply.mockResolvedValue({ success: true, preview: { ...PREVIEW, willChange: 0, unchanged: 3, decidedByPerson: 0 } })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()

    await waitFor(() => expect(toasted()).toContain('Nothing to change: these transactions already have this.'), SLOW)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.apply).toHaveBeenCalledTimes(1)
  })

  it('cancelling the dialog changes nothing', async () => {
    mocks.apply.mockResolvedValue({ success: true, preview: PREVIEW })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()
    await clickWhenReady('Cancel')

    expect(screen.queryByText('2 transactions will change')).toBeNull()
    expect(mocks.apply).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('says how many were left because someone else changed them or they are locked', async () => {
    mocks.apply
      .mockResolvedValueOnce({ success: true, preview: PREVIEW })
      .mockResolvedValueOnce({ success: true, runId: 'run-1', applied: 1, skippedChanged: 1, skippedLocked: 2 })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()
    await clickWhenReady('Apply')

    await waitFor(
      () =>
        expect(toasted()).toContain(
          'Changed 1 transaction. 1 had changed and were left; 2 are on or before the lock date. Undo it from Recent runs in the rules section.'
        ),
      SLOW
    )
  })

  it('never says it worked when the run stopped part-way', async () => {
    mocks.apply
      .mockResolvedValueOnce({ success: true, preview: PREVIEW })
      .mockResolvedValueOnce({ error: 'This stopped part-way. What was changed is recorded under Recent runs and can be undone.', runId: 'run-1', applied: 1 })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()
    await clickWhenReady('Apply')

    await waitFor(() => expect(toasted()).toHaveLength(1), SLOW)
    expect(toasted()[0]).toBe('This stopped part-way. What was changed is recorded under Recent runs and can be undone. 1 were changed first.')
    // The page is still refreshed: some transactions did change.
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('says so and opens no dialog when the check itself fails', async () => {
    mocks.apply.mockResolvedValue({ error: 'The transactions could not be loaded. Nothing was changed.' })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    startApply()

    await waitFor(() => expect(toasted()).toContain('The transactions could not be loaded. Nothing was changed.'), SLOW)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before making a vendor out of a name that is not on the list, then goes on to the numbers', async () => {
    mocks.apply
      .mockResolvedValueOnce({ vendorConfirmation: { name: 'Tescos', similar: [{ id: 'v-tesco', name: 'Tesco' }] } })
      .mockResolvedValueOnce({ success: true, preview: PREVIEW })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Tescos' } })
    startApply()

    await screen.findByText('"Tescos" is not on the vendor list.', {}, SLOW)
    await clickWhenReady('Use Tesco')

    await screen.findByText('2 transactions will change', {}, SLOW)
    expect(mocks.apply.mock.calls[1][0]).toMatchObject({ vendorName: 'Tesco', transactionIds: IDS })
    expect(mocks.apply.mock.calls[1][0].createVendor).toBeUndefined()
    // The box now holds the vendor that will be used.
    expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('Tesco')
  })

  it('creates the vendor only when the person says it is new', async () => {
    mocks.apply
      .mockResolvedValueOnce({ vendorConfirmation: { name: 'Booker', similar: [] } })
      .mockResolvedValueOnce({ success: true, preview: PREVIEW })
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Booker' } })
    startApply()
    await clickWhenReady('Create New Vendor')

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2), SLOW)
    expect(mocks.apply.mock.calls[1][0]).toMatchObject({ vendorName: 'Booker', createVendor: true })
  })

  it('does nothing for someone who can only view', () => {
    mocks.canManage = false
    render(<ReceiptBulkReviewClient initialData={data()} initialFilters={FILTERS} />)

    expect((screen.getByRole('button', { name: 'Apply Classification' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
