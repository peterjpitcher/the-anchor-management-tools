'use client'

import { usePathname } from 'next/navigation'
import { CalendarIcon, UserGroupIcon, HomeIcon, IdentificationIcon, PencilSquareIcon, CogIcon, EnvelopeIcon, BuildingOfficeIcon, DocumentTextIcon, LinkIcon, ReceiptRefundIcon, TruckIcon, Squares2X2Icon, BanknotesIcon, MicrophoneIcon, BriefcaseIcon } from '@heroicons/react/24/outline'
import { useMemo } from 'react'
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

const tertiaryNavigation: NavigationItemWithPermission[] = [
  { name: 'Employees', href: '/employees', icon: IdentificationIcon, permission: { module: 'employees', action: 'view' } },
  { name: 'Quick Add Note', href: '#', icon: PencilSquareIcon, action: true },
];

const quaternaryNavigation: NavigationItemWithPermission[] = [
  { name: 'Cashing Up', href: '/cashing-up/dashboard', icon: BanknotesIcon, permission: { module: 'cashing_up', action: 'view' } },
  { name: 'Invoices', href: '/invoices', icon: DocumentTextIcon, permission: { module: 'invoices', action: 'view' } },
  { name: 'OJ Projects', href: '/oj-projects', icon: BriefcaseIcon, permission: { module: 'oj_projects', action: 'view' } },
  { name: 'Receipts', href: '/receipts', icon: ReceiptRefundIcon, permission: { module: 'receipts', action: 'view' } },
  { name: 'Short Links', href: '/short-links', icon: LinkIcon },
  { name: 'Settings', href: '/settings', icon: CogIcon, permission: { module: 'settings', action: 'view' } },
];

interface AppNavigationProps {
  onQuickAddNoteClick: () => void;
  onNavigate?: () => void;
}

export function AppNavigation({ onQuickAddNoteClick, onNavigate }: AppNavigationProps) {
  const pathname = usePathname() ?? '/'
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

  const filteredTertiaryNav = useMemo(() => {
    if (permissionsLoading) return [];
    return tertiaryNavigation.filter(item =>
      !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
  }, [hasPermission, permissionsLoading]);

  const filteredQuaternaryNav = useMemo(() => {
    if (permissionsLoading) return [];
    return quaternaryNavigation.filter(item =>
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

  const renderNavItem = (item: NavigationItemWithPermission) => {
    const isActive = !item.action && item.href === '/'
      ? pathname === '/'
      : !item.action && pathname.startsWith(item.href);

    let badge = null

    if (item.name === 'Messages' && unreadCount > 0) {
      badge = (
        <Badge variant="error" className="ml-auto">
          {unreadCount}
        </Badge>
      )
    } else {
      const count = getOutstandingCount(item.name)
      if (count > 0) {
        badge = (
          <Badge variant="warning" className="ml-auto">
            {count}
          </Badge>
        )
      }
    }

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
  }

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

      {filteredTertiaryNav.length > 0 && (
        <SidebarGroup showDivider={filteredSecondaryNav.length > 0}>
          {filteredTertiaryNav.map(renderNavItem)}
        </SidebarGroup>
      )}

      {filteredQuaternaryNav.length > 0 && (
        <SidebarGroup showDivider={filteredTertiaryNav.length > 0}>
          {filteredQuaternaryNav.map(renderNavItem)}
        </SidebarGroup>
      )}
    </Sidebar>
  )
}
