import { getAllRoles, getAllPermissions, checkUserPermission } from '@/app/actions/rbac'
import RoleList from './components/RoleList'
import { Alert, LinkButton, PageLayout } from '@/ds'
import { redirect } from 'next/navigation'

export default async function RolesPage() {
  const [canViewRoles, canManage] = await Promise.all([
    checkUserPermission('roles', 'view'),
    checkUserPermission('roles', 'manage'),
  ])

  if (!canViewRoles) {
    redirect('/unauthorized')
  }

  const [rolesResult, permissionsResult] = await Promise.all([
    getAllRoles(),
    getAllPermissions(),
  ])

  const errors: string[] = []

  if (rolesResult.error) {
    errors.push(rolesResult.error)
  }

  if (permissionsResult.error) {
    errors.push(permissionsResult.error)
  }

  const roles = rolesResult.data ?? []
  const permissions = permissionsResult.data ?? []
  const errorMessage = errors.length > 0 ? errors.join(' ') : null

  return (
    <PageLayout
      title="Roles"
      subtitle="Manage roles and permissions for your organisation"
      headerActions={
        canManage ? (
          <LinkButton href="/roles/new" variant="primary" size="sm">
            New Role
          </LinkButton>
        ) : undefined
      }
    >
      {errorMessage && (
        <Alert tone="danger" title="Error loading data">
          {errorMessage}
        </Alert>
      )}

      {/* A failed roles load shows the error only, never an empty list. */}
      {!rolesResult.error && (
        <RoleList roles={roles} permissions={permissions} canManage={!!canManage} />
      )}
    </PageLayout>
  )
}
