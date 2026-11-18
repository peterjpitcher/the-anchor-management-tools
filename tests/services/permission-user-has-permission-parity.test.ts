import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// Pages moving from the user_has_permission RPC to the cached permission list (the parking page
// first) must get the same answers. The RPC (live definition read 18 November 2026) returns true
// for any super_admin, otherwise true only when one of the user's roles holds that module and
// action. These cases replay that rule against PermissionService.getPermissionStatus.

const cacheStore = new Map<string, unknown>()
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = keyParts.join(':')
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

function userWith(roles: string[], permissions: Array<{ module_name: string; action: string }>) {
  mockedCreateAdminClient.mockReturnValue({
    rpc: vi.fn(async (name: string) => {
      if (name === 'get_user_roles') {
        return { data: roles.map((role_name, i) => ({ role_id: `r${i}`, role_name })), error: null }
      }
      if (name === 'get_user_permissions') return { data: permissions, error: null }
      return { data: null, error: { message: `unexpected rpc ${name}` } }
    }),
  })
}

describe('PermissionService matches user_has_permission for parking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheStore.clear()
  })

  it('grants a super_admin every parking action even with no permission rows', async () => {
    userWith(['super_admin'], [])
    for (const action of ['view', 'manage', 'refund'] as const) {
      await expect(PermissionService.getPermissionStatus('parking', action, 'u1')).resolves.toBe('allowed')
    }
  })

  it('grants exactly the module and action rows a non super admin holds', async () => {
    userWith(['manager'], [
      { module_name: 'parking', action: 'view' },
      { module_name: 'parking', action: 'manage' },
      { module_name: 'events', action: 'refund' },
    ])
    await expect(PermissionService.getPermissionStatus('parking', 'view', 'u2')).resolves.toBe('allowed')
    await expect(PermissionService.getPermissionStatus('parking', 'manage', 'u2')).resolves.toBe('allowed')
    // Refund on another module is not refund on parking.
    await expect(PermissionService.getPermissionStatus('parking', 'refund', 'u2')).resolves.toBe('denied')
  })

  it('denies a user with no roles', async () => {
    userWith([], [])
    await expect(PermissionService.getPermissionStatus('parking', 'view', 'u3')).resolves.toBe('denied')
  })
})
