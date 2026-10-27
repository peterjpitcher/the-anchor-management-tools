import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The merge dialog on the customer page (BK-164): staff choose the record to keep, see exactly
 * what moves, then confirm. Nothing is merged before the preview has been seen.
 */

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const actions = vi.hoisted(() => ({ previewCustomerMerge: vi.fn(), mergeCustomers: vi.fn() }))
vi.mock('@/app/actions/customer-merge', () => actions)

vi.mock('@/components/features/customers/CustomerSearchInput', () => ({
  default: ({ onCustomerSelect }: { onCustomerSelect: (customer: unknown) => void }) => (
    <button type="button" onClick={() => onCustomerSelect({ id: 'keep-1', first_name: 'Jo', last_name: 'Bloggs', mobile_number: '+447700900101', email: null })}>
      pick Jo
    </button>
  ),
}))

import { MergeCustomerDialog } from '@/components/features/customers/MergeCustomerDialog'

const PREVIEW = {
  state: 'merged',
  preview: true,
  keep_id: 'keep-1',
  merge_id: 'dup-1',
  moved: { messages: 3, table_bookings: 2 },
  duplicates_dropped: {},
  left_behind: { event_check_ins: 1 },
  email_moved: true,
  sms_opted_out: true,
  whatsapp_opted_out: false,
}

describe('MergeCustomerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.previewCustomerMerge.mockResolvedValue({ success: true, data: PREVIEW })
    actions.mergeCustomers.mockResolvedValue({ success: true, data: { ...PREVIEW, preview: false } })
  })

  it('shows what moves before offering the merge, then merges and opens the kept record', async () => {
    render(<MergeCustomerDialog open onClose={vi.fn()} customerId="dup-1" customerName="Joanne Bloggs" />)

    expect(screen.getByRole('button', { name: 'Check what moves' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Merge into/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'pick Jo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check what moves' }))

    expect(await screen.findByText('3 text messages')).toBeInTheDocument()
    expect(screen.getByText('2 table bookings')).toBeInTheDocument()
    expect(screen.getByText('1 event check-in')).toBeInTheDocument()
    expect(actions.previewCustomerMerge).toHaveBeenCalledWith('dup-1', 'keep-1')
    expect(actions.mergeCustomers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Merge into Jo Bloggs' }))

    await waitFor(() => expect(actions.mergeCustomers).toHaveBeenCalledWith('dup-1', 'keep-1'))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/customers/keep-1'))
  })

  it('shows a refusal and never offers the merge', async () => {
    actions.previewCustomerMerge.mockResolvedValue({
      error: 'Both records are booked on the same event. Cancel one of those bookings first.',
    })
    render(<MergeCustomerDialog open onClose={vi.fn()} customerId="dup-1" customerName="Joanne Bloggs" />)

    fireEvent.click(screen.getByRole('button', { name: 'pick Jo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check what moves' }))

    expect(await screen.findByText('Both records are booked on the same event. Cancel one of those bookings first.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Merge into/ })).not.toBeInTheDocument()
  })
})
