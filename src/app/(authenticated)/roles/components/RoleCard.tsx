'use client';

import { Role } from '@/types/rbac'
import { deleteRole } from '@/app/actions/rbac'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardDescription, toast, Icon } from '@/ds'
import { Button, IconButton, LinkButton } from '@/ds'
import { Badge } from '@/ds'

interface RoleCardProps {
  role: Role
  onEditPermissions: () => void
  canManage: boolean
}

export default function RoleCard({ role, onEditPermissions, canManage }: RoleCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    if (!canManage || role.is_system) {
      return
    }

    if (!confirm(`Are you sure you want to delete the role "${role.name}"?`)) {
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
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="flex items-center">
              {role.name}
              {role.is_system && (
                <Badge tone="neutral" size="sm" className="ml-2">
                  System
                </Badge>
              )}
            </CardTitle>
            {role.description && (
              <CardDescription>{role.description}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>

      <div className="px-4 py-3 sm:px-6 flex flex-wrap justify-between items-center gap-2 border-t border-border">
        <Button
          onClick={onEditPermissions}
          variant="secondary"
          size="sm"
          leftIcon={<Icon name="shieldCheck" size={16} />}
        >
          {canManage ? 'Permissions' : 'View Permissions'}
        </Button>

        <div className="flex space-x-2">
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
              onClick={handleDelete}
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
    </Card>
  )
}
