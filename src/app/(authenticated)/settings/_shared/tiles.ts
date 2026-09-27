import type { IconName } from '@/ds'

/**
 * The tiles on /settings. Each tile is shown only to somebody who can open the page behind it:
 * `requires` names the same check that page makes (its `checkUserPermission` call, or the
 * super-admin check for Maintenance Areas). A tile that leads to /unauthorized is a dead end,
 * not navigation. The pages still enforce their own checks; hiding a tile never replaces them.
 */
export type SettingsTileRequirement =
  | 'settingsView'
  | 'settingsManage'
  | 'usersView'
  | 'rolesView'
  | 'eventsManage'
  | 'calendarNotesView'
  | 'customersView'
  | 'messagesView'
  | 'messageTemplatesManage'
  | 'menuManage'
  | 'maintenanceAreas'

export type SettingsTilePermissions = Record<SettingsTileRequirement, boolean>

export type SettingsTile = {
  href: string
  title: string
  description: string
  icon: IconName
}

type SettingsTileEntry = SettingsTile & { requires?: SettingsTileRequirement }

export type SettingsTileGroup = {
  title: string
  tiles: SettingsTile[]
}

type SettingsTileGroupEntry = {
  title: string
  tiles: SettingsTileEntry[]
}

const SETTINGS_TILE_GROUPS: SettingsTileGroupEntry[] = [
  {
    title: 'User & Access',
    tiles: [
      { href: '/users', title: 'Users', description: 'Manage users and their role assignments', icon: 'users', requires: 'usersView' },
      { href: '/roles', title: 'Roles', description: 'Create and manage roles and permissions', icon: 'shieldCheck', requires: 'rolesView' },
      { href: '/profile', title: 'My Profile', description: 'View and edit your personal profile information', icon: 'userCircle' },
    ],
  },
  {
    title: 'Staff Operations',
    tiles: [
      { href: '/settings/rota', title: 'Rota Settings', description: 'Holiday year, default allowance, and notification email addresses', icon: 'briefcase', requires: 'settingsManage' },
      { href: '/settings/pay-bands', title: 'Pay Bands', description: 'Age bands, rates, and overrides', icon: 'pound', requires: 'settingsManage' },
      { href: '/settings/budgets', title: 'Department Budgets', description: 'Set annual hours budgets per department for rota planning', icon: 'barChart', requires: 'settingsManage' },
      { href: '/settings/categories', title: 'Attachment Categories', description: 'Manage categories for employee file attachments', icon: 'paperclip', requires: 'settingsManage' },
    ],
  },
  {
    title: 'Events & Bookings',
    tiles: [
      { href: '/settings/business-hours', title: 'Business Hours', description: 'Opening hours and special days', icon: 'clock', requires: 'settingsManage' },
      { href: '/settings/table-bookings', title: 'Table Setup', description: 'Tables, areas, groups, and pacing', icon: 'table', requires: 'settingsManage' },
      { href: '/settings/event-categories', title: 'Event Categories', description: 'Defaults and marketing metadata', icon: 'calendar', requires: 'eventsManage' },
      { href: '/settings/calendar-notes', title: 'Calendar Notes', description: 'Add and generate important calendar dates with AI', icon: 'edit', requires: 'calendarNotesView' },
    ],
  },
  {
    title: 'Customers & Communications',
    tiles: [
      { href: '/settings/customer-labels', title: 'Customer Labels', description: 'Customer tags and automation rules', icon: 'tag', requires: 'customersView' },
      { href: '/settings/message-templates', title: 'Message Templates', description: 'Manage SMS message templates and customise content', icon: 'fileText', requires: 'messageTemplatesManage' },
      { href: '/settings/import-messages', title: 'Import Messages', description: 'Import historical SMS messages from your Twilio account', icon: 'download', requires: 'messagesView' },
      { href: '/settings/sms-failures', title: 'SMS Failures', description: 'Retry or dismiss failed messages', icon: 'message', requires: 'settingsManage' },
    ],
  },
  {
    title: 'Finance',
    tiles: [
      { href: '/settings/menu-target', title: 'Menu GP Target', description: 'Set the standard GP% target applied to all dishes', icon: 'percent', requires: 'menuManage' },
    ],
  },
  {
    title: 'Monitoring & Admin',
    tiles: [
      { href: '/settings/api-keys', title: 'API Keys', description: 'External API access and revocation', icon: 'link', requires: 'settingsView' },
      { href: '/settings/audit-logs', title: 'Audit Logs', description: 'View system audit logs for security and compliance', icon: 'clipboardList', requires: 'settingsManage' },
      { href: '/settings/background-jobs', title: 'Background Jobs', description: 'Monitor and manage background job processing', icon: 'refresh', requires: 'settingsManage' },
      { href: '/settings/gdpr', title: 'GDPR & Privacy', description: 'Data export and deletion tools', icon: 'eyeOff', requires: 'settingsManage' },
      // Super-admin only: the maintenance tracker has no RBAC module on purpose.
      { href: '/settings/maintenance', title: 'Maintenance Areas', description: 'Parts of the pub a maintenance item can belong to', icon: 'alertTriangle', requires: 'maintenanceAreas' },
    ],
  },
  {
    title: 'Developer Tools',
    tiles: [
      { href: '/settings/design-system', title: 'Design System', description: 'Component library, colours, typography, and spacing reference', icon: 'palette' },
    ],
  },
]

/** The tile groups this user can use, with empty groups left out. */
export function buildSettingsTileGroups(permissions: SettingsTilePermissions): SettingsTileGroup[] {
  return SETTINGS_TILE_GROUPS.map((group) => ({
    title: group.title,
    tiles: group.tiles
      .filter((tile) => tile.requires === undefined || permissions[tile.requires])
      .map(({ requires: _requires, ...tile }) => tile),
  })).filter((group) => group.tiles.length > 0)
}
