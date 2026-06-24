import { checkUserPermission, getAllRoles, updateRole } from '@/app/actions/rbac'
import { Alert, PageLayout } from '@/ds'
import { notFound, redirect } from 'next/navigation'
import RoleForm from '../../components/RoleForm'

interface EditRolePageProps {
  params: Promise<{ id: string }>
}

export default async function EditRolePage({ params }: EditRolePageProps) {
  const canManage = await checkUserPermission('roles', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const { id } = await params
  const rolesResult = await getAllRoles()

  if (rolesResult.error) {
    return (
      <PageLayout
        title="Edit Role"
        subtitle="Update a role name and description"
        backButton={{ label: 'Back to Roles', href: '/roles' }}
      >
        <Alert variant="error" title="Unable to load role" description={rolesResult.error} />
      </PageLayout>
    )
  }

  const role = rolesResult.data?.find((candidate) => candidate.id === id)
  if (!role) {
    notFound()
  }

  if (role.is_system) {
    redirect('/roles')
  }

  return (
    <PageLayout
      title={`Edit ${role.name}`}
      subtitle="Update this role's name and description"
      backButton={{ label: 'Back to Roles', href: '/roles' }}
    >
      <RoleForm
        action={updateRole}
        initialData={{
          id: role.id,
          name: role.name,
          description: role.description ?? '',
        }}
      />
    </PageLayout>
  )
}
