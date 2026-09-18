import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import CustomerLabelsClient from '@/app/(authenticated)/settings/customer-labels/CustomerLabelsClient'
import type { CustomerLabel } from '@/app/actions/customer-labels'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/actions/customer-labels', () => ({
  getCustomerLabels: vi.fn(),
  createCustomerLabel: vi.fn(),
  updateCustomerLabel: vi.fn(),
  deleteCustomerLabel: vi.fn(),
  applyLabelsRetroactively: vi.fn(),
}))

const labels = [
  {
    id: 'label-1',
    name: 'VIP',
    description: null,
    color: '#10B981',
    icon: 'star',
    auto_apply_rules: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
] as unknown as CustomerLabel[]

function pressedIn(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent?.trim() ?? '')
}

// Same gap as the event category pickers: the chosen colour and icon were shown only as a
// ring or border (accessibility review, 18 Sep 2026).
describe('customer label colour and icon pickers', () => {
  it('say which colour and icon are selected, and follow a new pick', () => {
    render(<CustomerLabelsClient initialLabels={labels} canManage />)
    // PageLayout renders the header actions for wide and narrow screens alike.
    fireEvent.click(screen.getAllByRole('button', { name: 'New Label' })[0])

    const colours = screen.getByRole('group', { name: 'Color' })
    expect(within(colours).getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'true')
    expect(pressedIn(colours)).toEqual(['Green'])

    fireEvent.click(within(colours).getByRole('button', { name: 'Blue' }))
    expect(pressedIn(colours)).toEqual(['Blue'])

    const icons = screen.getByRole('group', { name: 'Icon' })
    expect(within(icons).getByRole('button', { name: 'Star' })).toHaveAttribute('aria-pressed', 'true')
    expect(pressedIn(icons)).toEqual(['Star'])

    fireEvent.click(within(icons).getByRole('button', { name: 'Heart' }))
    expect(pressedIn(icons)).toEqual(['Heart'])
  })
})
