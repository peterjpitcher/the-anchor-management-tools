import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// A tiny stand-in for unstable_cache that keeps a value only when the function resolves, which
// is how Next.js treats a thrown error: nothing is stored (BK-095).
const cacheStore = new Map<string, unknown>()
const cacheOptions = new Map<string, { revalidate?: number; tags?: string[] }>()
vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    keyParts: string[],
    options?: { revalidate?: number; tags?: string[] }
  ) => async () => {
    const key = keyParts.join(':')
    if (options) cacheOptions.set(key, options)
    if (cacheStore.has(key)) return cacheStore.get(key)
    const value = await fn()
    cacheStore.set(key, value)
    return value
  },
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { PermissionService } from '@/services/permission'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

function adminWith(rpc: Mock) {
  mockedCreateAdminClient.mockReturnValue({ rpc })
}

const blip = { data: null, error: { message: 'TypeError: fetch failed' } }

describe('PermissionService when the permission lookup fails (BK-095)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheStore.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('answers unavailable, not denied, and caches nothing', async () => {
    const rpc = vi.fn().mockResolvedValue(blip)
    adminWith(rpc)

    await expect(
      PermissionService.getPermissionStatus('table_bookings', 'view', 'user-1')
    ).resolves.toBe('unavailable')
    expect(cacheStore.size).toBe(0)
    // Each lookup is retried once before giving up.
    expect(rpc.mock.calls.filter(([name]) => name === 'get_user_permissions')).toHaveLength(2)
  })

  it('fails closed for boolean callers', async () => {
    adminWith(vi.fn().mockResolvedValue(blip))
    await expect(
      PermissionService.checkUserPermission('table_bookings', 'view', 'user-1')
    ).resolves.toBe(false)
  })

  it('recovers on the next request once the network is back', async () => {
    let failing = true
    const rpc = vi.fn(async (name: string) => {
      if (failing) return blip
      if (name === 'get_user_roles') return { data: [{ role_name: 'staff' }], error: null }
      return { data: [{ module_name: 'table_bookings', action: 'view' }], error: null }
    })
    adminWith(rpc)

    await expect(
      PermissionService.getPermissionStatus('table_bookings', 'view', 'user-1')
    ).resolves.toBe('unavailable')

    failing = false
    await expect(
      PermissionService.getPermissionStatus('table_bookings', 'view', 'user-1')
    ).resolves.toBe('allowed')
  })

  it('succeeds when the retry works', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(blip) // roles, first try
      .mockResolvedValueOnce({ data: [], error: null }) // roles, retry
      .mockResolvedValueOnce({ data: [{ module_name: 'table_bookings', action: 'view' }], error: null })
    adminWith(rpc)

    await expect(
      PermissionService.getPermissionStatus('table_bookings', 'view', 'user-1')
    ).resolves.toBe('allowed')
  })

  it('still answers a real no as denied', async () => {
    adminWith(
      vi.fn(async (name: string) =>
        name === 'get_user_roles'
          ? { data: [{ role_name: 'staff' }], error: null }
          : { data: [{ module_name: 'events', action: 'view' }], error: null }
      )
    )
    await expect(
      PermissionService.getPermissionStatus('table_bookings', 'view', 'user-1')
    ).resolves.toBe('denied')
  })
})

describe('PermissionService.getRoleNames (S2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheStore.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns the role names from get_user_roles and caches them under their own key', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ role_id: 'a', role_name: 'manager' }, { role_id: 'b', role_name: 'super_admin' }],
      error: null,
    })
    adminWith(rpc)

    await expect(PermissionService.getRoleNames('user-1')).resolves.toEqual(['manager', 'super_admin'])
    await expect(PermissionService.getRoleNames('user-1')).resolves.toEqual(['manager', 'super_admin'])
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_user_roles', { p_user_id: 'user-1' })
    expect([...cacheStore.keys()]).toEqual(['user-role-names:user-1'])
    // Same window and tag as the other permission caches, so a role change clears it.
    expect(cacheOptions.get('user-role-names:user-1')).toEqual({ revalidate: 60, tags: ['permissions-user-1'] })
  })

  it('throws on a failed lookup and caches nothing', async () => {
    adminWith(vi.fn().mockResolvedValue(blip))
    await expect(PermissionService.getRoleNames('user-1')).rejects.toThrow('Could not check permissions')
    expect(cacheStore.size).toBe(0)
  })
})

describe('PermissionService.isSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheStore.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('answers true only for the super_admin role and caches the answer for 60 seconds', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ role_id: 'a', role_name: 'manager' }, { role_id: 'b', role_name: 'super_admin' }],
      error: null,
    })
    adminWith(rpc)

    await expect(PermissionService.isSuperAdmin('user-1')).resolves.toBe(true)
    await expect(PermissionService.isSuperAdmin('user-1')).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_user_roles', { p_user_id: 'user-1' })
    expect(cacheOptions.get('user-is-super-admin:user-1')).toEqual({ revalidate: 60, tags: ['permissions-user-1'] })
  })

  it('answers false for a user without the role', async () => {
    adminWith(vi.fn().mockResolvedValue({ data: [{ role_id: 'a', role_name: 'manager' }], error: null }))
    await expect(PermissionService.isSuperAdmin('user-2')).resolves.toBe(false)
  })

  it('throws on a failed lookup and never caches false', async () => {
    const rpc = vi.fn().mockResolvedValue(blip)
    adminWith(rpc)
    await expect(PermissionService.isSuperAdmin('user-1')).rejects.toThrow('Could not check permissions')
    expect(cacheStore.size).toBe(0)

    rpc.mockResolvedValue({ data: [{ role_id: 'b', role_name: 'super_admin' }], error: null })
    await expect(PermissionService.isSuperAdmin('user-1')).resolves.toBe(true)
  })
})
