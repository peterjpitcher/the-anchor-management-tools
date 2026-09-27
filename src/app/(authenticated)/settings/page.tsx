import { checkUserPermission } from '@/app/actions/rbac'
import { canViewCalendarNotes } from '@/app/actions/calendar-notes'
import { currentUserCanUseMaintenance } from '@/app/actions/maintenance'
import { getSiteSettings } from '@/app/actions/site-settings'
import { SettingsClient } from './_components/SettingsClient'
import { buildSettingsTileGroups } from './_shared/tiles'

export default async function SettingsPage() {
  const [
    canViewSettings,
    canManageSettings,
    canViewUsers,
    canViewRoles,
    canManageEvents,
    canViewNotes,
    canViewCustomers,
    canViewMessages,
    canManageTemplates,
    canManageMenu,
    canManageMaintenanceAreas,
    settingsResult,
  ] = await Promise.all([
    checkUserPermission('settings', 'view'),
    checkUserPermission('settings', 'manage'),
    checkUserPermission('users', 'view'),
    checkUserPermission('roles', 'view'),
    checkUserPermission('events', 'manage'),
    canViewCalendarNotes(),
    checkUserPermission('customers', 'view'),
    checkUserPermission('messages', 'view'),
    checkUserPermission('messages', 'manage_templates'),
    checkUserPermission('menu_management', 'manage'),
    // Not a permission check: maintenance is super-admin only and has no RBAC
    // module, because user_has_permission can only raise a floor for a
    // super-admin, never impose a ceiling on anyone else.
    currentUserCanUseMaintenance(),
    getSiteSettings(),
  ])

  const tileGroups = buildSettingsTileGroups({
    settingsView: canViewSettings,
    settingsManage: canManageSettings,
    usersView: canViewUsers,
    rolesView: canViewRoles,
    eventsManage: canManageEvents,
    calendarNotesView: canViewNotes,
    customersView: canViewCustomers,
    messagesView: canViewMessages,
    messageTemplatesManage: canManageTemplates,
    menuManage: canManageMenu,
    maintenanceAreas: canManageMaintenanceAreas,
  })

  return (
    <SettingsClient
      tileGroups={tileGroups}
      canManageSettings={canManageSettings}
      siteSettings={settingsResult.settings ?? null}
    />
  )
}
