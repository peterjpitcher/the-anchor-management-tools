import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserPermission } from '@/types/rbac'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUserPermissions: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/api/permissions', () => ({
  requireModulePermission: vi.fn(async () => ({
    ok: true,
    userId: 'user-1',
    supabase: { rpc: mocks.rpc },
  })),
}))
vi.mock('@/services/permission', () => ({
  PermissionService: { getUserPermissions: mocks.getUserPermissions },
}))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'

function perms(...pairs: Array<[string, string]>): UserPermission[] {
  return pairs.map(([module_name, action]) => ({ module_name, action }) as UserPermission)
}

describe('requireBohTableBookingPermission (BK-205)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses with 503 and logs when the permission lookup fails', async () => {
    mocks.getUserPermissions.mockRejectedValue(new Error('fetch failed'))

    const result = await requireBohTableBookingPermission('edit')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(503)
    }
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
  })

  it('still lets a normal BOH user through', async () => {
    mocks.getUserPermissions.mockResolvedValue(perms(['table_bookings', 'edit'], ['events', 'view']))
    const result = await requireBohTableBookingPermission('edit')
    expect(result.ok).toBe(true)
  })

  it('reads the cached per-user list, not an uncached RPC', async () => {
    mocks.getUserPermissions.mockResolvedValue(perms(['table_bookings', 'view'], ['events', 'view']))
    await requireBohTableBookingPermission('view')
    expect(mocks.getUserPermissions).toHaveBeenCalledWith('user-1')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  // Parity with the old RPC read: the same lists give the same answers.
  it.each([
    ['the FOH-only kiosk login', perms(['table_bookings', 'view'], ['checklists', 'view'], ['vouchers', 'view']), 403],
    ['a table_bookings-only viewer', perms(['table_bookings', 'view']), 403],
    ['a manager with other modules', perms(['table_bookings', 'view'], ['table_bookings', 'manage'], ['rota', 'view']), 200],
    ['a user with no listed rows (super admin by role)', perms(), 200],
    ['a user without table_bookings view in the list', perms(['table_bookings', 'edit'], ['checklists', 'view']), 200],
  ])('gives %s the same answer as before', async (_label, list, expected) => {
    mocks.getUserPermissions.mockResolvedValue(list)
    const result = await requireBohTableBookingPermission('view')
    if (expected === 200) {
      expect(result.ok).toBe(true)
    } else {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(expected)
    }
  })
})
