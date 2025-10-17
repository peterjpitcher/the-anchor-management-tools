import { createRole, checkUserPermission } from '@/app/actions/rbac';
import RoleForm from '../components/RoleForm';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { redirect } from 'next/navigation';

export default async function NewRolePage() {
  const canManage = await checkUserPermission('roles', 'manage');
  if (!canManage) {
    redirect('/unauthorized');
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Create New Role"
        subtitle="Define a new role with a unique name and description"
        backButton={{
          label: "Back to Roles",
          href: "/roles"
        }}
      />
      <PageContent>
        <RoleForm action={createRole} />
      </PageContent>
    </PageWrapper>
  );
}
