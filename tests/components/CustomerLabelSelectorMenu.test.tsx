// The customer label menu fits its longest label, because label names are chosen by staff and a
// fixed narrow menu wrapped them onto two lines.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/actions/customer-labels', () => ({
  getCustomerLabels: vi.fn(),
  getCustomerLabelAssignments: vi.fn(),
  assignLabelToCustomer: vi.fn(),
  removeLabelFromCustomer: vi.fn(),
}))

import { CustomerLabelSelector } from '@/components/features/customers/CustomerLabelSelector'
import type { CustomerLabel } from '@/app/actions/customer-labels'

const LABELS: CustomerLabel[] = [
  { id: 'l1', name: 'Sunday Lunch Regular', color: '#336699', created_at: '', updated_at: '' },
  { id: 'l2', name: 'Private Hire Enquirer (2026)', color: '#993366', created_at: '', updated_at: '' },
]

describe('CustomerLabelSelector menu', () => {
  it('fits the menu to the longest label instead of the narrow default', async () => {
    const user = userEvent.setup()
    render(<CustomerLabelSelector customerId="c1" canEdit initialLabels={LABELS} initialAssignments={[]} />)

    await user.click(screen.getByRole('button', { name: 'Add Label' }))

    const menu = screen.getByRole('menu')
    expect(menu).toHaveClass('w-max', 'min-w-48', 'max-w-80')
    expect(menu).not.toHaveClass('w-48')
    expect(within(menu).getByRole('menuitem', { name: 'Private Hire Enquirer (2026)' })).toBeInTheDocument()
  })
})
