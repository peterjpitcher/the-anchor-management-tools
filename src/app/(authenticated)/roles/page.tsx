import { getAllRoles, getAllPermissions } from '@/app/actions/rbac';
import RoleList from './components/RoleList';
import { PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Button } from '@/components/ui-v2/forms/Button';
import { Alert } from '@/components/ui-v2/feedback/Alert';

export default async function RolesPage() {
  const [rolesResult, permissionsResult] = await Promise.all([
    getAllRoles(),
    getAllPermissions()
  ]);

  if (rolesResult.error || permissionsResult.error) {
    return (
      <Page title="Role Management">
        <Card>
          <Alert variant="error"
            title="Error loading data"
            description={rolesResult.error || permissionsResult.error || 'Failed to load roles and permissions'}
          />
        </Card>
      </Page>
    );
  }

  const roles = rolesResult.data || [];
  const permissions = permissionsResult.data || [];

  return (
    <Page
      title="Role Management"
      description="Manage roles and permissions for your organization"
      actions={
        <Link href="/roles/new">
          <Button variant="primary"
            leftIcon={<PlusIcon className="h-5 w-5" />}
          >
            New Role
          </Button>
        </Link>
      }
    >
      <RoleList roles={roles} permissions={permissions} />
    </Page>
  );
}