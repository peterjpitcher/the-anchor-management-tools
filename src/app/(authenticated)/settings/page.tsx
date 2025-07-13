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
  SparklesIcon
} from '@heroicons/react/24/outline';
import { checkUserPermission } from '@/app/actions/rbac';
import type { ModuleName, ActionType } from '@/types/rbac';

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
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-4 sm:p-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-xs sm:text-sm text-gray-500">
            Manage application settings and configurations
          </p>
        </div>
      </div>

      {userManagementSections.length > 0 && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-base sm:text-lg font-medium text-gray-900">User Management</h2>
          </div>
          <ul role="list" className="divide-y divide-gray-200">
            {userManagementSections.map((section) => (
              <li key={section.href}>
                <Link href={section.href} className="block hover:bg-gray-50 px-4 py-3 sm:py-4 sm:px-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <section.icon className="h-5 w-5 sm:h-6 sm:w-6 text-gray-400" aria-hidden="true" />
                    </div>
                    <div className="ml-3 sm:ml-4 flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{section.name}</p>
                      <p className="text-xs sm:text-sm text-gray-500 line-clamp-2">{section.description}</p>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      <ChevronRightIcon className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" aria-hidden="true" />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {systemSettingsSections.length > 0 && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-base sm:text-lg font-medium text-gray-900">System Settings</h2>
          </div>
          <ul role="list" className="divide-y divide-gray-200">
            {systemSettingsSections.map((section) => (
              <li key={section.href}>
                <Link href={section.href} className="block hover:bg-gray-50 px-4 py-3 sm:py-4 sm:px-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <section.icon className="h-5 w-5 sm:h-6 sm:w-6 text-gray-400" aria-hidden="true" />
                    </div>
                    <div className="ml-3 sm:ml-4 flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{section.name}</p>
                      <p className="text-xs sm:text-sm text-gray-500 line-clamp-2">{section.description}</p>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      <ChevronRightIcon className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" aria-hidden="true" />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {monitoringSections.length > 0 && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-base sm:text-lg font-medium text-gray-900">Monitoring & Logs</h2>
          </div>
          <ul role="list" className="divide-y divide-gray-200">
            {monitoringSections.map((section) => (
              <li key={section.href}>
                <Link href={section.href} className="block hover:bg-gray-50 px-4 py-3 sm:py-4 sm:px-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <section.icon className="h-5 w-5 sm:h-6 sm:w-6 text-gray-400" aria-hidden="true" />
                    </div>
                    <div className="ml-3 sm:ml-4 flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{section.name}</p>
                      <p className="text-xs sm:text-sm text-gray-500 line-clamp-2">{section.description}</p>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      <ChevronRightIcon className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" aria-hidden="true" />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}