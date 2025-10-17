import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import UserList from '@/app/(authenticated)/users/components/UserList'
import UserRolesModal from '@/app/(authenticated)/users/components/UserRolesModal'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}))

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

const mockGetUserRoles = vi.fn()
const mockAssignRolesToUser = vi.fn()

vi.mock('@/app/actions/rbac', () => ({
  getUserRoles: (...args: unknown[]) => mockGetUserRoles(...args),
  assignRolesToUser: (...args: unknown[]) => mockAssignRolesToUser(...args),
}))

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: toast,
}))

describe('User management UI gating', () => {
  const sampleUser = {
    id: 'user-1',
    email: 'user@example.com',
    created_at: '2024-01-01T00:00:00Z',
    last_sign_in_at: '2024-01-02T00:00:00Z',
  }

  const sampleRoles = [
    { id: 'role-1', name: 'Manager', description: 'Manage things', is_system: false },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides the manage roles action for read-only viewers', () => {
    render(<UserList users={[sampleUser]} roles={sampleRoles} canManageRoles={false} />)

    expect(screen.queryByText('Manage Roles')).not.toBeInTheDocument()
  })

  it('shows the manage roles action when permitted', () => {
    render(<UserList users={[sampleUser]} roles={sampleRoles} canManageRoles />)

    expect(screen.getByRole('button', { name: 'Manage Roles' })).toBeInTheDocument()
  })

  it('renders the modal in read-only mode without fetching roles', async () => {
    render(
      <UserRolesModal
        isOpen
        onClose={() => {}}
        user={sampleUser}
        allRoles={sampleRoles}
        canManageRoles={false}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Read-only access')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Save Roles' })).toBeDisabled()
    expect(mockGetUserRoles).not.toHaveBeenCalled()
  })
})
