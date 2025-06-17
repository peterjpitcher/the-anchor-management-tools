import { getAllRoles, checkUserPermission, getAllUsers } from '@/app/actions/rbac';
import UserList from './components/UserList';

export default async function UsersPage() {
  // Check permission
  const hasPermission = await checkUserPermission('users', 'view');
  if (!hasPermission) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">You don't have permission to view this page.</p>
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
      <div className="text-center py-12">
        <p className="text-red-600">
          {usersResult.error || rolesResult.error}
        </p>
      </div>
    );
  }

  const users = usersResult.data || [];
  const roles = rolesResult.data || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage user roles and permissions
        </p>
      </div>

      <UserList users={users} roles={roles} />
    </div>
  );
}