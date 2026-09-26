import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RotaFeedButton from '@/app/(authenticated)/rota/RotaFeedButton'

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const FEED_URL = 'https://management.example.test/api/rota/feed?token=abc&uid=user-1'

describe('RotaFeedButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the calendar feed panel from Subscribe and copies the address', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<RotaFeedButton feedUrl={FEED_URL} />)

    expect(screen.queryByLabelText('Calendar feed address')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))

    const address = await screen.findByLabelText('Calendar feed address')
    expect(address).toHaveValue(FEED_URL)
    expect(address).toHaveAttribute('readonly')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })

    expect(writeText).toHaveBeenCalledWith(FEED_URL)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
  })

  it('closes the calendar feed panel from its own Close button', async () => {
    render(<RotaFeedButton feedUrl={FEED_URL} />)

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByLabelText('Calendar feed address')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calendar Feed' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByLabelText('Calendar feed address')).not.toBeInTheDocument())
  })

  it('only offers the calendar sync when the shared calendar is configured', () => {
    const { rerender } = render(<RotaFeedButton feedUrl={FEED_URL} />)
    expect(screen.queryByRole('button', { name: 'Sync Calendar' })).not.toBeInTheDocument()

    rerender(<RotaFeedButton feedUrl={FEED_URL} showCalendarSync />)
    expect(screen.getByRole('button', { name: 'Sync Calendar' })).toBeInTheDocument()
  })
})
