'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarIcon,
  UserGroupIcon,
  HomeIcon,
  IdentificationIcon,
  PencilSquareIcon,
  CogIcon,
  EnvelopeIcon,
  BuildingOfficeIcon,
  DocumentTextIcon,
  LinkIcon,
  QueueListIcon,
  ReceiptRefundIcon,
  TruckIcon,
  Squares2X2Icon,
  MicrophoneIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline'
import { useMemo, useState } from 'react'
import { usePermissions } from '@/contexts/PermissionContext'
import { Badge } from '@/components/ui-v2/display/Badge'
import type { ModuleName, ActionType } from '@/types/rbac'
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount'
import Image from 'next/image'
import { cn } from '@/lib/utils'

type NavigationItemWithPermission = {
  name: string;
  href: string;
  icon: React.ElementType;
  action?: boolean;
  permission?: { module: ModuleName; action: ActionType };
};

type NavigationGroup = {
  name: string;
  items: NavigationItemWithPermission[];
}

// Define groups
export const navigationGroups: NavigationGroup[] = [
  {
    name: 'Overview',
    items: [
      { name: 'Dashboard', href: '/', icon: HomeIcon, permission: { module: 'dashboard', action: 'view' } },
    ]
  },
  {
    name: 'Operations',
    items: [
      { name: 'Events', href: '/events', icon: CalendarIcon, permission: { module: 'events', action: 'view' } },
      { name: 'Table Bookings', href: '/table-bookings', icon: QueueListIcon, permission: { module: 'table_bookings', action: 'view' } },
      { name: 'Private Bookings', href: '/private-bookings', icon: BuildingOfficeIcon, permission: { module: 'private_bookings', action: 'view' } },
      { name: 'Parking', href: '/parking', icon: TruckIcon, permission: { module: 'parking', action: 'view' } },
    ]
  },
  {
    name: 'People',
    items: [
      { name: 'Customers', href: '/customers', icon: UserGroupIcon, permission: { module: 'customers', action: 'view' } },
      { name: 'Performers', href: '/performers', icon: MicrophoneIcon, permission: { module: 'performers', action: 'view' } },
      { name: 'Employees', href: '/employees', icon: IdentificationIcon, permission: { module: 'employees', action: 'view' } },
      { name: 'Messages', href: '/messages', icon: EnvelopeIcon, permission: { module: 'messages', action: 'view' } },
    ]
  },
  {
    name: 'Finance',
    items: [
      { name: 'Invoices', href: '/invoices', icon: DocumentTextIcon, permission: { module: 'invoices', action: 'view' } },
      { name: 'Receipts', href: '/receipts', icon: ReceiptRefundIcon, permission: { module: 'receipts', action: 'view' } },
    ]
  },
  {
    name: 'System',
    items: [
      { name: 'Menu', href: '/menu-management', icon: Squares2X2Icon, permission: { module: 'menu_management', action: 'view' } },
      { name: 'Short Links', href: '/short-links', icon: LinkIcon, permission: { module: 'short_links', action: 'view' } },
      { name: 'Settings', href: '/settings', icon: CogIcon, permission: { module: 'settings', action: 'view' } },
    ]
  }
];

interface ModernSidebarProps {
  onQuickAddNoteClick: () => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  className?: string;
}

export function ModernSidebar({ onQuickAddNoteClick, collapsed, setCollapsed, className }: ModernSidebarProps) {
  const pathname = usePathname() ?? '/'
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const unreadCount = useUnreadMessageCount()

  // Filter groups based on permissions
  const filteredGroups = useMemo(() => {
    if (permissionsLoading) return [];

    return navigationGroups.map(group => ({
      ...group,
      items: group.items.filter(item =>
        !item.permission || hasPermission(item.permission.module, item.permission.action)
      )
    })).filter(group => group.items.length > 0);
  }, [hasPermission, permissionsLoading]);

  if (permissionsLoading) {
    return (
      <div className={cn("h-full bg-sidebar flex flex-col transition-all duration-300", collapsed ? "w-20" : "w-64", className)}>
        <div className="p-4">
          <div className="h-8 w-8 bg-green-700/50 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar h-full border-r border-green-800 transition-all duration-300 ease-in-out relative",
        collapsed ? "w-20" : "w-64",
        className
      )}
    >
      {/* Header / Logo */}
      <div className="h-16 flex items-center px-4 border-b border-green-800/50 shrink-0 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8 shrink-0">
            <Image
              src="/logo.png"
              alt="Logo"
              width={32}
              height={32}
              className="object-contain"
            />
          </div>
          <span className={cn(
            "font-bold text-white text-lg whitespace-nowrap transition-opacity duration-300",
            collapsed ? "opacity-0 w-0" : "opacity-100"
          )}>
            Management
          </span>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 bg-green-700 border border-green-600 rounded-full p-1 text-green-100 hover:text-white shadow-sm z-10 hidden md:block"
      >
        {collapsed ? <ChevronRightIcon className="w-3 h-3" /> : <ChevronLeftIcon className="w-3 h-3" />}
      </button>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6 scrollbar-thin scrollbar-thumb-green-800 scrollbar-track-transparent">
        {/* Quick Action - Add Note */}
        <button
          onClick={onQuickAddNoteClick}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-green-100 hover:bg-green-700/50 hover:text-white transition-colors group",
            collapsed ? "justify-center" : ""
          )}
          title="Quick Add Note"
        >
          <PencilSquareIcon className="w-6 h-6 shrink-0" />
          <span className={cn(
            "font-medium whitespace-nowrap transition-all duration-300 overflow-hidden",
            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}>
            Quick Note
          </span>
        </button>

        {/* Navigation Groups */}
        {filteredGroups.map((group) => (
          <div key={group.name}>
            <h3 className={cn(
              "px-3 mb-2 text-xs font-semibold text-green-300/70 uppercase tracking-wider transition-all duration-300",
              collapsed ? "opacity-0 h-0 mb-0 overflow-hidden" : "opacity-100"
            )}>
              {group.name}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group relative",
                      isActive
                        ? "bg-green-700 text-white shadow-sm"
                        : "text-green-100 hover:bg-green-700/50 hover:text-white",
                      collapsed ? "justify-center" : ""
                    )}
                    title={collapsed ? item.name : undefined}
                  >
                    <item.icon className={cn(
                      "w-6 h-6 shrink-0 transition-colors",
                      isActive ? "text-white" : "text-green-200 group-hover:text-white"
                    )} />

                    <span className={cn(
                      "font-medium whitespace-nowrap transition-all duration-300 overflow-hidden",
                      collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                    )}>
                      {item.name}
                    </span>

                    {/* Badges (like Unread Messages) */}
                    {item.name === 'Messages' && unreadCount > 0 && (
                      <div className={cn(
                        "ml-auto",
                        collapsed ? "absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-sidebar" : ""
                      )}>
                        {collapsed ? null : (
                          <Badge variant="error" size="sm" className="h-5 min-w-[1.25rem] flex items-center justify-center px-1">
                            {unreadCount}
                          </Badge>
                        )}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
