import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDestinationsMock = vi.hoisted(() => vi.fn())
const getDistanceEntriesMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/mileage/destinations',
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/mileage', () => ({
  getDestinations: getDestinationsMock,
  getDistanceEntries: getDistanceEntriesMock,
  createDestination: vi.fn(),
  updateDestination: vi.fn(),
  deleteDestination: vi.fn(),
  upsertDistanceCache: vi.fn(),
  deleteDistanceCache: vi.fn(),
}))

import MileageDestinationsPage from '@/app/(authenticated)/mileage/destinations/page'
import { DestinationsClient } from '@/app/(authenticated)/mileage/_components/DestinationsClient'

const HOME = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'The Anchor',
  postcode: 'TW19 6AQ',
  isHomeBase: true,
  tripCount: 3,
  milesFromAnchor: 0,
}
const SHOP = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Cash and Carry',
  postcode: null,
  isHomeBase: false,
  tripCount: 3,
  milesFromAnchor: 4.2,
}

const MOVE_HINT = /If this place has moved, add it as a new destination instead/

describe('MileageDestinationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDestinationsMock.mockResolvedValue({ success: true, data: [HOME, SHOP] })
    getDistanceEntriesMock.mockResolvedValue({ success: true, data: [] })
  })

  it('shows an error instead of an empty list when destinations fail to load', async () => {
    getDestinationsMock.mockResolvedValue({ error: 'mileage trip legs failed: timeout' })

    render(await MileageDestinationsPage())

    expect(screen.getByText("Couldn't load destinations")).toBeInTheDocument()
    expect(screen.getByText('mileage trip legs failed: timeout')).toBeInTheDocument()
    expect(screen.queryByText('Cash and Carry')).not.toBeInTheDocument()
  })

  it('shows an error when saved distances fail to load', async () => {
    getDistanceEntriesMock.mockResolvedValue({ error: 'mileage destination distances failed: timeout' })

    render(await MileageDestinationsPage())

    expect(screen.getByText("Couldn't load destinations")).toBeInTheDocument()
    expect(screen.getByText('mileage destination distances failed: timeout')).toBeInTheDocument()
  })
})

describe('DestinationsClient', () => {
  it('labels the count as trips, not trip legs', () => {
    render(<DestinationsClient initialDestinations={[HOME, SHOP]} initialDistances={[]} canManage />)

    expect(screen.getAllByText('Trips').length).toBeGreaterThan(0)
    expect(screen.queryByText('Trip Legs')).not.toBeInTheDocument()
  })

  it('tells staff to add a new destination when a place has moved, only when editing', () => {
    render(<DestinationsClient initialDestinations={[HOME, SHOP]} initialDistances={[]} canManage />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Destination' })[0])
    expect(screen.queryByText(MOVE_HINT)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Cash and Carry' })[0])
    expect(screen.getByText(MOVE_HINT)).toBeInTheDocument()
  })
})
