import { getAllRoles, checkUserPermission, getAllUsers } from '@/app/actions/rbac';
import UserList from './components/UserList';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { Alert } from '@/components/ui-v2/feedback/Alert';

export default async function UsersPage() {
  // Check permission
  const hasPermission = await checkUserPermission('users', 'view');
  if (!hasPermission) {
    return (
      <Page title="User Management">
        <Card>
          <Alert variant="error"
            title="Access Denied"
            description="You don't have permission to view this page."
          />
        </Card>
      </Page>
    );
  }

  // Get all users and roles
  const [usersResult, rolesResult] = await Promise.all([
    getAllUsers(),
    getAllRoles()
  ]);
  
  if (usersResult.error || rolesResult.error) {
    return (
      <Page title="User Management">
        <Card>
          <Alert variant="error"
            title="Error loading data"
            description={usersResult.error || rolesResult.error || 'Failed to load users and roles'}
          />
        </Card>
      </Page>
    );
  }

  const users = usersResult.data || [];
  const roles = rolesResult.data || [];

  return (
    <Page
      title="User Management"
      description="Manage user roles and permissions"
    >
      <UserList users={users} roles={roles} />
    </Page>
  );
}