'use client';

import { Role } from '@/types/rbac';
import { PencilIcon, TrashIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { deleteRole } from '@/app/actions/rbac';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

interface RoleCardProps {
  role: Role;
  onEditPermissions: () => void;
}

export default function RoleCard({ role, onEditPermissions }: RoleCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the role "${role.name}"?`)) {
      return;
    }

    setIsDeleting(true);
    const result = await deleteRole(role.id);
    
    if (result.error) {
      toast.error(result.error);
      setIsDeleting(false);
    } else {
      toast.success('Role deleted successfully');
      router.refresh();
    }
  };

  return (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              {role.name}
              {role.is_system && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                  System
                </span>
              )}
            </h3>
            {role.description && (
              <p className="mt-1 text-sm text-gray-500">{role.description}</p>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-between">
          <button
            onClick={onEditPermissions}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <ShieldCheckIcon className="-ml-0.5 mr-2 h-4 w-4" aria-hidden="true" />
            Permissions
          </button>

          <div className="flex space-x-2">
            {!role.is_system && (
              <>
                <button
                  onClick={() => router.push(`/roles/${role.id}/edit`)}
                  className="inline-flex items-center p-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  <PencilIcon className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="inline-flex items-center p-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                >
                  <TrashIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}