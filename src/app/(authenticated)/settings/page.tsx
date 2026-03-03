import {
  TagIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
  UserCircleIcon,
  UsersIcon,
  KeyIcon,
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  CpuChipIcon,
  CommandLineIcon,
  ClockIcon,
  LinkIcon,
  ChartBarIcon,
  TableCellsIcon,
  BanknotesIcon,
  UserGroupIcon,
  BuildingOfficeIcon,
} from '@heroicons/react/24/outline';
import { checkUserPermission } from '@/app/actions/rbac';
import type { ModuleName, ActionType } from '@/types/rbac';
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { SimpleList } from '@/components/ui-v2/display/List';

type SettingsGroup =
  | 'user-access'
  | 'staff-ops'
  | 'events-bookings'
  | 'customers-comms'
  | 'finance'
  | 'monitoring';

interface SettingsItem {
  name: string;
  description: string;
  href: string;
  icon: React.ElementType;
  group: SettingsGroup;
  permission: { module: ModuleName; action: ActionType } | null;
}

const settingsSections: SettingsItem[] = [
  // ── User & Access ──────────────────────────────────────────────────────────
  {
    name: 'My Profile',
    description: 'View and edit your personal profile information',
    href: '/profile',
    icon: UserCircleIcon,
    group: 'user-access',
    permission: null,
  },
  {
    name: 'User Management',
    description: 'Manage users and their role assignments',
    href: '/users',
    icon: UsersIcon,
    group: 'user-access',
    permission: { module: 'users', action: 'view' },
  },
  {
    name: 'Role Management',
    description: 'Create and manage roles and permissions',
    href: '/roles',
    icon: KeyIcon,
    group: 'user-access',
    permission: { module: 'roles', action: 'view' },
  },

  // ── Staff Operations ───────────────────────────────────────────────────────
  {
    name: 'Rota Settings',
    description: 'Holiday year, default allowance, and notification email addresses',
    href: '/settings/rota',
    icon: UserGroupIcon,
    group: 'staff-ops',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Pay Bands',
    description: 'Manage age-based hourly pay rates with effective dates',
    href: '/settings/pay-bands',
    icon: BanknotesIcon,
    group: 'staff-ops',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Budgets',
    description: 'Set annual hours budgets per department for rota planning',
    href: '/settings/budgets',
    icon: ChartBarIcon,
    group: 'staff-ops',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Attachment Categories',
    description: 'Manage categories for employee file attachments',
    href: '/settings/categories',
    icon: TagIcon,
    group: 'staff-ops',
    permission: { module: 'settings', action: 'manage' },
  },

  // ── Events & Bookings ──────────────────────────────────────────────────────
  {
    name: 'Event Categories',
    description: 'Manage event categories and standardize event types',
    href: '/settings/event-categories',
    icon: CalendarDaysIcon,
    group: 'events-bookings',
    permission: { module: 'events', action: 'manage' },
  },
  {
    name: 'Calendar Notes',
    description: 'Add and generate important calendar dates with AI',
    href: '/settings/calendar-notes',
    icon: CalendarDaysIcon,
    group: 'events-bookings',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Business Hours',
    description: 'Manage regular opening hours and special dates',
    href: '/settings/business-hours',
    icon: ClockIcon,
    group: 'events-bookings',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Table Setup',
    description: 'Manage table names, numbers, capacities and joined-table rules',
    href: '/settings/table-bookings',
    icon: TableCellsIcon,
    group: 'events-bookings',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Private Booking Settings',
    description: 'Configure catering options, vendors, spaces and general defaults',
    href: '/private-bookings/settings',
    icon: BuildingOfficeIcon,
    group: 'events-bookings',
    permission: { module: 'private_bookings', action: 'manage' },
  },

  // ── Customers & Communications ─────────────────────────────────────────────
  {
    name: 'Customer Labels',
    description: 'Manage labels for customer segmentation and targeting',
    href: '/settings/customer-labels',
    icon: TagIcon,
    group: 'customers-comms',
    permission: { module: 'customers', action: 'manage' },
  },
  {
    name: 'Message Templates',
    description: 'Manage SMS message templates and customize content',
    href: '/settings/message-templates',
    icon: DocumentTextIcon,
    group: 'customers-comms',
    permission: { module: 'messages', action: 'manage_templates' },
  },
  {
    name: 'Import Messages from Twilio',
    description: 'Import historical SMS messages from your Twilio account',
    href: '/settings/import-messages',
    icon: ArrowDownTrayIcon,
    group: 'customers-comms',
    permission: { module: 'messages', action: 'manage' },
  },

  // ── Finance ────────────────────────────────────────────────────────────────
  {
    name: 'Menu GP Target',
    description: 'Set the standard GP% target applied to all dishes',
    href: '/settings/menu-target',
    icon: ChartBarIcon,
    group: 'finance',
    permission: { module: 'menu_management', action: 'manage' },
  },

  // ── Monitoring & Admin ─────────────────────────────────────────────────────
  {
    name: 'Audit Logs',
    description: 'View system audit logs for security and compliance',
    href: '/settings/audit-logs',
    icon: ShieldCheckIcon,
    group: 'monitoring',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Background Jobs',
    description: 'Monitor and manage background job processing',
    href: '/settings/background-jobs',
    icon: CpuChipIcon,
    group: 'monitoring',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'API Keys',
    description: 'Manage API keys for external integrations',
    href: '/settings/api-keys',
    icon: CommandLineIcon,
    group: 'monitoring',
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Short Links',
    description: 'Create and manage vip-club.uk short links',
    href: '/short-links',
    icon: LinkIcon,
    group: 'monitoring',
    permission: { module: 'short_links', action: 'view' },
  },
  {
    name: 'GDPR & Privacy',
    description: 'Export your data or manage privacy settings',
    href: '/settings/gdpr',
    icon: ShieldCheckIcon,
    group: 'monitoring',
    permission: null,
  },
];

const GROUP_CONFIG: Array<{ id: SettingsGroup; label: string }> = [
  { id: 'user-access', label: 'User & Access' },
  { id: 'staff-ops', label: 'Staff Operations' },
  { id: 'events-bookings', label: 'Events & Bookings' },
  { id: 'customers-comms', label: 'Customers & Communications' },
  { id: 'finance', label: 'Finance' },
  { id: 'monitoring', label: 'Monitoring & Admin' },
];

export default async function SettingsPage() {
  // Filter sections based on user permissions
  const visibleSections: SettingsItem[] = [];

  for (const section of settingsSections) {
    if (!section.permission) {
      visibleSections.push(section);
    } else {
      const hasPermission = await checkUserPermission(
        section.permission.module,
        section.permission.action
      );
      if (hasPermission) {
        visibleSections.push(section);
      }
    }
  }

  // Build groups using explicit group field (no fragile string matching)
  const sectionGroups = GROUP_CONFIG.map((groupConfig) => ({
    id: groupConfig.id,
    label: groupConfig.label,
    items: visibleSections.filter((s) => s.group === groupConfig.id),
  })).filter((g) => g.items.length > 0);

  return (
    <PageLayout
      title="Settings"
      subtitle="Manage application settings and configurations"
    >
      <div className="space-y-6">
        {sectionGroups.map((group) => (
          <Section key={group.id} id={group.id} title={group.label}>
            <SimpleList
              items={group.items.map((section) => ({
                id: section.href,
                href: section.href,
                title: section.name,
                subtitle: section.description,
                icon: <section.icon className="h-5 w-5 text-gray-400" />,
              }))}
            />
          </Section>
        ))}
      </div>
    </PageLayout>
  );
}
