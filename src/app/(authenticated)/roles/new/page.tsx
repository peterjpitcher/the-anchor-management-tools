import { createRole } from '@/app/actions/rbac';
import RoleForm from '../components/RoleForm';

export default function NewRolePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Create New Role</h1>
        <p className="mt-1 text-sm text-gray-600">
          Define a new role with a unique name and description
        </p>
      </div>

      <RoleForm action={createRole} />
    </div>
  );
}