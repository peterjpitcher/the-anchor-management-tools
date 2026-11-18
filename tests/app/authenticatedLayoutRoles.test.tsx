import { beforeEach, describe, expect, it, vi } from 'vitest'

// S2 (page load spec, 18 November 2026): the layout looks up permissions and role names together,
// takes role names from the cached PermissionService.getRoleNames, and a failed role lookup shows
// the neutral label exactly as the old direct read did.

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserPermissions: vi.fn(),
  getRoleNames: vi.fn(),
  adminFrom: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/current-user', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/app/actions/rbac', () => ({ getUserPermissions: mocks.getUserPermissions }))
vi.mock('@/services/permission', () => ({ PermissionService: { getRoleNames: mocks.getRoleNames } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.adminFrom }) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => {
    throw new Error('the layout must not make a second auth lookup')
  }),
}))
vi.mock('@/app/(authenticated)/AuthenticatedLayout', () => ({ default: () => null }))

import Layout from '@/app/(authenticated)/layout'

type ShellProps = { userRoleLabel: string; isSuperAdmin: boolean; initialPermissions: unknown[] }

const user = { id: 'user-1' }
const permissions = [{ module_name: 'events', action: 'view' }]

function roleRowsQuery(result: { data: unknown; error: unknown }) {
  const query = { select: vi.fn(), eq: vi.fn(), returns: vi.fn() }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.returns.mockResolvedValue(result)
  return query
}

describe('authenticated layout role lookup (S2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue({ user, error: null })
    mocks.getUserPermissions.mockResolvedValue({ success: true, data: permissions })
  })

  it('labels the shell from the cached role names', async () => {
    mocks.getRoleNames.mockResolvedValue(['manager', 'super_admin'])
    const element = (await Layout({ children: 'page' })) as { props: ShellProps }

    expect(element.props.userRoleLabel).toBe('Super Admin')
    expect(element.props.isSuperAdmin).toBe(true)
    expect(element.props.initialPermissions).toEqual(permissions)
    expect(mocks.getRoleNames).toHaveBeenCalledWith('user-1')
    expect(mocks.adminFrom).not.toHaveBeenCalled()
  })

  it('shows the neutral label when the role lookup fails, and still renders', async () => {
    mocks.getRoleNames.mockRejectedValue(new Error('Could not check permissions'))
    const element = (await Layout({ children: 'page' })) as { props: ShellProps }

    expect(element.props.userRoleLabel).toBe('Staff')
    expect(element.props.isSuperAdmin).toBe(false)
  })

  it('sends a signed-out visitor to login before any lookup', async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: null, error: null })
    await expect(Layout({ children: 'page' })).rejects.toThrow('NEXT_REDIRECT /auth/login')
    expect(mocks.getUserPermissions).not.toHaveBeenCalled()
    expect(mocks.getRoleNames).not.toHaveBeenCalled()
  })

  it('keeps the direct user_roles fallback when the permissions lookup failed', async () => {
    mocks.getUserPermissions.mockResolvedValue({ error: 'Failed to fetch permissions' })
    mocks.getRoleNames.mockResolvedValue([])
    mocks.adminFrom.mockReturnValue(roleRowsQuery({ data: [{ roles: { name: 'portal_shift_manager' } }], error: null }))

    await expect(Layout({ children: 'page' })).rejects.toThrow('NEXT_REDIRECT /portal/shifts')
    expect(mocks.adminFrom).toHaveBeenCalledWith('user_roles')
  })

  it('still sends a portal-only login to the staff portal', async () => {
    mocks.getUserPermissions.mockResolvedValue({ success: true, data: [] })
    mocks.getRoleNames.mockResolvedValue(['portal_shift_manager'])
    await expect(Layout({ children: 'page' })).rejects.toThrow('NEXT_REDIRECT /portal/shifts')
  })
})
