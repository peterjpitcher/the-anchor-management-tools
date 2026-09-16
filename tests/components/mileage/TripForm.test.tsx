import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MileageTrip } from '@/app/actions/mileage'

const createTrip = vi.fn()
const updateTrip = vi.fn()
const getRatePreviewContext = vi.fn()

vi.mock('@/app/actions/mileage', () => ({
  createTrip: (...args: unknown[]) => createTrip(...args),
  updateTrip: (...args: unknown[]) => updateTrip(...args),
  getDistanceCache: vi.fn().mockResolvedValue({ data: null }),
  getRatePreviewContext: (...args: unknown[]) => getRatePreviewContext(...args),
}))

import { TripForm } from '@/app/(authenticated)/mileage/_components/TripForm'

const DRIVER_ID = '00000000-0000-4000-8000-0000000000a1'
const destinations = [
  { id: 'home', name: 'The Anchor', postcode: 'TW19 6AQ', isHomeBase: true, tripCount: 0, milesFromAnchor: 0 },
  { id: 'shop', name: 'Shop One', postcode: null, isHomeBase: false, tripCount: 0, milesFromAnchor: 1.7 },
  { id: 'venue', name: 'Far Venue', postcode: null, isHomeBase: false, tripCount: 0, milesFromAnchor: 194 },
]
const drivers = [{ id: DRIVER_ID, displayName: 'Driver A', drivesOjProjects: true }]

function trip(overrides: Partial<MileageTrip> = {}): MileageTrip {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    tripDate: '2026-04-04',
    description: 'Shop One',
    totalMiles: 3.4,
    milesAtStandardRate: 3.4,
    milesAtReducedRate: 0,
    amountDue: 1.53,
    source: 'manual',
    createdAt: '2026-04-04T10:00:00Z',
    routeSummary: 'The Anchor to Shop One and back',
    driverId: DRIVER_ID,
    driverName: 'Driver A',
    driverBasis: 'owner_statement',
    updatedAt: '2026-09-15T15:08:08.431218+00:00',
    legs: [
      { id: 'l1', legOrder: 1, fromDestinationId: 'home', fromDestinationName: 'The Anchor', toDestinationId: 'shop', toDestinationName: 'Shop One', miles: 1.7 },
      { id: 'l2', legOrder: 2, fromDestinationId: 'shop', fromDestinationName: 'Shop One', toDestinationId: 'home', toDestinationName: 'The Anchor', miles: 1.7 },
    ],
    ...overrides,
  }
}

function renderForm(editingTrip: MileageTrip | null) {
  return render(
    <TripForm open onClose={vi.fn()} onSuccess={vi.fn()} destinations={destinations} drivers={drivers} editingTrip={editingTrip} />
  )
}

describe('TripForm', () => {
  beforeEach(() => {
    createTrip.mockReset()
    updateTrip.mockReset().mockResolvedValue({ success: true })
    getRatePreviewContext.mockReset().mockResolvedValue({ data: { cumulativeMilesBefore: 0 } })
  })

  it('asks who drove before saving a new trip', async () => {
    renderForm(null)
    await userEvent.click(screen.getByRole('button', { name: 'Save Trip' }))
    expect(await screen.findByText('Choose who drove.')).toBeInTheDocument()
    expect(createTrip).not.toHaveBeenCalled()
  })

  it('asks who drove when editing a trip that has no driver yet', async () => {
    renderForm(trip({ driverId: null, driverName: null, driverBasis: null }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByText('Choose who drove.')).toBeInTheDocument()
    expect(updateTrip).not.toHaveBeenCalled()
  })

  it('sends the loaded updated_at unchanged when editing', async () => {
    renderForm(trip())
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(updateTrip).toHaveBeenCalledWith(
        expect.objectContaining({ expectedUpdatedAt: '2026-09-15T15:08:08.431218+00:00', driverId: DRIVER_ID })
      )
    )
  })

  it('previews the rate from the chosen driver\'s miles', async () => {
    renderForm(trip())
    await waitFor(() =>
      expect(getRatePreviewContext).toHaveBeenCalledWith({
        tripDate: '2026-04-04',
        driverId: DRIVER_ID,
        excludeTripId: '00000000-0000-4000-8000-000000000101',
      })
    )
  })

  it('reuses the same request id when a failed save is tried again', async () => {
    createTrip.mockResolvedValue({ error: 'Failed to save the trip. Nothing was changed. Try again.' })
    const user = userEvent.setup()
    renderForm(null)

    await user.selectOptions(screen.getByLabelText(/Who drove/), DRIVER_ID)
    await user.type(screen.getByLabelText(/Reason for trip/), 'Collect wholesale order')
    await user.selectOptions(screen.getByLabelText('Stop 1 destination'), 'shop')
    await user.type(screen.getByLabelText('Miles from The Anchor to Shop One'), '1.7')
    await user.type(screen.getByLabelText('Return miles'), '1.7')

    await user.click(screen.getByRole('button', { name: 'Save Trip' }))
    expect(await screen.findByText('Failed to save the trip. Nothing was changed. Try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save Trip' }))

    await waitFor(() => expect(createTrip).toHaveBeenCalledTimes(2))
    const [first] = createTrip.mock.calls[0] as [{ requestId: string; driverId: string; description: string }]
    const [second] = createTrip.mock.calls[1] as [{ requestId: string }]
    expect(first).toMatchObject({ driverId: DRIVER_ID, description: 'Collect wholesale order' })
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.requestId).toBe(first.requestId)
  })

  it('locks a one-way trip instead of turning it into a round trip', () => {
    renderForm(
      trip({
        legs: [
          { id: 'l1', legOrder: 1, fromDestinationId: 'home', fromDestinationName: 'The Anchor', toDestinationId: 'venue', toDestinationName: 'Far Venue', miles: 194 },
        ],
      })
    )
    expect(screen.getByText("This trip can't be edited here yet")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })
})
