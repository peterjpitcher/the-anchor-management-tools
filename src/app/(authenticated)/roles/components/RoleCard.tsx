'use client';

import { Role } from '@/types/rbac'
import { deleteRole } from '@/app/actions/rbac'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Icon,
  IconButton,
  LinkButton,
  toast,
} from '@/ds'
import { ROLE_SYSTEM_FLAG_TONE } from '../_shared/status-ui'

interface RoleCardProps {
  role: Role
  onEditPermissions: () => void
  canManage: boolean
}

export default function RoleCard({ role, onEditPermissions, canManage }: RoleCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    if (!canManage || role.is_system) {
      return
    }

    setIsDeleting(true)
    const result = await deleteRole(role.id)

    if (result.error) {
      toast.error(result.error)
      setIsDeleting(false)
    } else {
      toast.success('Role deleted successfully')
      router.refresh()
      setIsDeleting(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={role.name}
        action={role.is_system ? <Badge tone={ROLE_SYSTEM_FLAG_TONE} size="sm">System</Badge> : undefined}
      />

      <CardBody className="space-y-4">
        {role.description && (
          <p className="text-sm text-text-muted">{role.description}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            onClick={onEditPermissions}
            variant="secondary"
            size="sm"
            icon={<Icon name="shieldCheck" size={16} />}
          >
            {canManage ? 'Manage Permissions' : 'View Permissions'}
          </Button>

          <div className="flex gap-2">
            {canManage && !role.is_system && (
              <LinkButton
                href={`/roles/${role.id}/edit`}
                variant="secondary"
                size="sm"
                icon={<Icon name="edit" size={16} />}
              >
                Edit
              </LinkButton>
            )}
            {!role.is_system && (
              <IconButton
                onClick={() => setConfirmOpen(true)}
                disabled={isDeleting || !canManage}
                variant="secondary"
                size="sm"
                aria-label="Delete role"
              >
                <Icon name="trash" size={16} />
              </IconButton>
            )}
          </div>
        </div>
      </CardBody>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete Role"
        message={`Delete the role "${role.name}"? Anyone who has it loses its permissions. This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
      />
    </Card>
  )
}
