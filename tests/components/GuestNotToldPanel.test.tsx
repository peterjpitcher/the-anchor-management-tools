import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuestNotToldPanel } from '@/components/features/table-bookings/GuestNotToldPanel'

/** BK-177: the warning stays, with the guest's number, until someone says they have rung. */

const ITEM = {
  bookingId: 'b-1',
  bookingReference: 'TB-05C027D7',
  bookingDate: '2026-11-20',
  bookingTime: '19:00:00',
  guestName: 'Sam Guest',
  phone: '07700 900123',
  since: '2026-10-26T10:00:00Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('GuestNotToldPanel', () => {
  it('shows the guest and their number, and clears once someone has rung', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: [ITEM] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<GuestNotToldPanel canEdit bookingId="b-1" />)

    expect(await screen.findByText('Guest not told about the cancellation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '07700 900123' })).toHaveAttribute('href', 'tel:07700 900123')
    expect(fetchMock).toHaveBeenCalledWith('/api/foh/guest-not-told?booking_id=b-1', { cache: 'no-store' })

    fireEvent.click(screen.getByRole('button', { name: "I've rung them" }))

    await waitFor(() => expect(screen.queryByText('Guest not told about the cancellation')).toBeNull())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/foh/guest-not-told', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ booking_id: 'b-1' }),
    }))
  })

  it('keeps the warning when the call could not be saved', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: [ITEM] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'nope' }) }))

    render(<GuestNotToldPanel canEdit />)
    fireEvent.click(await screen.findByRole('button', { name: "I've rung them" }))

    expect(await screen.findByText('That was not saved. Try again.')).toBeInTheDocument()
    expect(screen.getByText('Guest not told about the cancellation')).toBeInTheDocument()
  })

  it('shows nothing when there is no one to ring', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<GuestNotToldPanel canEdit />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
