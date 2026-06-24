import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HoldingQueueActions } from '@/app/(authenticated)/messages/holding/_components/HoldingQueueActions'

const refresh = vi.fn()
const linkAction = vi.fn()
const ignoreAction = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/app/actions/communications', () => ({
  linkUnmatchedCommunicationAction: (...args: unknown[]) => linkAction(...args),
  ignoreUnmatchedCommunicationAction: (...args: unknown[]) => ignoreAction(...args),
}))

vi.mock('@/components/features/customers/CustomerSearchInput', () => ({
  default: ({ onCustomerSelect }: any) => (
    <button
      type="button"
      onClick={() => onCustomerSelect({
        id: 'customer-1',
        first_name: 'Jane',
        last_name: 'Smith',
        mobile_number: null,
        email: null,
      })}
    >
      Select Jane Smith
    </button>
  ),
}))

describe('HoldingQueueActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    linkAction.mockResolvedValue({ success: true })
    ignoreAction.mockResolvedValue({ success: true })
  })

  it('shows a visible error when linking without a selected customer', () => {
    render(<HoldingQueueActions unmatchedId="unmatched-1" candidateCustomerIds={['customer-1']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(screen.getByText('Choose a customer first.')).toBeInTheDocument()
    expect(linkAction).not.toHaveBeenCalled()
  })

  it('links the selected customer and refreshes the page', async () => {
    render(<HoldingQueueActions unmatchedId="unmatched-1" candidateCustomerIds={['customer-1']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select Jane Smith' }))
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    await waitFor(() => expect(linkAction).toHaveBeenCalled())
    const submitted = linkAction.mock.calls[0][0] as FormData
    expect(submitted.get('unmatchedId')).toBe('unmatched-1')
    expect(submitted.get('customerId')).toBe('customer-1')
    expect(refresh).toHaveBeenCalled()
  })

  it('surfaces ignore failures', async () => {
    ignoreAction.mockResolvedValue({ error: 'Failed to ignore communication' })
    render(<HoldingQueueActions unmatchedId="unmatched-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))

    expect(await screen.findByText('Failed to ignore communication')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})
