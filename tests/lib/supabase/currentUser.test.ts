import { beforeEach, describe, expect, it, vi } from 'vitest'

// S1 (page load spec, 18 November 2026): every rbac helper takes the signed-in user from the
// shared getCurrentUser(), which React `cache` shares across one server render.
//
// What this file can and cannot prove: under Vitest, `react` resolves to its client build, where
// `cache` is a plain pass-through (it only memoises inside a react-server render with a request
// dispatcher). So the one-lookup-per-render saving can only be confirmed live, by counting
// /auth/v1/user calls in the Supabase edge logs. What is proved here is that the rbac helpers go
// through getCurrentUser and never make their own auth call, and that every answer and error path
// is unchanged.

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(() => {
    throw new Error('rbac must not create its own client for the auth lookup')
  }),
  checkUserPermission: vi.fn(),
  getPermissionStatus: vi.fn(),
  getUserPermissions: vi.fn(),
  getUserRoles: vi.fn(),
}))

vi.mock('@/lib/supabase/current-user', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/services/permission', () => ({
  roleSchema: { safeParse: vi.fn() },
  PermissionService: {
    checkUserPermission: mocks.checkUserPermission,
    getPermissionStatus: mocks.getPermissionStatus,
    getUserPermissions: mocks.getUserPermissions,
    getUserRoles: mocks.getUserRoles,
    getAllRoles: vi.fn().mockResolvedValue([]),
  },
}))

import {
  checkUserPermission,
  getAllRoles,
  getCurrentUserModuleActions,
  getPermissionStatus,
  getUserPermissions,
  getUserRoles,
} from '@/app/actions/rbac'

const user = { id: 'user-1', email: 'staff@example.com' }

describe('rbac helpers take the user from getCurrentUser (S1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue({ user, error: null })
    mocks.checkUserPermission.mockResolvedValue(true)
    mocks.getPermissionStatus.mockResolvedValue('allowed')
    mocks.getUserPermissions.mockResolvedValue([
      { module_name: 'events', action: 'view' },
      { module_name: 'events', action: 'view' },
      { module_name: 'rota', action: 'edit' },
    ])
    mocks.getUserRoles.mockResolvedValue([{ id: 'r1', name: 'staff' }])
  })

  it('makes no auth call of its own in any helper', async () => {
    await checkUserPermission('events', 'view')
    await checkUserPermission('events', 'edit')
    await checkUserPermission('rota', 'view')
    await getPermissionStatus('events', 'view')
    await getUserPermissions()
    await getCurrentUserModuleActions('events')
    await getUserRoles()
    await getAllRoles() // via requirePermission

    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(8)
    expect(mocks.createClient).not.toHaveBeenCalled()
    for (const call of mocks.checkUserPermission.mock.calls) {
      expect(call[2]).toBe('user-1')
    }
  })

  it('skips the lookup entirely when the caller passes the user id', async () => {
    await checkUserPermission('events', 'view', 'user-2')
    await getPermissionStatus('events', 'view', 'user-2')
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })

  it('keeps every signed-out answer as it was', async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: null, error: null })

    await expect(checkUserPermission('events', 'view')).resolves.toBe(false)
    await expect(getUserPermissions()).resolves.toEqual({ error: 'Not authenticated' })
    await expect(getCurrentUserModuleActions('events')).resolves.toEqual({ error: 'Not authenticated' })
    await expect(getUserRoles()).resolves.toEqual({ error: 'Not authenticated' })
    await expect(getAllRoles()).resolves.toEqual({ error: 'Not authenticated' })
    expect(mocks.checkUserPermission).not.toHaveBeenCalled()
  })

  it('tells a failed auth call apart from a missing session in getPermissionStatus (BK-095)', async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: null, error: { name: 'AuthRetryableFetchError', status: 0 } })
    await expect(getPermissionStatus('events', 'view')).resolves.toBe('unavailable')

    mocks.getCurrentUser.mockResolvedValue({ user: null, error: { name: 'AuthSessionMissingError', status: 400 } })
    await expect(getPermissionStatus('events', 'view')).resolves.toBe('denied')

    mocks.getCurrentUser.mockResolvedValue({ user: null, error: { name: 'AuthApiError', status: 401 } })
    await expect(getPermissionStatus('events', 'view')).resolves.toBe('denied')

    mocks.getCurrentUser.mockResolvedValue({ user: null, error: null })
    await expect(getPermissionStatus('events', 'view')).resolves.toBe('denied')
  })

  it('returns the same shapes when signed in', async () => {
    await expect(getCurrentUserModuleActions('events')).resolves.toEqual({ success: true, actions: ['view'] })
    await expect(getUserRoles()).resolves.toEqual({ success: true, data: [{ id: 'r1', name: 'staff' }] })
    expect(mocks.getUserRoles).toHaveBeenCalledWith('user-1', false, 'user-1')
  })
})

describe('getCurrentUser itself', () => {
  it('returns the user and error from one getUser call through createClient', async () => {
    vi.doUnmock('@/lib/supabase/current-user')
    vi.resetModules()
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({ auth: { getUser } }) }))
    const { getCurrentUser } = await import('@/lib/supabase/current-user')

    await expect(getCurrentUser()).resolves.toEqual({ user, error: null })
    expect(getUser).toHaveBeenCalledTimes(1)
  })
})
