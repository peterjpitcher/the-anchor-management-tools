'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Role, UserSummaryWithRoles } from '@/types/rbac';
import { getUserRoles, assignRolesToUser } from '@/app/actions/rbac';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Checkbox, Modal, PageLoading, toast } from '@/ds';
import { ROLE_SYSTEM_FLAG_TONE } from '../../roles/_shared/status-ui';

type UserSummary = Pick<UserSummaryWithRoles, 'id' | 'email'>;

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
      title="Manage Roles"
      description={user.email || undefined}
      width="md"
      footer={
        <>
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
            Save Changes
          </Button>
        </>
      }
    >
      {loading ? (
        <PageLoading inline label="Loading roles" />
      ) : (
        <div className="space-y-3">
          {readOnly && (
            <Alert
              tone="info"
              title="Read-only access"
            >
              You need the users:manage_roles permission to modify role assignments.
            </Alert>
          )}

          {loadError && (
            <Alert
              tone="danger"
              title="Unable to load roles"
            >
              {loadError}
            </Alert>
          )}

          {!readOnly && !loadError && allRoles.map((role) => (
            <div key={role.id} className="flex items-start justify-between gap-3">
              <Checkbox
                checked={selectedRoles.has(role.id)}
                onChange={() => toggleRole(role.id)}
                id={`role-${role.id}`}
                label={role.name}
                description={role.description || undefined}
                disabled={saving}
              />
              {role.is_system && (
                <Badge tone={ROLE_SYSTEM_FLAG_TONE} size="sm">
                  System
                </Badge>
              )}
            </div>
          ))}

          {!readOnly && !loadError && allRoles.length === 0 && (
            <Alert
              tone="info"
              title="No roles available"
            >
              Create roles before assigning them to users.
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}
