import Link from 'next/link';
import { 
  TagIcon, 
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
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
  PlayIcon,
  SparklesIcon,
  LinkIcon
} from '@heroicons/react/24/outline';
import { checkUserPermission } from '@/app/actions/rbac';
import type { ModuleName, ActionType } from '@/types/rbac';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { List, SimpleList } from '@/components/ui-v2/display/List';

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
  // System Settings Section
  {
    name: 'Event Categories',
    description: 'Manage event categories and standardize event types',
    href: '/settings/event-categories',
    icon: CalendarDaysIcon,
    permission: { module: 'events', action: 'manage' },
  },
  {
    name: 'Business Hours',
    description: 'Manage regular opening hours and special dates',
    href: '/settings/business-hours',
    icon: ClockIcon,
    permission: { module: 'settings', action: 'manage' },
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
    name: 'Loyalty Program',
    description: 'Configure The Anchor VIP Club loyalty program settings',
    href: '/settings/loyalty',
    icon: SparklesIcon,
    permission: { module: 'settings', action: 'manage' },
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
    name: 'SMS Delivery Statistics',
    description: 'Monitor SMS delivery performance and manage customer messaging',
    href: '/settings/sms-delivery',
    icon: ChatBubbleLeftRightIcon,
    permission: { module: 'sms_health', action: 'view' },
  },
  {
    name: 'SMS Health Dashboard',
    description: 'Advanced delivery tracking with automatic deactivation management',
    href: '/settings/sms-health',
    icon: ShieldCheckIcon,
    permission: { module: 'sms_health', action: 'view' },
  },
  {
    name: 'Twilio Messages Monitor',
    description: 'View actual messages from Twilio and compare with database records',
    href: '/settings/twilio-messages',
    icon: ChatBubbleLeftRightIcon,
    permission: { module: 'messages', action: 'view' },
  },
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
    name: 'Calendar Test',
    description: 'Test Google Calendar integration and debug connection issues',
    href: '/settings/calendar-test',
    icon: CalendarDaysIcon,
    permission: { module: 'settings', action: 'manage' },
  },
  {
    name: 'Sync Employee Birthdays',
    description: 'Sync all employee birthdays to Google Calendar',
    href: '/settings/sync-birthdays',
    icon: CalendarDaysIcon,
    permission: { module: 'employees', action: 'manage' },
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
    href: '/settings/short-links',
    icon: LinkIcon,
    permission: null, // Allow all authenticated users
  },
  {
    name: 'Cron Job Testing',
    description: 'Manually trigger cron jobs for testing purposes',
    href: '/settings/cron-test',
    icon: PlayIcon,
    permission: { module: 'settings', action: 'manage' },
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

  // Group sections by category
  const userManagementSections = visibleSections.filter(s => 
    s.href === '/profile' || s.href === '/users' || s.href === '/roles'
  );
  const systemSettingsSections = visibleSections.filter(s => 
    s.href.includes('/settings/') && !s.name.includes('SMS') && !s.name.includes('Audit') && !s.name.includes('API Keys') && !s.name.includes('Twilio') && !s.name.includes('Cron')
  );
  const monitoringSections = visibleSections.filter(s => 
    s.name.includes('SMS') || s.name.includes('Audit') || s.name.includes('API Keys') || s.name.includes('Twilio') || s.name.includes('Cron')
  );

  return (
    <Page
      title="Settings"
      description="Manage application settings and configurations"
    >

      {userManagementSections.length > 0 && (
        <Section title="User Management">
          <SimpleList
            items={userManagementSections.map((section) => ({
              id: section.href,
              href: section.href,
              title: section.name,
              subtitle: section.description,
              icon: <section.icon className="h-5 w-5 text-gray-400" />,
              meta: <ChevronRightIcon className="h-5 w-5 text-gray-400" />,
            }))}
          />
        </Section>
      )}

      {systemSettingsSections.length > 0 && (
        <Section title="System Settings">
          <SimpleList
            items={systemSettingsSections.map((section) => ({
              id: section.href,
              href: section.href,
              title: section.name,
              subtitle: section.description,
              icon: <section.icon className="h-5 w-5 text-gray-400" />,
              meta: <ChevronRightIcon className="h-5 w-5 text-gray-400" />,
            }))}
          />
        </Section>
      )}

      {monitoringSections.length > 0 && (
        <Section title="Monitoring & Logs">
          <SimpleList
            items={monitoringSections.map((section) => ({
              id: section.href,
              href: section.href,
              title: section.name,
              subtitle: section.description,
              icon: <section.icon className="h-5 w-5 text-gray-400" />,
              meta: <ChevronRightIcon className="h-5 w-5 text-gray-400" />,
            }))}
          />
        </Section>
      )}
    </Page>
  );
}