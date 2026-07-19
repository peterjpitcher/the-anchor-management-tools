import type { ModuleName, UserPermission } from '@/types/rbac'

function isPortalOnlyUser(permissions: UserPermission[]): boolean {
  return Array.isArray(permissions) && permissions.length === 0
}

// Modules an FOH-only (chromeless kiosk) user may hold and still count as FOH-only.
// table_bookings is the anchor; checklists is added so the FOH iPad can reach /checklists
// without losing kiosk mode. Keep this in lockstep with the checklists:view grant to the
// foh_staff role (see the migration) and the /checklists allowlist in AuthenticatedLayout.
const FOH_MODULES = new Set<ModuleName>(['table_bookings', 'checklists'])

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

  return permissions.every((permission) => FOH_MODULES.has(permission.module_name))
}
