'use client';

import { useEffect, useState, useCallback } from 'react';
import { Role, Permission } from '@/types/rbac';
import { getRolePermissions, assignPermissionsToRole } from '@/app/actions/rbac';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal';
import { Button } from '@/components/ui-v2/forms/Button';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Card } from '@/components/ui-v2/layout/Card';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';

interface RolePermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: Role;
  allPermissions: Permission[];
}

interface GroupedPermissions {
  [module: string]: Permission[];
}

export default function RolePermissionsModal({
  isOpen,
  onClose,
  role,
  allPermissions
}: RolePermissionsModalProps) {
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const loadRolePermissions = useCallback(async () => {
    setLoading(true);
    const result = await getRolePermissions(role.id);
    if (result.success && result.data) {
      const permissionIds = result.data.map((rp: { permission_id: string }) => rp.permission_id);
      setSelectedPermissions(new Set(permissionIds));
    }
    setLoading(false);
  }, [role.id]);

  useEffect(() => {
    if (isOpen) {
      loadRolePermissions();
    }
  }, [isOpen, loadRolePermissions]);

  const handleSave = async () => {
    setSaving(true);
    const result = await assignPermissionsToRole(role.id, Array.from(selectedPermissions));
    
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success('Permissions updated successfully');
      router.refresh();
      onClose();
    }
    setSaving(false);
  };

  const togglePermission = (permissionId: string) => {
    const newSelected = new Set(selectedPermissions);
    if (newSelected.has(permissionId)) {
      newSelected.delete(permissionId);
    } else {
      newSelected.add(permissionId);
    }
    setSelectedPermissions(newSelected);
  };

  const toggleModule = (modulePermissions: Permission[]) => {
    const modulePermissionIds = modulePermissions.map(p => p.id);
    const allSelected = modulePermissionIds.every(id => selectedPermissions.has(id));
    
    const newSelected = new Set(selectedPermissions);
    if (allSelected) {
      modulePermissionIds.forEach(id => newSelected.delete(id));
    } else {
      modulePermissionIds.forEach(id => newSelected.add(id));
    }
    setSelectedPermissions(newSelected);
  };

  // Group permissions by module
  const groupedPermissions = allPermissions.reduce<GroupedPermissions>((acc, permission) => {
    if (!acc[permission.module_name]) {
      acc[permission.module_name] = [];
    }
    acc[permission.module_name].push(permission);
    return acc;
  }, {});

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={`Manage Permissions: ${role.name}`}
      size="lg"
      footer={
        <ModalActions>
          <Button
            onClick={onClose}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant="primary"
            disabled={saving || loading || role.is_system}
            loading={saving}
          >
            Save Permissions
          </Button>
        </ModalActions>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedPermissions).map(([module, permissions]) => (
            <Card key={module} padding="sm">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-gray-900 capitalize">
                  {module.replace('_', ' ')}
                </h4>
                <Button
                  onClick={() => toggleModule(permissions)}
                  variant="link"
                  size="sm"
                >
                  {permissions.every(p => selectedPermissions.has(p.id))
                    ? 'Deselect all'
                    : 'Select all'}
                </Button>
              </div>
              <div className="space-y-2">
                {permissions.map((permission) => (
                  <Checkbox
                    key={permission.id}
                    checked={selectedPermissions.has(permission.id)}
                    onChange={() => togglePermission(permission.id)}
                    disabled={role.is_system}
                    label={permission.description || permission.action}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      
      {role.is_system && (
        <p className="mt-4 text-sm text-gray-500 text-center">
          System roles cannot be modified
        </p>
      )}
    </Modal>
  );
}