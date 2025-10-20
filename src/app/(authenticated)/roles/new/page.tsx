import { createRole, checkUserPermission } from '@/app/actions/rbac';
import RoleForm from '../components/RoleForm';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { redirect } from 'next/navigation';

export default async function NewRolePage() {
  const canManage = await checkUserPermission('roles', 'manage');
  if (!canManage) {
    redirect('/unauthorized');
  }

  return (
    <PageLayout
      title="Create New Role"
      subtitle="Define a new role with a unique name and description"
      backButton={{
        label: "Back to Roles",
        href: "/roles"
      }}
    >
      <RoleForm action={createRole} />
    </PageLayout>
  );
}
