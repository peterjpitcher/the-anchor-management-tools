import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RefundDialog } from '@/components/features/invoices/RefundDialog'

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
