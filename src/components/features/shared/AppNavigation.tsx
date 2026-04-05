'use client'

import { usePathname } from 'next/navigation'
import { CalendarIcon, UserGroupIcon, HomeIcon, IdentificationIcon, PencilSquareIcon, CogIcon, EnvelopeIcon, BuildingOfficeIcon, DocumentTextIcon, LinkIcon, ReceiptRefundIcon, TruckIcon, Squares2X2Icon, BanknotesIcon, MicrophoneIcon, BriefcaseIcon, CalendarDaysIcon, UserCircleIcon, UsersIcon, ShieldCheckIcon, DocumentDuplicateIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/contexts/PermissionContext'
import { Badge } from '@/components/ui-v2/display/Badge'
import type { ModuleName, ActionType } from '@/types/rbac'
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount'
import { useOutstandingCounts } from '@/hooks/useOutstandingCounts'
import { Sidebar, SidebarGroup, SidebarItem } from '@/components/ui-v2/navigation'

type NavigationItemWithPermission = {
  name: string;
  href: string;
  icon: React.ElementType;
  action?: boolean;
  permission?: { module: ModuleName; action: ActionType };
  subItem?: boolean;
};

const primaryNavigation: NavigationItemWithPermission[] = [
  { name: 'Dashboard', href: '/', icon: HomeIcon, permission: { module: 'dashboard', action: 'view' } },
  { name: 'Events', href: '/events', icon: CalendarIcon, permission: { module: 'events', action: 'view' } },
  { name: 'Performers', href: '/performers', icon: MicrophoneIcon, permission: { module: 'performers', action: 'view' } },
  { name: 'Customers', href: '/customers', icon: UserGroupIcon, permission: { module: 'customers', action: 'view' } },
  { name: 'Messages', href: '/messages', icon: EnvelopeIcon, permission: { module: 'messages', action: 'view' } },
];

const secondaryNavigation: NavigationItemWithPermission[] = [
  { name: 'Menu Management', href: '/menu-management', icon: Squares2X2Icon, permission: { module: 'menu_management', action: 'view' } },
  { name: 'Table Bookings', href: '/table-bookings', icon: CalendarIcon, permission: { module: 'table_bookings', action: 'view' } },
  { name: 'Private Bookings', href: '/private-bookings', icon: BuildingOfficeIcon, permission: { module: 'private_bookings', action: 'view' } },
  { name: 'Parking', href: '/parking', icon: TruckIcon, permission: { module: 'parking', action: 'view' } },
];

// Staff ops group: Employees, Rota (+ sub-pages), Quick Add Note
const staffOpsNavigation: NavigationItemWithPermission[] = [
  { name: 'Employees', href: '/employees', icon: IdentificationIcon, permission: { module: 'employees', action: 'view' } },
  { name: 'Rota', href: '/rota', icon: CalendarDaysIcon, permission: { module: 'rota', action: 'view' } },
  { name: 'Leave', href: '/rota/leave', icon: CalendarDaysIcon, permission: { module: 'leave', action: 'view' }, subItem: true },
  { name: 'Timeclock', href: '/rota/timeclock', icon: CalendarDaysIcon, permission: { module: 'timeclock', action: 'view' }, subItem: true },
  { name: 'Labour Costs', href: '/rota/dashboard', icon: CalendarDaysIcon, permission: { module: 'rota', action: 'view' }, subItem: true },
  { name: 'Payroll', href: '/rota/payroll', icon: CalendarDaysIcon, permission: { module: 'payroll', action: 'view' }, subItem: true },
  { name: 'Templates', href: '/rota/templates', icon: CalendarDaysIcon, permission: { module: 'rota', action: 'view' }, subItem: true },
  { name: 'Quick Add Note', href: '#', icon: PencilSquareIcon, action: true, permission: { module: 'settings', action: 'manage' } },
];

// Finance group: Cashing Up (+ sub-pages), Invoices, Quotes, OJ Projects, Receipts, Short Links, Settings
const financeNavigation: NavigationItemWithPermission[] = [
  { name: 'Cashing Up', href: '/cashing-up/dashboard', icon: BanknotesIcon, permission: { module: 'cashing_up', action: 'view' } },
  { name: 'Daily Entry', href: '/cashing-up/daily', icon: BanknotesIcon, permission: { module: 'cashing_up', action: 'view' }, subItem: true },
  { name: 'Weekly', href: '/cashing-up/weekly', icon: BanknotesIcon, permission: { module: 'cashing_up', action: 'view' }, subItem: true },
  { name: 'Insights', href: '/cashing-up/insights', icon: BanknotesIcon, permission: { module: 'cashing_up', action: 'view' }, subItem: true },
  { name: 'Import', href: '/cashing-up/import', icon: BanknotesIcon, permission: { module: 'cashing_up', action: 'view' }, subItem: true },
  { name: 'Invoices', href: '/invoices', icon: DocumentTextIcon, permission: { module: 'invoices', action: 'view' } },
  { name: 'Quotes', href: '/quotes', icon: DocumentDuplicateIcon, permission: { module: 'invoices', action: 'view' }, subItem: true },
  { name: 'OJ Projects', href: '/oj-projects', icon: BriefcaseIcon, permission: { module: 'oj_projects', action: 'view' } },
  { name: 'Projects', href: '/oj-projects/projects', icon: BriefcaseIcon, permission: { module: 'oj_projects', action: 'view' }, subItem: true },
  { name: 'Clients', href: '/oj-projects/clients', icon: BriefcaseIcon, permission: { module: 'oj_projects', action: 'view' }, subItem: true },
  { name: 'Work Types', href: '/oj-projects/work-types', icon: BriefcaseIcon, permission: { module: 'oj_projects', action: 'view' }, subItem: true },
  { name: 'Time Entries', href: '/oj-projects/entries', icon: BriefcaseIcon, permission: { module: 'oj_projects', action: 'view' }, subItem: true },
  { name: 'Receipts', href: '/receipts', icon: ReceiptRefundIcon, permission: { module: 'receipts', action: 'view' } },
  { name: 'Expenses', href: '/expenses', icon: BanknotesIcon, permission: { module: 'expenses', action: 'view' } },
  { name: 'Short Links', href: '/short-links', icon: LinkIcon, permission: { module: 'short_links', action: 'view' } },
];

// Settings & admin group
const settingsNavigation: NavigationItemWithPermission[] = [
  { name: 'Settings', href: '/settings', icon: CogIcon, permission: { module: 'settings', action: 'view' } },
  // Business
  { name: 'Business Hours', href: '/settings/business-hours', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Calendar Notes', href: '/settings/calendar-notes', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Categories', href: '/settings/categories', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Event Categories', href: '/settings/event-categories', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Table Bookings', href: '/settings/table-bookings', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Menu Target', href: '/settings/menu-target', icon: CogIcon, permission: { module: 'menu_management', action: 'manage' }, subItem: true },
  // Staff
  { name: 'Pay Bands', href: '/settings/pay-bands', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Rota Settings', href: '/settings/rota', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Budgets', href: '/settings/budgets', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Customer Labels', href: '/settings/customer-labels', icon: CogIcon, permission: { module: 'customers', action: 'manage' }, subItem: true },
  // System
  { name: 'Message Templates', href: '/settings/message-templates', icon: CogIcon, permission: { module: 'messages', action: 'manage_templates' }, subItem: true },
  { name: 'Import Messages', href: '/settings/import-messages', icon: CogIcon, permission: { module: 'messages', action: 'manage' }, subItem: true },
  { name: 'API Keys', href: '/settings/api-keys', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Audit Logs', href: '/settings/audit-logs', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'Background Jobs', href: '/settings/background-jobs', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  { name: 'GDPR', href: '/settings/gdpr', icon: CogIcon, permission: { module: 'settings', action: 'manage' }, subItem: true },
  // Admin pages
  { name: 'Users', href: '/users', icon: UsersIcon, permission: { module: 'users', action: 'view' } },
  { name: 'Roles', href: '/roles', icon: ShieldCheckIcon, permission: { module: 'roles', action: 'view' } },
  { name: 'My Profile', href: '/profile', icon: UserCircleIcon },
];

interface AppNavigationProps {
  onQuickAddNoteClick: () => void;
  onNavigate?: () => void;
}

type NavGroup = { parent: NavigationItemWithPermission; children: NavigationItemWithPermission[] };

function groupNavItems(items: NavigationItemWithPermission[]): NavGroup[] {
  const groups: NavGroup[] = [];
  let current: NavGroup | null = null;
  for (const item of items) {
    if (item.subItem) {
      current?.children.push(item);
    } else {
      current = { parent: item, children: [] };
      groups.push(current);
    }
  }
  return groups;
}

export function AppNavigation({ onQuickAddNoteClick, onNavigate }: AppNavigationProps) {
  const pathname = usePathname() ?? '/'

  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const expanded = new Set<string>();
    for (const section of [staffOpsNavigation, financeNavigation, settingsNavigation]) {
      let parentHref = '';
      for (const item of section) {
        if (!item.subItem) {
          parentHref = item.href;
        } else if (pathname.startsWith(item.href)) {
          expanded.add(parentHref);
        }
      }
    }
    return expanded;
  });

  const toggleSection = (parentHref: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(parentHref)) next.delete(parentHref);
      else next.add(parentHref);
      return next;
    });
  };

  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const unreadCount = useUnreadMessageCount()
  const { counts: outstandingCounts } = useOutstandingCounts()

  // Filter navigation items based on permissions
  const filteredPrimaryNav = useMemo(() => {
    if (permissionsLoading) return [];
    return primaryNavigation.filter(item =>
      !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
  }, [hasPermission, permissionsLoading]);

  const filteredSecondaryNav = useMemo(() => {
    if (permissionsLoading) return [];
    return secondaryNavigation.filter(item =>
      !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
  }, [hasPermission, permissionsLoading]);

  const filteredStaffOpsNav = useMemo(() => {
    if (permissionsLoading) return [];
    return staffOpsNavigation.filter(item =>
      !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
  }, [hasPermission, permissionsLoading]);

  const filteredFinanceNav = useMemo(() => {
    if (permissionsLoading) return [];
    return financeNavigation.filter(item =>
      !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
  }, [hasPermission, permissionsLoading]);

  const filteredSettingsNav = useMemo(() => {
    if (permissionsLoading) return [];
    return settingsNavigation.filter(item =>
      !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
  }, [hasPermission, permissionsLoading]);

  const getOutstandingCount = (name: string) => {
    if (!outstandingCounts) return 0
    switch (name) {
      case 'Events': return outstandingCounts.events
      case 'Menu Management': return outstandingCounts.menu_management
      case 'Table Bookings': return outstandingCounts.table_bookings
      case 'Private Bookings': return outstandingCounts.private_bookings
      case 'Parking': return outstandingCounts.parking
      case 'Cashing Up': return outstandingCounts.cashing_up
      case 'Invoices': return outstandingCounts.invoices
      case 'Receipts': return outstandingCounts.receipts
      default: return 0
    }
  }

  const isItemActive = (item: NavigationItemWithPermission): boolean => {
    if (item.action) return false;
    if (item.href === '/') return pathname === '/';
    return pathname.startsWith(item.href);
  };

  const getBadge = (item: NavigationItemWithPermission): React.ReactNode => {
    if (item.name === 'Messages' && unreadCount > 0) {
      return <Badge variant="error" className="ml-auto">{unreadCount}</Badge>;
    }
    const count = getOutstandingCount(item.name);
    if (count > 0) {
      return <Badge variant="warning" className="ml-auto">{count}</Badge>;
    }
    return null;
  };

  const renderNavItem = (item: NavigationItemWithPermission) => {
    const isActive = isItemActive(item);
    const badge = getBadge(item);

    if (item.action && item.name === 'Quick Add Note') {
      return (
        <SidebarItem
          key={item.name}
          onClick={onQuickAddNoteClick}
          icon={item.icon}
        >
          {item.name}
        </SidebarItem>
      );
    }

    if (item.subItem) {
      return (
        <SidebarItem
          key={item.name}
          href={item.href}
          onClick={onNavigate}
          icon={item.icon}
          active={isActive}
          badge={badge}
          className="pl-8 text-xs"
        >
          {item.name}
        </SidebarItem>
      );
    }

    return (
      <SidebarItem
        key={item.name}
        href={item.href}
        onClick={onNavigate}
        icon={item.icon}
        active={isActive}
        badge={badge}
      >
        {item.name}
      </SidebarItem>
    );
  };

  const renderNavGroup = (group: NavGroup) => {
    const { parent, children } = group;
    const hasChildren = children.length > 0;

    if (!hasChildren) {
      return renderNavItem(parent);
    }

    const isExpanded = expandedSections.has(parent.href);
    const isActive = isItemActive(parent);
    const badge = getBadge(parent);

    const rightSlot = (
      <span className="flex items-center gap-1 ml-auto">
        {badge}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSection(parent.href);
          }}
          className="rounded p-0.5 hover:bg-green-600"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRightIcon
            className={cn(
              'h-4 w-4 flex-shrink-0 transition-transform duration-150',
              isExpanded && 'rotate-90'
            )}
          />
        </button>
      </span>
    );

    return (
      <div key={parent.name}>
        <SidebarItem
          href={parent.href}
          onClick={onNavigate}
          icon={parent.icon}
          active={isActive}
          badge={rightSlot}
        >
          {parent.name}
        </SidebarItem>
        {isExpanded && children.map(renderNavItem)}
      </div>
    );
  };

  if (permissionsLoading) {
    return (
      <Sidebar>
        <div className="animate-pulse space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 bg-green-700 rounded opacity-50"></div>
          ))}
        </div>
      </Sidebar>
    );
  }

  return (
    <Sidebar>
      <SidebarGroup>
        {filteredPrimaryNav.map(renderNavItem)}
      </SidebarGroup>

      {filteredSecondaryNav.length > 0 && (
        <SidebarGroup showDivider={filteredPrimaryNav.length > 0}>
          {filteredSecondaryNav.map(renderNavItem)}
        </SidebarGroup>
      )}

      {filteredStaffOpsNav.length > 0 && (
        <SidebarGroup showDivider={filteredPrimaryNav.length > 0 || filteredSecondaryNav.length > 0}>
          {groupNavItems(filteredStaffOpsNav).map(renderNavGroup)}
        </SidebarGroup>
      )}

      {filteredFinanceNav.length > 0 && (
        <SidebarGroup showDivider={filteredPrimaryNav.length > 0 || filteredSecondaryNav.length > 0 || filteredStaffOpsNav.length > 0}>
          {groupNavItems(filteredFinanceNav).map(renderNavGroup)}
        </SidebarGroup>
      )}

      {filteredSettingsNav.length > 0 && (
        <SidebarGroup showDivider={filteredPrimaryNav.length > 0 || filteredSecondaryNav.length > 0 || filteredStaffOpsNav.length > 0 || filteredFinanceNav.length > 0}>
          {groupNavItems(filteredSettingsNav).map(renderNavGroup)}
        </SidebarGroup>
      )}
    </Sidebar>
  )
}
