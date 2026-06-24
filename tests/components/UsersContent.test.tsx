import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { UsersContent } from '@/app/(authenticated)/users/_components/UsersContent'
import type { Role, UserSummaryWithRoles } from '@/types/rbac'

const managerRole: Role = {
  id: 'role-manager',
  name: 'Manager',
  description: 'Can manage the pub',
  is_system: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const staffRole: Role = {
  id: 'role-staff',
  name: 'Staff',
  description: 'General staff access',
  is_system: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const users: UserSummaryWithRoles[] = [
  {
    id: 'user-manager',
    email: 'manager@example.com',
    created_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: null,
    roles: [managerRole],
  },
  {
    id: 'user-staff',
    email: 'staff@example.com',
    created_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: null,
    roles: [staffRole],
  },
]

describe('UsersContent', () => {
  it('renders real role badges and filters by role', () => {
    render(<UsersContent users={users} roles={[managerRole, staffRole]} canManageRoles={false} />)

    const managerRow = screen.getByText('manager@example.com').closest('tr')
    const staffRow = screen.getByText('staff@example.com').closest('tr')

    expect(managerRow).not.toBeNull()
    expect(staffRow).not.toBeNull()
    expect(within(managerRow as HTMLTableRowElement).getByText('Manager')).toBeInTheDocument()
    expect(within(staffRow as HTMLTableRowElement).getByText('Staff')).toBeInTheDocument()
    expect(within(managerRow as HTMLTableRowElement).queryByText(/^User$/)).not.toBeInTheDocument()
    expect(within(staffRow as HTMLTableRowElement).queryByText(/^User$/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by role'), {
      target: { value: 'role-manager' },
    })

    expect(screen.getByText('manager@example.com')).toBeInTheDocument()
    expect(screen.queryByText('staff@example.com')).not.toBeInTheDocument()
  })
})
