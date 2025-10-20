import { getAllRoles, getAllPermissions, checkUserPermission } from '@/app/actions/rbac'
import RoleList from './components/RoleList'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
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
      title="Role Management"
      subtitle="Manage roles and permissions for your organization"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      headerActions={
        canManage ? (
          <LinkButton href="/roles/new" variant="primary">
            New Role
          </LinkButton>
        ) : undefined
      }
    >
      {errorMessage && (
        <Alert
          variant="error"
          title="Error loading data"
          description={errorMessage}
        />
      )}

      <RoleList roles={roles} permissions={permissions} canManage={!!canManage} />
    </PageLayout>
  )
}
