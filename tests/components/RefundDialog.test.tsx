import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RefundDialog } from '@/components/features/invoices/RefundDialog'
import { processManualRefund, processPayPalRefund } from '@/app/actions/refundActions'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, toast }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/app/actions/refundActions', () => ({
  processPayPalRefund: vi.fn(),
  processManualRefund: vi.fn(),
}))

function renderDialog(overrides: Partial<React.ComponentProps<typeof RefundDialog>> = {}) {
  return render(
    <RefundDialog
      open
      onOpenChange={vi.fn()}
      sourceType="parking"
      sourceId="booking-1"
      originalAmount={40}
      totalRefunded={0}
      totalPending={0}
      hasPayPalCapture
      captureExpired={false}
      {...overrides}
    />,
  )
}

describe('RefundDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function submitRefund() {
    fireEvent.change(await screen.findByLabelText(/^Reason/), { target: { value: 'Guest cancelled' } })
    fireEvent.click(screen.getByRole('button', { name: 'Process Refund' }))
  }

  const BOOKING_NOT_UPDATED =
    'The refund went through, but the booking was not updated to show it. Do not refund again: ' +
    'tell the developer so the booking record can be corrected.'

  it.each([
    ['PayPal', 'paypal'],
    ['Cash', 'cash'],
  ] as const)(
    'shows the warning, not a success, when a %s refund went through but the booking was not updated',
    async (methodLabel, method) => {
      const onOpenChange = vi.fn()
      const action = method === 'paypal' ? processPayPalRefund : processManualRefund
      vi.mocked(action).mockResolvedValue({ success: true, refundId: 'refund-1', warning: BOOKING_NOT_UPDATED })
      renderDialog({ onOpenChange })

      fireEvent.click(within(await screen.findByRole('group', { name: 'Refund method' })).getByRole('radio', { name: methodLabel }))
      await submitRefund()

      await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(BOOKING_NOT_UPDATED, { duration: 12000 }))
      expect(toast.success).not.toHaveBeenCalled()
      // The refund is done, so the dialog closes rather than inviting a second attempt.
      expect(onOpenChange).toHaveBeenCalledWith(false)
    }
  )

  it('shows the ordinary success toast when the refund was fully recorded', async () => {
    vi.mocked(processPayPalRefund).mockResolvedValue({ success: true, refundId: 'refund-1' })
    renderDialog()

    await submitRefund()

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('groups the refund methods under one named fieldset', async () => {
    renderDialog()

    const group = await screen.findByRole('group', { name: 'Refund method' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      'paypal',
      'cash',
      'bank_transfer',
      'other',
    ])
    expect(within(group).getByRole('radio', { name: 'PayPal' })).toBeChecked()
  })

  it('offers no PayPal refund once the capture has expired', async () => {
    renderDialog({ captureExpired: true })

    const group = await screen.findByRole('group', { name: 'Refund method' })
    expect(within(group).getByRole('radio', { name: 'PayPal' })).toBeDisabled()
    expect(within(group).getByRole('radio', { name: 'Cash' })).toBeChecked()
  })
})
