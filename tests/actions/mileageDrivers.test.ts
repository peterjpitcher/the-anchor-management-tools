import { beforeEach, describe, expect, it, vi } from 'vitest'

const order = vi.fn()
const eq = vi.fn(() => ({ order }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))
const checkUserPermission = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from })),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: (...args: unknown[]) => checkUserPermission(...args),
}))

import { getMileageDrivers } from '@/app/actions/mileage-drivers'

describe('getMileageDrivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkUserPermission.mockResolvedValue(true)
  })

  it('returns active drivers in name order', async () => {
    order.mockResolvedValue({
      data: [{ id: 'd1', display_name: 'Driver A', drives_oj_projects: true }],
      error: null,
    })

    await expect(getMileageDrivers()).resolves.toEqual({
      success: true,
      data: [{ id: 'd1', displayName: 'Driver A', drivesOjProjects: true }],
    })
    expect(from).toHaveBeenCalledWith('mileage_drivers')
    expect(eq).toHaveBeenCalledWith('is_active', true)
    expect(order).toHaveBeenCalledWith('display_name')
  })

  it('returns an error when the query fails', async () => {
    order.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom', details: null, hint: null } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getMileageDrivers()).resolves.toEqual({ error: 'Failed to load drivers' })
    consoleError.mockRestore()
  })

  it('checks the mileage permission before reading anything', async () => {
    checkUserPermission.mockResolvedValue(false)

    await expect(getMileageDrivers()).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(checkUserPermission).toHaveBeenCalledWith('mileage', 'view')
    expect(from).not.toHaveBeenCalled()
  })
})
