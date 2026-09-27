// Covers the BOH figures and the sortable table header: one loading state until the first load
// settles (never a row of zeros), the change against the previous period coloured by whether it
// is good news (a rise in no-shows is bad), and the column headers as DS sort buttons.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BohBookingsClient } from '../BohBookingsClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/table-bookings/boh',
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

function todayIso(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value
      return acc
    }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

const TODAY = todayIso()

function makeBooking(id: string, guestName: string, status: string) {
  return {
    id,
    booking_reference: `TB-${id}`,
    booking_date: TODAY,
    booking_time: '18:00:00',
    party_size: 2,
    committed_party_size: null,
    booking_type: 'regular',
    booking_purpose: 'dining',
    status,
    visual_status: status,
    special_requirements: null,
    seated_at: null,
    left_at: null,
    no_show_at: null,
    cancelled_at: null,
    cancelled_by: null,
    hold_expires_at: null,
    payment_status: null,
    payment_method: null,
    deposit_amount: null,
    deposit_amount_locked: null,
    deposit_waived: false,
    high_chair_count: null,
    is_outside_seating: false,
    created_at: null,
    updated_at: null,
    customer: null,
    guest_name: guestName,
    event_id: null,
    event_name: null,
    assigned_tables: [],
    table_names: [],
    assignment_count: 0,
    start_datetime: null,
    end_datetime: null,
  }
}

// This week: three bookings, two of them no-shows. Last week: two bookings, one no-show.
// So bookings rise (good news, green) and no-shows rise (bad news, red).
const CURRENT = [
  makeBooking('1', 'Zara Young', 'confirmed'),
  makeBooking('2', 'Adam Ant', 'no_show'),
  makeBooking('3', 'Mia Moss', 'no_show'),
]
const PREVIOUS = [makeBooking('4', 'Old One', 'confirmed'), makeBooking('5', 'Old Two', 'no_show')]

function listResponse(bookings: ReturnType<typeof makeBooking>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        view: 'week',
        focus_date: TODAY,
        range_start_date: TODAY,
        range_end_date: TODAY,
        total: bookings.length,
        tables: [],
        bookings,
      },
    }),
  }
}

