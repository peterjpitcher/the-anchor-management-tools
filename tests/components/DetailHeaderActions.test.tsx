import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  DetailHeaderActions,
  type DetailHeaderAction,
} from '@/app/(authenticated)/invoices/_components/DetailHeaderActions'

/**
 * The finance detail header: secondary actions first, then a labelled "More" menu, then
 * destructive actions, then the primary action last. More than three actions collapse the extras
 * into the menu.
 */

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

function buttonNames(container: HTMLElement): string[] {
  return within(container).getAllByRole('button').map((button) => button.textContent ?? '')
}

describe('DetailHeaderActions', () => {
  it('shows up to three actions with no menu, in the contract order', () => {
    const actions: DetailHeaderAction[] = [
      { key: 'reissue', label: 'Reissue', icon: 'refresh', tone: 'primary', onSelect: vi.fn() },
      { key: 'delete', label: 'Delete', icon: 'trash', tone: 'danger', onSelect: vi.fn() },
      { key: 'pdf', label: 'Download PDF', icon: 'download', onSelect: vi.fn() },
    ]
    const { container } = render(<div><DetailHeaderActions actions={actions} /></div>)

    expect(buttonNames(container)).toEqual(['Download PDF', 'Delete', 'Reissue'])
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('keeps the primary action and the first others on screen and puts the rest in More', async () => {
    const user = userEvent.setup()
    const onVoid = vi.fn()
    const actions: DetailHeaderAction[] = [
      { key: 'edit', label: 'Edit', icon: 'edit', href: '/invoices/1/edit' },
      { key: 'delete', label: 'Delete', icon: 'trash', tone: 'danger', onSelect: vi.fn() },
      { key: 'email', label: 'Email Invoice', icon: 'mail', onSelect: vi.fn() },
      { key: 'pdf', label: 'Download PDF', icon: 'download', onSelect: vi.fn() },
      { key: 'void', label: 'Void', icon: 'ban', tone: 'danger', onSelect: onVoid },
      { key: 'reissue', label: 'Reissue', icon: 'refresh', tone: 'primary', onSelect: vi.fn() },
    ]
    const { container } = render(<div><DetailHeaderActions actions={actions} /></div>)

    // Edit is a link; the buttons read: More, the destructive Delete, then the primary action.
    expect(within(container).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/invoices/1/edit')
    expect(buttonNames(container)).toEqual(['More', 'Delete', 'Reissue'])

    await user.click(screen.getByRole('button', { name: 'More' }))
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Email Invoice', 'Download PDF', 'Void'])

    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Void' }))
    expect(onVoid).toHaveBeenCalledTimes(1)
  })
})
