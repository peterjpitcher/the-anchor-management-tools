// The 'Still open from earlier' strip (owner decisions, 22 November 2026): its one-tap No-show is
// followed by the same Undo as the floor's, and it reads its list again when told to, so it only
// ever shows what is genuinely still open.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenEarlierBookingsStrip } from './OpenEarlierBookingsStrip'

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

import { toast } from '@/ds/primitives/Toast'

const OPEN = {
  id: '11111111-1111-4111-8111-111111111111',
  bookingReference: 'TB-OPEN',
  bookingDate: '2026-11-20',
  bookingTime: '18:00:00',
  partySize: 4,
  guestName: 'Sam Guest',
}
const TICKET = { action: 'no_show', stamp: '2026-11-21T10:00:00.000Z' }

function installFetch(lists: Array<typeof OPEN[]>, undo: { ok: boolean; error?: string } = { ok: true }) {
  let listCall = 0
  const calls: Array<{ url: string; body: unknown }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url === '/api/foh/bookings/open-earlier') {
      const bookings = lists[Math.min(listCall, lists.length - 1)]
      listCall += 1
      return { ok: true, status: 200, json: async () => ({ success: true, data: { tradingDay: '2026-11-21', bookings } }) }
    }
    if (url.endsWith('/outcome')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: {}, undo: TICKET }) }
    }
    if (url.endsWith('/undo')) {
      return undo.ok
        ? { ok: true, status: 200, json: async () => ({ success: true, booking: { id: OPEN.id, status: 'confirmed' } }) }
        : { ok: false, status: 409, json: async () => ({ error: undo.error }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

beforeEach(() => vi.clearAllMocks())

describe('OpenEarlierBookingsStrip: Undo and staying current', () => {
  it('offers Undo after a no-show, even once the list is empty, and sends the ticket back', async () => {
    const { calls } = installFetch([[OPEN], [], [OPEN]])
    render(<OpenEarlierBookingsStrip canEdit />)
    await screen.findByText('Sam Guest')

    await userEvent.click(screen.getByRole('button', { name: 'No-show' }))

    const undo = await screen.findByRole('button', { name: /^Undo \(\d+\)$/ })
    expect(screen.getByRole('status')).toHaveTextContent('Sam Guest marked as a no-show')
    // The booking has left the list, and the Undo is still there.
    await waitFor(() => expect(screen.queryByText('Still open from earlier')).toBeNull())

    await userEvent.click(undo)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Undone: Sam Guest marked as a no-show'))
    expect(calls.find((call) => call.url.endsWith('/undo'))?.body).toEqual(TICKET)
    // Back on the list after the undo.
    expect(await screen.findByText('Sam Guest')).toBeInTheDocument()
  })

  it('says why when the undo is refused', async () => {
    installFetch([[OPEN], []], { ok: false, error: 'Its table is now booked by TB-NEXT at that time, so this booking cannot be put back. Move one of them first.' })
    render(<OpenEarlierBookingsStrip canEdit />)
    await screen.findByText('Sam Guest')

    await userEvent.click(screen.getByRole('button', { name: 'No-show' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Undo \(\d+\)$/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('TB-NEXT'), expect.anything()))
  })

  it('offers no Undo after Arrived', async () => {
    installFetch([[OPEN], []])
    render(<OpenEarlierBookingsStrip canEdit />)
    await screen.findByText('Sam Guest')

    await userEvent.click(screen.getByRole('button', { name: 'Arrived' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sam Guest marked as arrived'))
    // The fixture answers every outcome with a ticket; only a no-show may use it.
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('reads the list again when its refresh key changes, and drops what has closed', async () => {
    const { fetchMock } = installFetch([[OPEN], []])
    const { rerender } = render(<OpenEarlierBookingsStrip canEdit refreshKey="1" />)
    await screen.findByText('Sam Guest')

    rerender(<OpenEarlierBookingsStrip canEdit refreshKey="2" />)

    await waitFor(() => expect(screen.queryByText('Sam Guest')).toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives its buttons the 44px touch height', async () => {
    installFetch([[OPEN]])
    render(<OpenEarlierBookingsStrip canEdit />)
    await screen.findByText('Sam Guest')

    for (const name of ['Arrived', 'No-show']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-touch')
    }
  })
})
