import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RolePermissionsModal from '@/app/(authenticated)/roles/components/RolePermissionsModal'
import type { Permission, Role } from '@/types/rbac'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const mockGetRolePermissions = vi.fn()

vi.mock('@/app/actions/rbac', () => ({
  getRolePermissions: (...args: unknown[]) => mockGetRolePermissions(...args),
  assignPermissionsToRole: vi.fn(),
}))

const customRole: Role = {
  id: 'role-1',
  name: 'Supervisor',
  description: 'Runs the floor',
  is_system: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const permissions: Permission[] = [
  {
    id: 'perm-1',
    module_name: 'private_bookings',
    action: 'view',
    description: 'View private bookings',
    created_at: '2026-01-01T00:00:00.000Z',
  },
]

function renderModal(role: Role, canManage: boolean) {
  return render(
    <RolePermissionsModal isOpen onClose={() => {}} role={role} allPermissions={permissions} canManage={canManage} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetRolePermissions.mockResolvedValue({ success: true, data: [{ permission_id: 'perm-1' }] })
})

describe('RolePermissionsModal', () => {
  it('says why a system role is locked under the title, once, and blocks saving', async () => {
    renderModal({ ...customRole, is_system: true, name: 'Manager' }, true)

    const dialog = await screen.findByRole('dialog', { name: 'Manage Permissions: Manager' })
    expect(dialog).toHaveAccessibleDescription('System roles cannot be modified')
    expect(screen.getAllByText('System roles cannot be modified')).toHaveLength(1)
    expect(await screen.findByRole('checkbox', { name: 'View private bookings' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save Permissions' })).toBeDisabled()
  })

  it('tells someone without the permission that they cannot change it', async () => {
    renderModal(customRole, false)

    const dialog = await screen.findByRole('dialog', { name: 'Manage Permissions: Supervisor' })
    expect(dialog).toHaveAccessibleDescription('You do not have permission to change role permissions')
    expect(screen.getByRole('button', { name: 'Save Permissions' })).toBeDisabled()
  })

  it('adds no description when the role can be edited', async () => {
    renderModal(customRole, true)

    const dialog = await screen.findByRole('dialog', { name: 'Manage Permissions: Supervisor' })
    expect(dialog).not.toHaveAttribute('aria-describedby')
    expect(await screen.findByRole('checkbox', { name: 'View private bookings' })).toBeEnabled()
  })
})
