'use client';

import { useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Role } from '@/types/rbac';
import UserRolesModal from './UserRolesModal';
import { format } from 'date-fns';

interface UserListProps {
  users: User[];
  roles: Role[];
}

export default function UserList({ users, roles }: UserListProps) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false);

  const handleManageRoles = (user: User) => {
    setSelectedUser(user);
    setIsRolesModalOpen(true);
  };

  return (
    <>
      <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Sign In
              </th>
              <th className="relative px-6 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {user.email}
                  </div>
                  <div className="text-sm text-gray-500">
                    ID: {user.id}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {format(new Date(user.created_at), 'MMM d, yyyy')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {user.last_sign_in_at
                    ? format(new Date(user.last_sign_in_at), 'MMM d, yyyy h:mm a')
                    : 'Never'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleManageRoles(user)}
                    className="text-blue-600 hover:text-blue-900"
                  >
                    Manage Roles
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedUser && (
        <UserRolesModal
          isOpen={isRolesModalOpen}
          onClose={() => {
            setIsRolesModalOpen(false);
            setSelectedUser(null);
          }}
          user={selectedUser}
          allRoles={roles}
        />
      )}
    </>
  );
}