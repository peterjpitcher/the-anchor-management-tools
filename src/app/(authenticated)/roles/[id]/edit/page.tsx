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

  // One set of header props for every state. The role's name is only known once it has loaded.
  const layoutProps = {
    subtitle: "Update this role's name and description",
    backButton: { label: 'Back to Roles', href: '/roles' },
    containerSize: 'md',
  } as const

  if (rolesResult.error) {
    return (
      <PageLayout title="Edit Role" {...layoutProps}>
        <Alert tone="danger" title="Unable to load role">{rolesResult.error}</Alert>
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
    <PageLayout title={`Edit ${role.name}`} {...layoutProps}>
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
