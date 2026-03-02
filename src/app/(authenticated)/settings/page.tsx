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
} from '@heroicons/react/24/outline';
import { checkUserPermission } from '@/app/actions/rbac';
import type { ModuleName, ActionType } from '@/types/rbac';
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { SimpleList } from '@/components/ui-v2/display/List';

const settingsSections = [
  // User Management Section
  {
    name: 'My Profile',
    description: 'View and edit your personal profile information',
    href: '/profile',
    icon: UserCircleIcon,
    permission: null, // Everyone can access their profile
  },
  {
    name: 'User Management',
    description: 'Manage users and their role assignments',
    href: '/users',
    icon: UsersIcon,
    permission: { module: 'users', action: 'view' },
  },
  {
    name: 'Role Management',
    description: 'Create and manage roles and permissions',
    href: '/roles',
    icon: KeyIcon,
    permission: { module: 'roles', action: 'view' },
  },
  // Rota / Staff Operations
  {
    name: 'Rota Settings',
    description: 'Holiday year, default allowance, and notification email addresses',
    href: '/settings/rota',
    icon: UserGroupIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Pay Bands',
    description: 'Manage age-based hourly pay rates with effective dates',
    href: '/settings/pay-bands',
    icon: BanknotesIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Budgets',
    description: 'Set annual hours budgets per department for rota planning',
    href: '/settings/budgets',
    icon: ChartBarIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  // System Settings Section
  {
    name: 'Event Categories',
    description: 'Manage event categories and standardize event types',
    href: '/settings/event-categories',
    icon: CalendarDaysIcon,
    permission: { module: 'events', action: 'manage' },
  },
  {
    name: 'Calendar Notes',
    description: 'Add and generate important calendar dates with AI',
    href: '/settings/calendar-notes',
    icon: CalendarDaysIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Business Hours',
    description: 'Manage regular opening hours and special dates',
    href: '/settings/business-hours',
    icon: ClockIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Table Setup',
    description: 'Manage table names, numbers, capacities and joined-table rules',
    href: '/settings/table-bookings',
    icon: TableCellsIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Menu GP Target',
    description: 'Set the standard GP% target applied to all dishes',
    href: '/settings/menu-target',
    icon: ChartBarIcon,
    permission: { module: 'menu_management', action: 'manage' },
  },
  {
    name: 'Attachment Categories',
    description: 'Manage categories for employee file attachments',
    href: '/settings/categories',
    icon: TagIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Customer Labels',
    description: 'Manage labels for customer segmentation and targeting',
    href: '/settings/customer-labels',
    icon: TagIcon,
    permission: { module: 'customers', action: 'manage' },
  },
  {
    name: 'Message Templates',
    description: 'Manage SMS message templates and customize content',
    href: '/settings/message-templates',
    icon: DocumentTextIcon,
    permission: { module: 'messages', action: 'manage_templates' },
  },
  {
    name: 'Import Messages from Twilio',
    description: 'Import historical SMS messages from your Twilio account',
    href: '/settings/import-messages',
    icon: ArrowDownTrayIcon,
    permission: { module: 'messages', action: 'manage' },
  },
  // Monitoring Section
  {
    name: 'Audit Logs',
    description: 'View system audit logs for security and compliance',
    href: '/settings/audit-logs',
    icon: ShieldCheckIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Background Jobs',
    description: 'Monitor and manage background job processing',
    href: '/settings/background-jobs',
    icon: CpuChipIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'API Keys',
    description: 'Manage API keys for external integrations',
    href: '/settings/api-keys',
    icon: CommandLineIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Short Links',
    description: 'Create and manage vip-club.uk short links',
    href: '/short-links',
    icon: LinkIcon,
    permission: null, // Allow all authenticated users
  },
  {
    name: 'GDPR & Privacy',
    description: 'Export your data or manage privacy settings',
    href: '/settings/gdpr',
    icon: ShieldCheckIcon,
    permission: null, // Everyone can access their own data
  },
];

export default async function SettingsPage() {
  // Filter sections based on user permissions
  const visibleSections = [];
  
  for (const section of settingsSections) {
    if (!section.permission) {
      // No permission required (like profile)
      visibleSections.push(section);
    } else {
      // Check if user has permission
      const hasPermission = await checkUserPermission(
        section.permission.module as ModuleName,
        section.permission.action as ActionType
      );
      if (hasPermission) {
        visibleSections.push(section);
      }
    }
  }

  // Group sections by category for rendering and navigation
  const sectionGroups = [
    {
      id: 'user-management',
      label: 'User Management',
      items: visibleSections.filter(
        (section) =>
          section.href === '/profile' || section.href === '/users' || section.href === '/roles'
      ),
    },
    {
      id: 'rota',
      label: 'Staff Operations',
      items: visibleSections.filter(
        (section) =>
          section.href === '/settings/rota' ||
          section.href === '/settings/pay-bands' ||
          section.href === '/settings/budgets'
      ),
    },
    {
      id: 'system-settings',
      label: 'System Settings',
      items: visibleSections.filter(
        (section) =>
          section.href.includes('/settings/') &&
          section.href !== '/settings/rota' &&
          section.href !== '/settings/pay-bands' &&
          section.href !== '/settings/budgets' &&
          !section.name.includes('SMS') &&
          !section.name.includes('Audit') &&
          !section.name.includes('API Keys') &&
          !section.name.includes('Twilio') &&
          !section.name.includes('Cron')
      ),
    },
    {
      id: 'monitoring',
      label: 'Monitoring & Logs',
      items: visibleSections.filter(
        (section) =>
          section.name.includes('SMS') ||
          section.name.includes('Audit') ||
          section.name.includes('API Keys') ||
          section.name.includes('Twilio') ||
          section.name.includes('Cron')
      ),
    },
  ].filter((group) => group.items.length > 0);

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
