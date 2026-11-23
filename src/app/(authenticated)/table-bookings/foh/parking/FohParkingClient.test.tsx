// Parking for the till (owner request, 23 November 2026): the lists, the search, the "Not paid"
// marker, and above all no price anywhere on the page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FohParkingBooking, FohParkingView } from '@/lib/foh/parking-view'
import { FohParkingClient } from './FohParkingClient'

function car(overrides: Partial<FohParkingBooking> = {}): FohParkingBooking {
  return {
    reference: 'PK-1001',
    guest_name: 'Asha Patel',
    phone: '+447700900111',
    vehicle_registration: 'AB12 CDE',
    vehicle_make: 'Ford',
    vehicle_model: 'Focus',
    vehicle_colour: 'Blue',
    // Friday 10 July 2026, British Summer Time: 2pm London.
    arrives_at: '2026-07-10T13:00:00.000Z',
    leaves_at: '2026-07-14T09:00:00.000Z',
    status: 'confirmed',
    paid: true,
    ...overrides,
  }
}

const VIEW: FohParkingView = {
  today: '2026-07-10',
  arriving_today: [
    car(),
    car({ reference: 'PK-1002', guest_name: 'Ben Okafor', vehicle_registration: 'XY65 ZZZ', status: 'pending_payment', paid: false, phone: null, vehicle_make: null, vehicle_model: null, vehicle_colour: null }),
  ],
  on_site_now: [car({ reference: 'PK-0990', guest_name: 'Carla Diaz', vehicle_registration: 'LM20 ABC', arrives_at: '2026-07-08T08:00:00.000Z', leaves_at: '2026-07-10T17:30:00.000Z' })],
  leaving_today: [car({ reference: 'PK-0990', guest_name: 'Carla Diaz', vehicle_registration: 'LM20 ABC', arrives_at: '2026-07-08T08:00:00.000Z', leaves_at: '2026-07-10T17:30:00.000Z' })],
  coming_up: [
    { date: '2026-07-13', bookings: [car({ reference: 'PK-1010', guest_name: 'Dev Shah', vehicle_registration: 'GH71 KLM', arrives_at: '2026-07-13T07:00:00.000Z', leaves_at: '2026-07-20T07:00:00.000Z' })] },
  ],
}

function installFetch(answer: { ok: boolean; body: unknown }) {
  const fetchMock = vi.fn(async () => ({ ok: answer.ok, status: answer.ok ? 200 : 500, json: async () => answer.body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const list = (name: string) => screen.getByRole('list', { name })

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('FohParkingClient', () => {
  it('reads the till parking route and shows the three lists for today', async () => {
    const fetchMock = installFetch({ ok: true, body: { success: true, data: VIEW } })
    render(<FohParkingClient />)

    expect(await screen.findByText('Asha Patel')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/foh/parking', { cache: 'no-store' })

    const arriving = list('Arriving today')
    expect(within(arriving).getByText('AB12 CDE')).toBeInTheDocument()
    expect(within(arriving).getByText('XY65 ZZZ')).toBeInTheDocument()
    // London time, 12 hour; a day is only named when it is not the list's own.
    expect(within(arriving).getByText(/Arrives 2pm · Leaves 10am Tue 14 Jul · Blue Ford Focus · PK-1001/)).toBeInTheDocument()

    expect(within(list('On site now')).getByText('LM20 ABC')).toBeInTheDocument()
    expect(within(list('Leaving today')).getByText(/Arrives 9am Wed 8 Jul · Leaves 6:30pm · /)).toBeInTheDocument()
  })

  it('groups what is coming up by date', async () => {
    installFetch({ ok: true, body: { success: true, data: VIEW } })
    render(<FohParkingClient />)

    const day = await screen.findByRole('region', { name: 'Monday 13 July' })
    expect(within(day).getByText('GH71 KLM')).toBeInTheDocument()
    expect(within(day).getByText(/Arrives 8am · Leaves 8am Mon 20 Jul/)).toBeInTheDocument()
  })

  it('marks a booking that is not paid, and says nothing about one that is', async () => {
    installFetch({ ok: true, body: { success: true, data: VIEW } })
    render(<FohParkingClient />)
    await screen.findByText('Ben Okafor')

    const rows = within(list('Arriving today')).getAllByRole('listitem')
    expect(within(rows[0]).queryByText('Not paid')).toBeNull()
    expect(within(rows[1]).getByText('Not paid')).toBeInTheDocument()
  })

  it('shows no price, amount or pound sign anywhere', async () => {
    installFetch({ ok: true, body: { success: true, data: VIEW } })
    const { container } = render(<FohParkingClient />)
    await screen.findByText('Asha Patel')

    const text = container.textContent ?? ''
    expect(text).not.toMatch(/£|\bprice|\bamount|\brate\b|\btotal|\bfee\b|refund|discount|\bcost/i)
    expect(text).not.toMatch(/\d+\.\d{2}/)
  })

  it('filters every list by registration, with or without the space, or by name', async () => {
    installFetch({ ok: true, body: { success: true, data: VIEW } })
    render(<FohParkingClient />)
    await screen.findByText('Asha Patel')
    const search = screen.getByRole('textbox', { name: 'Find a car by registration or name' })

    await userEvent.type(search, 'xy65zzz')
    expect(within(list('Arriving today')).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Ben Okafor')).toBeInTheDocument()
    expect(screen.queryByText('Asha Patel')).toBeNull()
    expect(screen.getByText('No car on site matches.')).toBeInTheDocument()
    expect(screen.getByText('No car coming up matches.')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'dev')
    expect(screen.getByText('Dev Shah')).toBeInTheDocument()
    expect(screen.getByText('No car arriving today matches.')).toBeInTheDocument()
  })

  it('has an empty state for each list', async () => {
    installFetch({
      ok: true,
      body: { success: true, data: { today: '2026-07-10', arriving_today: [], on_site_now: [], leaving_today: [], coming_up: [] } },
    })
    render(<FohParkingClient />)

    expect(await screen.findByText('No cars are due to arrive today.')).toBeInTheDocument()
    expect(screen.getByText('No booked cars are on site at the moment.')).toBeInTheDocument()
    expect(screen.getByText('No cars are due to leave today.')).toBeInTheDocument()
    expect(screen.getByText('No parking is booked for the next 14 days.')).toBeInTheDocument()
  })

  it('is read only: a way back, a refresh and a phone link, and nothing that changes a booking', async () => {
    installFetch({ ok: true, body: { success: true, data: VIEW } })
    render(<FohParkingClient />)
    await screen.findByText('Asha Patel')

    expect(screen.getByRole('link', { name: 'Back to Front of House' })).toHaveAttribute('href', '/table-bookings/foh')
    expect(screen.getAllByRole('link', { name: '+447700900111' })[0]).toHaveAttribute('href', 'tel:+447700900111')
    const buttons = screen.getAllByRole('button').map((button) => button.textContent || button.getAttribute('aria-label'))
    expect(buttons.filter((name) => name !== 'Refresh' && name !== 'Clear search')).toEqual([])
  })

  it('says so when parking cannot be loaded', async () => {
    installFetch({ ok: false, body: { error: 'Parking could not be loaded.' } })
    render(<FohParkingClient />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Parking could not be loaded.'))
  })
})
