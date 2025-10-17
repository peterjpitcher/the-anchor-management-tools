'use client';

import { useEffect, useState, useCallback } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { Role } from '@/types/rbac';
import { getUserRoles, assignRolesToUser } from '@/app/actions/rbac';
import { useRouter } from 'next/navigation';
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal';
import { Button } from '@/components/ui-v2/forms/Button';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import toast from 'react-hot-toast';

type UserSummary = Pick<SupabaseUser, 'id' | 'email'>;

interface UserRolesModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserSummary;
  allRoles: Role[];
  canManageRoles: boolean;
}

export default function UserRolesModal({
  isOpen,
  onClose,
  user,
  allRoles,
  canManageRoles
}: UserRolesModalProps) {
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();
  const readOnly = !canManageRoles;

  const loadUserRoles = useCallback(async () => {
    if (readOnly) {
      setSelectedRoles(new Set());
      setLoading(false);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    const result = await getUserRoles(user.id);
    if (result.success && result.data) {
      const roleIds = result.data.map((r: { role_id: string }) => r.role_id);
      setSelectedRoles(new Set(roleIds));
    } else if (result.error) {
      setLoadError(result.error);
    }
    setLoading(false);
  }, [user.id, readOnly]);

  useEffect(() => {
    if (isOpen) {
      loadUserRoles();
    }
  }, [isOpen, loadUserRoles]);

  const handleSave = async () => {
    if (readOnly) {
      toast.error('You do not have permission to update roles.');
      return;
    }

    setSaving(true);
    const result = await assignRolesToUser(user.id, Array.from(selectedRoles));
    
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success('Roles updated successfully');
      router.refresh();
      onClose();
    }
    setSaving(false);
  };

  const toggleRole = (roleId: string) => {
    if (readOnly) {
      return;
    }

    const newSelected = new Set(selectedRoles);
    if (newSelected.has(roleId)) {
      newSelected.delete(roleId);
    } else {
      newSelected.add(roleId);
    }
    setSelectedRoles(newSelected);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Manage User Roles"
      description={user.email}
      size="md"
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
            disabled={saving || loading || readOnly || !!loadError}
            loading={saving}
          >
            Save Roles
          </Button>
        </ModalActions>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="space-y-3">
          {readOnly && (
            <Alert
              variant="info"
              title="Read-only access"
              description="You need the users:manage_roles permission to modify role assignments."
            />
          )}

          {loadError && (
            <Alert
              variant="error"
              title="Unable to load roles"
              description={loadError}
            />
          )}

          {!readOnly && !loadError && allRoles.map((role) => (
            <div key={role.id} className="flex items-start space-x-3">
              <Checkbox
                checked={selectedRoles.has(role.id)}
                onChange={() => toggleRole(role.id)}
                id={`role-${role.id}`}
                disabled={saving}
              />
              <label
                htmlFor={`role-${role.id}`}
                className="flex-1 cursor-pointer"
              >
                <div className="flex items-center">
                  <span className="text-sm font-medium text-gray-900">
                    {role.name}
                  </span>
                  {role.is_system && (
                    <Badge variant="default" size="sm" className="ml-2">
                      System
                    </Badge>
                  )}
                </div>
                {role.description && (
                  <p className="text-sm text-gray-500 mt-0.5">{role.description}</p>
                )}
              </label>
            </div>
          ))}

          {!readOnly && !loadError && allRoles.length === 0 && (
            <Alert
              variant="info"
              title="No roles available"
              description="Create roles before assigning them to users."
            />
          )}
        </div>
      )}
    </Modal>
  );
}
