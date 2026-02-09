import type { UserPermission } from '@/types/rbac'

export function isFohOnlyUser(permissions: UserPermission[]): boolean {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    return false
  }

  const hasFohView = permissions.some(
    (permission) => permission.module_name === 'table_bookings' && permission.action === 'view'
  )

  if (!hasFohView) {
    return false
  }

  return permissions.every((permission) => permission.module_name === 'table_bookings')
}
