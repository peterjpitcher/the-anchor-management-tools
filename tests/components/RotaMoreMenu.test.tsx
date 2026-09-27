import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RotaMoreMenu from '@/app/(authenticated)/rota/RotaMoreMenu'

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }),
}))

const FEED_URL = 'https://management.example.test/api/rota/feed?token=abc&uid=user-1'

async function chooseFromMenu(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: 'More' }))
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }))
}

describe('RotaMoreMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    pushMock.mockReset()
  })

  it('opens the calendar feed dialog from Subscribe to Calendar and copies the address', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<RotaMoreMenu feedUrl={FEED_URL} />)

    expect(screen.queryByLabelText('Calendar feed address')).not.toBeInTheDocument()

    await chooseFromMenu(user, 'Subscribe to Calendar')

    const dialog = await screen.findByRole('dialog', { name: 'Subscribe to Calendar' })
    const address = within(dialog).getByLabelText('Calendar feed address')
    expect(address).toHaveValue(FEED_URL)
    expect(address).toHaveAttribute('readonly')

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    })

    expect(writeText).toHaveBeenCalledWith(FEED_URL)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument())
  })

  it('closes the calendar feed dialog from its own Close button', async () => {
    const user = userEvent.setup()
    render(<RotaMoreMenu feedUrl={FEED_URL} />)

    await chooseFromMenu(user, 'Subscribe to Calendar')
    const dialog = await screen.findByRole('dialog', { name: 'Subscribe to Calendar' })
    expect(within(dialog).getByLabelText('Calendar feed address')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByLabelText('Calendar feed address')).not.toBeInTheDocument())
  })

  it('only offers the calendar sync when the shared calendar is configured', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<RotaMoreMenu feedUrl={FEED_URL} />)
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Sync Calendar' })).not.toBeInTheDocument()
    unmount()

    render(<RotaMoreMenu feedUrl={FEED_URL} showCalendarSync />)
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Sync Calendar' })).toBeInTheDocument()
  })

  it('opens the settings links it is given', async () => {
    const user = userEvent.setup()
    render(
      <RotaMoreMenu
        feedUrl={FEED_URL}
        links={[{ key: 'pay-bands', label: 'Pay Bands', href: '/settings/pay-bands', icon: 'cash' }]}
      />,
    )

    await chooseFromMenu(user, 'Pay Bands')

    expect(pushMock).toHaveBeenCalledWith('/settings/pay-bands')
  })
})
