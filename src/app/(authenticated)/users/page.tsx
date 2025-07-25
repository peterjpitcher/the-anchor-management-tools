import { getAllRoles, checkUserPermission, getAllUsers } from '@/app/actions/rbac';
import UserList from './components/UserList';
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { Card } from '@/components/ui-v2/layout/Card';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { Alert } from '@/components/ui-v2/feedback/Alert';

export default async function UsersPage() {
  // Check permission
  const hasPermission = await checkUserPermission('users', 'view');
  if (!hasPermission) {
    return (
      <div>
        <PageHeader
          title="User Management"
          subtitle="Manage user roles and permissions"
          backButton={{
            label: "Back to Settings",
            href: "/settings"
          }}
        />
        <Card>
          <Alert variant="error"
            title="Access Denied"
            description="You don't have permission to view this page."
          />
        </Card>
      </div>
    );
  }

  // Get all users and roles
  const [usersResult, rolesResult] = await Promise.all([
    getAllUsers(),
    getAllRoles()
  ]);
  
  if (usersResult.error || rolesResult.error) {
    return (
      <div>
        <PageHeader
          title="User Management"
          subtitle="Manage user roles and permissions"
          backButton={{
            label: "Back to Settings",
            href: "/settings"
          }}
        />
        <Card>
          <Alert variant="error"
            title="Error loading data"
            description={usersResult.error || rolesResult.error || 'Failed to load users and roles'}
          />
        </Card>
      </div>
    );
  }

  const users = usersResult.data || [];
  const roles = rolesResult.data || [];

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Manage user roles and permissions"
        backButton={{
          label: "Back to Settings",
          href: "/settings"
        }}
      />
      {users.length === 0 ? (
        <Card>
          <EmptyState
            title="No users found"
            description="Start by inviting users to your application"
          />
        </Card>
      ) : (
        <UserList users={users} roles={roles} />
      )}
    </div>
  );
}