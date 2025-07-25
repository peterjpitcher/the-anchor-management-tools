import { createRole } from '@/app/actions/rbac';
import RoleForm from '../components/RoleForm';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';

export default function NewRolePage() {
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