import { getAllRoles, getAllPermissions } from '@/app/actions/rbac';
import RoleList from './components/RoleList';
import { PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { Card } from '@/components/ui-v2/layout/Card';
import { Button } from '@/components/ui-v2/forms/Button';
import { NavLink } from '@/components/ui-v2/navigation/NavLink';
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';

export default async function RolesPage() {
  const [rolesResult, permissionsResult] = await Promise.all([
    getAllRoles(),
    getAllPermissions()
  ]);

  if (rolesResult.error || permissionsResult.error) {
    return (
      <div>
        <PageHeader
          title="Role Management"
          subtitle="Manage roles and permissions for your organization"
          backButton={{
            label: "Back to Settings",
            href: "/settings"
          }}
        />
        <Card>
          <Alert variant="error"
            title="Error loading data"
            description={rolesResult.error || permissionsResult.error || 'Failed to load roles and permissions'}
          />
        </Card>
      </div>
    );
  }

  const roles = rolesResult.data || [];
  const permissions = permissionsResult.data || [];

  return (
    <div>
      <PageHeader
        title="Role Management"
        subtitle="Manage roles and permissions for your organization"
        backButton={{
          label: "Back to Settings",
          href: "/settings"
        }}
        actions={
          <NavGroup>
            <NavLink href="/roles/new">
              New Role
            </NavLink>
          </NavGroup>
        }
      />
      <RoleList roles={roles} permissions={permissions} />
    </div>
  );
}