import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EndRecurringChargeModal } from './EndRecurringChargeModal'
import { previewEndRecurringCharge, endRecurringCharge, type EndChargePreview } from '@/app/actions/oj-projects/recurring-charges'

vi.mock('@/app/actions/oj-projects/recurring-charges', () => ({
  previewEndRecurringCharge: vi.fn(), endRecurringCharge: vi.fn(),
}))
vi.mock('react-hot-toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/dateUtils', () => ({ getTodayIsoDate: () => '2026-10-04' }))

const preview: EndChargePreview = {
  chargeId: 'charge-1', endDate: '2026-10-04', preview: true,
  items: [
    { id: 'old', start: '2026-09-01', end: '2026-09-30', originalEnd: '2026-09-30', amountExVat: 31, amountIncVat: 37.2, previousAmountExVat: 31, removed: false },
    { id: null, start: '2026-10-01', end: '2026-10-04', originalEnd: '2026-10-31', amountExVat: 4, amountIncVat: 4.8, previousAmountExVat: 31, removed: false },
    { id: 'future', start: '2026-11-01', end: '2026-11-30', originalEnd: '2026-11-30', amountExVat: 0, amountIncVat: 0, previousAmountExVat: 31, removed: true },
  ], totalExVat: 35, totalIncVat: 42,
}

function setup() {
  const onClose = vi.fn()
  const onEnded = vi.fn().mockResolvedValue(undefined)
  render(<EndRecurringChargeModal charge={{ id: 'charge-1', description: 'baronshub', created_at: '2026-01-01' }} onClose={onClose} onEnded={onEnded} />)
  return { onClose, onEnded }
}

describe('EndRecurringChargeModal', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows all arrears, final and removed items before passing the exact preview to confirmation', async () => {
    vi.mocked(previewEndRecurringCharge).mockResolvedValue({ preview })
    vi.mocked(endRecurringCharge).mockResolvedValue({ preview: { ...preview, preview: false } })
    const { onEnded, onClose } = setup()
    expect(screen.getByRole('button', { name: 'End charge' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Preview final charge' }))
    expect(await screen.findByText('2026-10-01 to 2026-10-04')).toBeInTheDocument()
    expect(screen.getByText('2026-09-01 to 2026-09-30')).toBeInTheDocument()
    expect(screen.getByText('2026-11-01 to 2026-11-30')).toBeInTheDocument()
    expect(screen.getByText(/Total outstanding: £35.00 ex VAT, £42.00 inc VAT/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'End charge' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(endRecurringCharge).toHaveBeenCalledWith('charge-1', '2026-10-04', preview)
    expect(onEnded).toHaveBeenCalledOnce()
  })

  it('removes confirmation when the date changes', async () => {
    vi.mocked(previewEndRecurringCharge).mockResolvedValue({ preview })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Preview final charge' }))
    await screen.findByText('2026-10-01 to 2026-10-04')
    fireEvent.change(screen.getByLabelText(/Last service date/), { target: { value: '2026-10-05' } })
    expect(screen.getByRole('button', { name: 'End charge' })).toBeDisabled()
    expect(screen.queryByText('2026-10-01 to 2026-10-04')).not.toBeInTheDocument()
  })

  it('shows preview errors without allowing confirmation', async () => {
    vi.mocked(previewEndRecurringCharge).mockResolvedValue({ error: 'Already invoiced service overlaps this date' })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Preview final charge' }))
    expect(await screen.findByText('Already invoiced service overlaps this date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End charge' })).toBeDisabled()
  })

  it('shows confirmation errors and requires another preview', async () => {
    vi.mocked(previewEndRecurringCharge).mockResolvedValue({ preview })
    vi.mocked(endRecurringCharge).mockResolvedValue({ error: 'Charge changed since preview' })
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Preview final charge' }))
    await screen.findByText('2026-10-01 to 2026-10-04')
    fireEvent.click(screen.getByRole('button', { name: 'End charge' }))
    expect(await screen.findByText('Charge changed since preview')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'End charge' })).toBeDisabled()
  })

  it('locks the date and prevents duplicate previews while the request is pending', async () => {
    let resolve!: (value: { preview: EndChargePreview }) => void
    vi.mocked(previewEndRecurringCharge).mockReturnValue(new Promise((done) => { resolve = done }))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Preview final charge' }))
    expect(screen.getByLabelText(/Last service date/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Preview final charge' })).toBeDisabled()
    resolve({ preview })
    await waitFor(() => expect(screen.getByLabelText(/Last service date/)).not.toBeDisabled())
    expect(previewEndRecurringCharge).toHaveBeenCalledOnce()
  })
})
