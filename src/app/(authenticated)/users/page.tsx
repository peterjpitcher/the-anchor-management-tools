import { getAllRoles, checkUserPermission, getAllUsers } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'
import type { Role } from '@/types/rbac'
import { UsersClient } from './_components/UsersClient'
import { Alert, PageLayout } from '@/ds'
import { USERS_LAYOUT } from './_shared/layout'

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
      <PageLayout {...USERS_LAYOUT}>
        <Alert tone="danger" title="Error loading users">
          {usersResult.error || 'Failed to load users'}
        </Alert>
      </PageLayout>
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
