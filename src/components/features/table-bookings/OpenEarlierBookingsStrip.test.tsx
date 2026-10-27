// BK-130: the FOH and BOH 'Still open from earlier' strip lists earlier bookings nobody marked,
// with one-tap Arrived and No-show, and shows nothing when there is nothing to mark.

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
  bookingDate: '2026-10-24',
  bookingTime: '18:00:00',
  partySize: 4,
  guestName: 'Sam Guest',
}

function installFetch(lists: Array<typeof OPEN[]>, outcome: { ok: boolean; error?: string } = { ok: true }) {
  let listCall = 0
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/foh/bookings/open-earlier') {
      const bookings = lists[Math.min(listCall, lists.length - 1)]
      listCall += 1
      return { ok: true, status: 200, json: async () => ({ success: true, data: { tradingDay: '2026-10-26', bookings } }) }
    }
    if (url.endsWith('/outcome') && init?.method === 'POST') {
      return outcome.ok
        ? { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
        : { ok: false, status: 409, json: async () => ({ error: outcome.error }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OpenEarlierBookingsStrip', () => {
  it('shows nothing when no earlier booking is open', async () => {
    const fetchMock = installFetch([[]])
    const { container } = render(<OpenEarlierBookingsStrip canEdit />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('lists an open booking and marks it as arrived, then drops it from the list', async () => {
    const fetchMock = installFetch([[OPEN], []])
    render(<OpenEarlierBookingsStrip canEdit />)
    expect(await screen.findByText('Sam Guest')).toBeInTheDocument()
    expect(screen.getByText('Still open from earlier')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Arrived' }))

    await waitFor(() => expect(screen.queryByText('Sam Guest')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(`/api/foh/bookings/${OPEN.id}/outcome`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ outcome: 'arrived' }),
    }))
    expect(toast.success).toHaveBeenCalledWith('Sam Guest marked as arrived')
  })

  it('shows the refusal when the outcome cannot be recorded', async () => {
    installFetch([[OPEN]], { ok: false, error: 'This booking already has an outcome.' })
    render(<OpenEarlierBookingsStrip canEdit />)
    await userEvent.click(await screen.findByRole('button', { name: 'No-show' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This booking already has an outcome.'))
  })

  it('offers no buttons without edit permission', async () => {
    installFetch([[OPEN]])
    render(<OpenEarlierBookingsStrip canEdit={false} />)
    expect(await screen.findByText('Sam Guest')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrived' })).not.toBeInTheDocument()
  })
})
