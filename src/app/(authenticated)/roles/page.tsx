import { getAllRoles, getAllPermissions } from '@/app/actions/rbac';
import RoleList from './components/RoleList';
import { PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

export default async function RolesPage() {
  const [rolesResult, permissionsResult] = await Promise.all([
    getAllRoles(),
    getAllPermissions()
  ]);

  if (rolesResult.error || permissionsResult.error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">
          {rolesResult.error || permissionsResult.error}
        </p>
      </div>
    );
  }

  const roles = rolesResult.data || [];
  const permissions = permissionsResult.data || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Role Management</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage roles and permissions for your organization
          </p>
        </div>
        <Link
          href="/roles/new"
          className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 min-h-[44px]"
        >
          <PlusIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
          New Role
        </Link>
      </div>

      <RoleList roles={roles} permissions={permissions} />
    </div>
  );
}