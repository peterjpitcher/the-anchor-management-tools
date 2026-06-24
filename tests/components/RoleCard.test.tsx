import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RoleCard from '@/app/(authenticated)/roles/components/RoleCard'
import type { Role } from '@/types/rbac'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}))

vi.mock('@/app/actions/rbac', () => ({
  deleteRole: vi.fn(),
}))

const role: Role = {
  id: 'role-1',
  name: 'Supervisor',
  description: 'Runs the floor',
  is_system: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

describe('RoleCard', () => {
  it('links manageable custom roles to the edit page', () => {
    render(<RoleCard role={role} canManage onEditPermissions={vi.fn()} />)

    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute('href', '/roles/role-1/edit')
  })

  it('does not show edit for system roles', () => {
    render(<RoleCard role={{ ...role, is_system: true }} canManage onEditPermissions={vi.fn()} />)

    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument()
  })
})
