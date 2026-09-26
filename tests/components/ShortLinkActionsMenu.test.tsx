import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/actions/short-links', () => ({ getOrCreateUtmVariant: vi.fn() }))
vi.mock('@/app/(authenticated)/short-links/_components/qr-download', () => ({
  downloadQrPng: vi.fn(),
  safeQrFilename: vi.fn(() => 'qr.png'),
}))

import { ShortLinkActionsMenu } from '@/app/(authenticated)/short-links/_components/ShortLinkActionsMenu'
import type { ShortLink } from '@/types/short-links'

const LINK = {
  id: 'link-1',
  short_code: 'quiz',
  destination_url: 'https://www.the-anchor.pub/whats-on/quiz',
  parent_link_id: null,
  name: 'Quiz night',
  link_type: 'custom',
} as unknown as ShortLink

function renderMenu(overrides: Partial<Parameters<typeof ShortLinkActionsMenu>[0]> = {}) {
  const props = {
    link: LINK,
    canManage: true,
    onAnalytics: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(
    // The row menu sits in a table that scrolls sideways; the menu must escape it.
    <div data-testid="clip" className="overflow-x-auto">
      <ShortLinkActionsMenu {...props} />
    </div>,
  )
  return props
}

describe('ShortLinkActionsMenu (DS Dropdown)', () => {
  it('opens outside the clipping table with its sections and actions', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Short link actions' }))

    const menu = screen.getByRole('menu')
    expect(screen.getByTestId('clip')).not.toContainElement(menu)
    expect(within(menu).getByText('Manage')).toHaveAttribute('role', 'presentation')
    expect(within(menu).getByText('Campaign links')).toHaveAttribute('role', 'presentation')
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('hides the manage and campaign entries from someone who cannot manage links', async () => {
    const user = userEvent.setup()
    renderMenu({ canManage: false })

    await user.click(screen.getByRole('button', { name: 'Short link actions' }))

    const menu = screen.getByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(menu).queryByText('Campaign links')).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Analytics' })).toBeInTheDocument()
  })

  it('opens a sub-list in place, goes back, and starts at the top again after closing', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Short link actions' })

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: /QR Codes/ }))

    // Still open, now showing the QR list.
    expect(screen.getByRole('menuitem', { name: 'Download All QRs' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Back' }))
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /Digital UTM Links/ }))
    expect(screen.getByRole('menuitem', { name: 'Back' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('closes and hands the link over when an action is chosen', async () => {
    const user = userEvent.setup()
    const props = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Short link actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(props.onDelete).toHaveBeenCalledWith(LINK)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})
