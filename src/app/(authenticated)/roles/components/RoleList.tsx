'use client';

import { useState } from 'react';
import { Role, Permission } from '@/types/rbac';
import RoleCard from './RoleCard';
import RolePermissionsModal from './RolePermissionsModal';

interface RoleListProps {
  roles: Role[];
  permissions: Permission[];
}

export default function RoleList({ roles, permissions }: RoleListProps) {
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);

  const handleEditPermissions = (role: Role) => {
    setSelectedRole(role);
    setIsPermissionsModalOpen(true);
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            onEditPermissions={() => handleEditPermissions(role)}
          />
        ))}
      </div>

      {selectedRole && (
        <RolePermissionsModal
          isOpen={isPermissionsModalOpen}
          onClose={() => {
            setIsPermissionsModalOpen(false);
            setSelectedRole(null);
          }}
          role={selectedRole}
          allPermissions={permissions}
        />
      )}
    </>
  );
}