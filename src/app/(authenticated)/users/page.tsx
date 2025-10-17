import { getAllRoles, checkUserPermission, getAllUsers } from '@/app/actions/rbac';
import UserList from './components/UserList';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { Card } from '@/components/ui-v2/layout/Card';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { redirect } from 'next/navigation';
import type { Role } from '@/types/rbac';

export default async function UsersPage() {
  const [canViewUsers, canManageRoles] = await Promise.all([
    checkUserPermission('users', 'view'),
    checkUserPermission('users', 'manage_roles'),
  ]);

  if (!canViewUsers) {
    redirect('/unauthorized');
  }

  const [usersResult, rawRolesResult] = await Promise.all([
    getAllUsers(),
    canManageRoles
      ? getAllRoles()
      : Promise.resolve<{ success: true; data: Role[] }>({ success: true, data: [] }),
  ]);

  if (usersResult.error) {
    return (
      <div>
        <PageHeader
          title="User Management"
          subtitle="Manage user roles and permissions"
          backButton={{
            label: 'Back to Settings',
            href: '/settings',
          }}
        />
        <Card>
          <Alert
            variant="error"
            title="Error loading users"
            description={usersResult.error || 'Failed to load users'}
          />
        </Card>
      </div>
    );
  }

  let roles: Role[] = [];
  let rolesError: string | null = null;

  if (canManageRoles) {
    if ('error' in rawRolesResult) {
      rolesError = rawRolesResult.error ?? 'Failed to load roles';
    } else {
      roles = rawRolesResult.data || [];
    }
  }

  const users = usersResult.data || [];
  const canManageRolesInUi = canManageRoles && !rolesError;

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Manage user roles and permissions"
        backButton={{
          label: 'Back to Settings',
          href: '/settings',
        }}
      />
      {!canManageRolesInUi && (
        <Card className="mb-4">
          <Alert
            variant={rolesError ? 'warning' : 'info'}
            title={rolesError ? 'Role management temporarily unavailable' : 'Read-only access'}
            description={
              rolesError
                ? rolesError
                : 'You can view users but need the users:manage_roles permission to change assignments.'
            }
          />
        </Card>
      )}
      {users.length === 0 ? (
        <Card>
          <EmptyState
            title="No users found"
            description="Start by inviting users to your application"
          />
        </Card>
      ) : (
        <UserList users={users} roles={roles} canManageRoles={canManageRolesInUi} />
      )}
    </div>
  );
}
