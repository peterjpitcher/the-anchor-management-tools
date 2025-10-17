'use client';

import { Role } from '@/types/rbac'
import { TrashIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import { deleteRole } from '@/app/actions/rbac'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'

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
                <Badge variant="default" size="sm" className="ml-2">
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

      <div className="px-4 py-3 sm:px-6 flex justify-between items-center border-t border-gray-200">
        <Button
          onClick={onEditPermissions}
          variant="secondary"
          size="sm"
          leftIcon={<ShieldCheckIcon className="h-4 w-4" />}
        >
          {canManage ? 'Permissions' : 'View Permissions'}
        </Button>

        <div className="flex space-x-2">
          {!role.is_system && (
            <IconButton
              onClick={handleDelete}
              disabled={isDeleting || !canManage}
              variant="secondary"
              size="sm"
              aria-label="Delete role"
            >
              <TrashIcon className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>
    </Card>
  )
}