function installFetch(options: { hold?: boolean } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/boh/table-bookings?')) {
      if (options.hold) return new Promise(() => {})
      const date = new URLSearchParams(url.split('?')[1]).get('date')
      return Promise.resolve(listResponse(date === TODAY ? CURRENT : PREVIOUS))
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The Stat whose label is `label`: its card holds the value, the delta and the hint. */
function statFor(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  const stat = labelNode.parentElement
  if (!stat) throw new Error(`No stat for ${label}`)
  return stat
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BohBookingsClient figures and sorting', () => {
  it('is titled Table Bookings with the Back of House tab named in the subtitle', async () => {
    installFetch()
    render(<BohBookingsClient canEdit canManage />)

    // PageLayout renders its header twice (desktop and phone), so every h1 carries the title.
    const titles = screen.getAllByRole('heading', { level: 1 })
    expect(titles.length).toBeGreaterThan(0)
    titles.forEach((title) => expect(title).toHaveTextContent(/^Table Bookings$/))
    // The subtitle is a paragraph ("<Tab>: <purpose>"); the tab of the same name is a link.
    expect(
      screen.getAllByText('Back of House: every booking by day, week or month', { selector: 'p' }).length,
    ).toBeGreaterThan(0)
    await screen.findByText('Total bookings')
  })

  it('shows one loading state, not a row of zeros, before the first load finishes', async () => {
    installFetch({ hold: true })
    const user = userEvent.setup()
    render(<BohBookingsClient canEdit canManage canSendMessages />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading bookings')
    expect(screen.queryByText('Total bookings')).not.toBeInTheDocument()
    expect(screen.queryByText('No bookings for this period')).not.toBeInTheDocument()
    expect(screen.queryByText('No bookings match these filters')).not.toBeInTheDocument()
    // The dialogs live in the page body, which is not mounted yet, so the actions that open them
    // wait for the first load instead of opening a dialog late. Four header actions are more than
    // three, so Message Guests sits in the "More" menu.
    expect(screen.getAllByRole('button', { name: 'Book Table' })[0]).toBeDisabled()
    await user.click(screen.getAllByRole('button', { name: 'More' })[0])
    expect(await screen.findByRole('menuitem', { name: 'Message Guests' })).toBeDisabled()
  })

  it('enables Book Table once the first load has settled', async () => {
    installFetch()
    const user = userEvent.setup()
    render(<BohBookingsClient canEdit canManage canSendMessages />)

    await screen.findByText('Total bookings')
    expect(screen.getAllByRole('button', { name: 'Book Table' })[0]).toBeEnabled()
    await user.click(screen.getAllByRole('button', { name: 'More' })[0])
    expect(await screen.findByRole('menuitem', { name: 'Message Guests' })).toBeEnabled()
  })

  it('shows a change too small for the figure as no change, not a coloured rise', async () => {
    // This week: 24 parties of 2 and one of 3, an average of 2.04, shown as "2.0". Last week: one
    // party of 2, so 2.0. The hint says "0.0", and the arrow must not claim a rise.
    const current = [
      ...Array.from({ length: 24 }, (_, index) => makeBooking(`c${index}`, `Guest ${index}`, 'confirmed')),
      { ...makeBooking('c24', 'Big Table', 'confirmed'), party_size: 3 },
    ]
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/boh/table-bookings?')) {
        const date = new URLSearchParams(url.split('?')[1]).get('date')
        return Promise.resolve(listResponse(date === TODAY ? current : [makeBooking('p1', 'Old One', 'confirmed')]))
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BohBookingsClient canEdit canManage />)

    await screen.findByText('Avg party size')
    const avg = statFor('Avg party size')
    expect(within(avg).getByText('2.0')).toBeInTheDocument()
    const delta = within(avg).getByText('0%', { exact: false })
    expect(delta).toHaveClass('text-text-muted')
    expect(delta).toHaveTextContent('no change')
    expect(within(avg).getByText(/^0\.0 compared with/)).toBeInTheDocument()
  })

  it('colours a rise in bookings as good news and a rise in no-shows as bad news', async () => {
    installFetch()
    render(<BohBookingsClient canEdit canManage />)

    await screen.findByText('Total bookings')

    const bookings = statFor('Total bookings')
    expect(within(bookings).getByText('3')).toBeInTheDocument()
    // 3 against 2 is up 50%, and more bookings is good.
    const bookingsDelta = within(bookings).getByText('50%', { exact: false })
    expect(bookingsDelta).toHaveClass('text-success-fg')
    expect(bookingsDelta).toHaveTextContent('up')
    expect(within(bookings).getByText(/^\+1 compared with/)).toBeInTheDocument()

    const lost = statFor('No-shows + cancellations')
    // 2 against 1 is up 100%, and more no-shows is bad.
    const lostDelta = within(lost).getByText('100%', { exact: false })
    expect(lostDelta).toHaveClass('text-danger-fg')
    expect(lostDelta).toHaveTextContent('up')
  })

  it('shows a coloured absolute change when the previous period had nothing', async () => {
    // Last week was empty, so there is no percentage: the change shows in the figure's own units,
    // still green for more bookings and red for more no-shows.
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/boh/table-bookings?')) {
        const date = new URLSearchParams(url.split('?')[1]).get('date')
        return Promise.resolve(listResponse(date === TODAY ? CURRENT : []))
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BohBookingsClient canEdit canManage />)

    await screen.findByText('Total bookings')

    const bookingsDelta = within(statFor('Total bookings')).getByText('+3', { selector: 'span' })
    expect(bookingsDelta).toHaveClass('text-success-fg')
    expect(bookingsDelta).toHaveTextContent('up')
    expect(bookingsDelta).not.toHaveTextContent('%')

    const lostDelta = within(statFor('No-shows + cancellations')).getByText('+2', { selector: 'span' })
    expect(lostDelta).toHaveClass('text-danger-fg')
    expect(lostDelta).toHaveTextContent('up')
  })

  it('sorts from the DS column header buttons and reports the sort to assistive tech', async () => {
    installFetch()
    const user = userEvent.setup()
    render(<BohBookingsClient canEdit canManage />)

    await screen.findByText('Total bookings')
    const table = screen.getByRole('table')
    const guestHeader = within(table).getByRole('columnheader', { name: /Guest/ })
    const dateHeader = within(table).getByRole('columnheader', { name: /Date\/Time/ })

    expect(dateHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(guestHeader).toHaveAttribute('aria-sort', 'none')

    await user.click(within(guestHeader).getByRole('button', { name: /Guest/ }))

    await waitFor(() => expect(guestHeader).toHaveAttribute('aria-sort', 'ascending'))
    expect(dateHeader).toHaveAttribute('aria-sort', 'none')
    const firstRow = within(table).getAllByRole('row')[1]
    expect(firstRow).toHaveTextContent('Adam Ant')

    await user.click(within(guestHeader).getByRole('button', { name: /Guest/ }))

    await waitFor(() => expect(guestHeader).toHaveAttribute('aria-sort', 'descending'))
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Zara Young')
  })
})
