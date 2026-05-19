import { checkUserPermission, getAllUsers, getAllRoles } from '@/app/actions/rbac'
import { getSiteSettings } from '@/app/actions/site-settings'
import type { Role } from '@/types/rbac'
import { SettingsClient } from './_components/SettingsClient'

export default async function SettingsPage() {
  const [canManageSettings, canViewUsers, canManageRoles] = await Promise.all([
    checkUserPermission('settings', 'manage'),
    checkUserPermission('users', 'view'),
    checkUserPermission('users', 'manage_roles'),
  ])

  const [usersResult, rawRolesResult, settingsResult] = await Promise.all([
    canViewUsers
      ? getAllUsers()
      : Promise.resolve({ data: [], error: undefined }),
    canManageRoles
      ? getAllRoles()
      : Promise.resolve<{ success: true; data: Role[] }>({ success: true, data: [] }),
    getSiteSettings(),
  ])

  const users = usersResult.data || []
  let roles: Role[] = []
  if (canManageRoles && !('error' in rawRolesResult)) {
    roles = rawRolesResult.data || []
  }
  const canManageRolesInUi = canManageRoles && !('error' in rawRolesResult)

  return (
    <SettingsClient
      users={users}
      roles={roles}
      canManageRoles={canManageRolesInUi}
      canManageSettings={canManageSettings}
      siteSettings={settingsResult.settings ?? null}
    />
  )
}
