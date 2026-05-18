import { getAllRoles, checkUserPermission, getAllUsers } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'
import type { Role } from '@/types/rbac'
import { UsersClient } from './_components/UsersClient'
import { Card } from '@/ds'
import { Alert } from '@/ds'

export default async function UsersPage() {
  const [canViewUsers, canManageRoles] = await Promise.all([
    checkUserPermission('users', 'view'),
    checkUserPermission('users', 'manage_roles'),
  ])

  if (!canViewUsers) {
    redirect('/unauthorized')
  }

  const [usersResult, rawRolesResult] = await Promise.all([
    getAllUsers(),
    canManageRoles
      ? getAllRoles()
      : Promise.resolve<{ success: true; data: Role[] }>({ success: true, data: [] }),
  ])

  if (usersResult.error) {
    return (
      <Card>
        <Alert tone="danger" title="Error loading users">
          {usersResult.error || 'Failed to load users'}
        </Alert>
      </Card>
    )
  }

  let roles: Role[] = []
  if (canManageRoles && !('error' in rawRolesResult)) {
    roles = rawRolesResult.data || []
  }

  const users = usersResult.data || []
  const canManageRolesInUi = canManageRoles && !('error' in rawRolesResult)

  return (
    <UsersClient
      users={users}
      roles={roles}
      canManageRoles={canManageRolesInUi}
    />
  )
}
