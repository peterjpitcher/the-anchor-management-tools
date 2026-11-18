import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

/**
 * The parking page answers its three permission checks from the cached permission list
 * (PermissionService) instead of three serial user_has_permission RPCs, and loads the first
 * bookings list and the rate row on the server. These tests drive the page function and read the
 * props it hands the client.
 */

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  })
)
const getUserMock = vi.hoisted(() => vi.fn())
const rpcMock = vi.hoisted(() => vi.fn())
const getPermissionStatusMock = vi.hoisted(() => vi.fn())
const listParkingBookingsMock = vi.hoisted(() => vi.fn())
const getParkingRateSettingsMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ redirect: redirectMock }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock }, rpc: rpcMock })),
}))

vi.mock('@/services/permission', () => ({
  PermissionService: { getPermissionStatus: getPermissionStatusMock },
}))

vi.mock('@/app/actions/parking', () => ({
  listParkingBookings: listParkingBookingsMock,
  getParkingRateSettings: getParkingRateSettingsMock,
}))

vi.mock('@/app/(authenticated)/parking/_components/ParkingClient', () => ({
  default: () => null,
}))

import ParkingPage from '@/app/(authenticated)/parking/page'

type Status = 'allowed' | 'denied' | 'unavailable'

function grant(statuses: { view: Status; manage: Status; refund: Status }) {
  getPermissionStatusMock.mockImplementation(async (_module: string, action: 'view' | 'manage' | 'refund') => statuses[action])
}

const RATE = {
  id: 'rate-1',
  effective_from: '2026-01-01T00:00:00Z',
  hourly_rate: 2.5,
  daily_rate: 15,
  weekly_rate: 75,
  monthly_rate: 265,
}

async function renderPage() {
  const element = (await ParkingPage()) as ReactElement<Record<string, unknown>>
  return element.props
}

describe('parking page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    listParkingBookingsMock.mockResolvedValue({ success: true, data: [{ id: 'pk-1' }] })
    getParkingRateSettingsMock.mockResolvedValue({ success: true, data: RATE })
  })

  it('asks the cached permission list for parking view, manage and refund, never the RPC', async () => {
    grant({ view: 'allowed', manage: 'allowed', refund: 'allowed' })

    await renderPage()

    expect(getPermissionStatusMock).toHaveBeenCalledWith('parking', 'view', 'user-1')
    expect(getPermissionStatusMock).toHaveBeenCalledWith('parking', 'manage', 'user-1')
    expect(getPermissionStatusMock).toHaveBeenCalledWith('parking', 'refund', 'user-1')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  // The same outcomes the three user_has_permission calls gave: true maps to allowed, false to
  // denied, and an RPC error to unavailable.
  it.each([
    {
      name: 'a manager with refunds',
      statuses: { view: 'allowed', manage: 'allowed', refund: 'allowed' } as const,
      permissions: { canCreate: true, canManage: true, canRefund: true },
      initialError: null,
    },
    {
      name: 'a viewer only',
      statuses: { view: 'allowed', manage: 'denied', refund: 'denied' } as const,
      permissions: { canCreate: false, canManage: false, canRefund: false },
      initialError: null,
    },
    {
      name: 'a failed manage lookup',
      statuses: { view: 'allowed', manage: 'unavailable', refund: 'allowed' } as const,
      permissions: { canCreate: false, canManage: false, canRefund: true },
      initialError: 'We could not confirm manage permissions; booking creation is currently disabled.',
    },
    {
      name: 'a failed view and refund lookup',
      statuses: { view: 'unavailable', manage: 'denied', refund: 'unavailable' } as const,
      permissions: { canCreate: false, canManage: false, canRefund: false },
      initialError:
        'We could not verify your parking access. Some functionality might be limited. Refund actions may be temporarily unavailable.',
    },
  ])('gives the same permissions as before for $name', async ({ statuses, permissions, initialError }) => {
    grant(statuses)

    const props = await renderPage()

    expect(props.permissions).toEqual(permissions)
    expect(props.initialError).toBe(initialError)
  })

  it('sends a user without parking view to the unauthorised page and loads nothing', async () => {
    grant({ view: 'denied', manage: 'denied', refund: 'denied' })

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/unauthorized')
    expect(listParkingBookingsMock).not.toHaveBeenCalled()
    expect(getParkingRateSettingsMock).not.toHaveBeenCalled()
  })

  it('sends a signed-out visitor to the login page', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(getPermissionStatusMock).not.toHaveBeenCalled()
  })

  it('passes the first bookings list and the rate row to a manager', async () => {
    grant({ view: 'allowed', manage: 'allowed', refund: 'denied' })

    const props = await renderPage()

    expect(listParkingBookingsMock).toHaveBeenCalledTimes(1)
    expect(props.initialBookings).toEqual({ data: [{ id: 'pk-1' }] })
    expect(props.initialRates).toEqual({ data: RATE })
  })

  it('does not read the rate row for someone who cannot manage parking', async () => {
    grant({ view: 'allowed', manage: 'denied', refund: 'denied' })

    const props = await renderPage()

    expect(getParkingRateSettingsMock).not.toHaveBeenCalled()
    expect(props.initialRates).toBeNull()
  })

  it('passes a failed load through as a failure, not as an empty list', async () => {
    grant({ view: 'allowed', manage: 'allowed', refund: 'denied' })
    listParkingBookingsMock.mockResolvedValue({ error: 'Failed to load parking bookings' })
    getParkingRateSettingsMock.mockResolvedValue({ error: 'Parking rates have not been configured' })

    const props = await renderPage()

    expect(props.initialBookings).toEqual({ error: 'Failed to load parking bookings' })
    expect(props.initialRates).toEqual({ error: 'Parking rates have not been configured' })
  })
})
