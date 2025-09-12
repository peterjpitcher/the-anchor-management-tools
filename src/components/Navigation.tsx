'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarIcon, UserGroupIcon, HomeIcon, IdentificationIcon, PencilSquareIcon, CogIcon, EnvelopeIcon, BuildingOfficeIcon, DocumentTextIcon, StarIcon, LinkIcon, QueueListIcon } from '@heroicons/react/24/outline'
import { useEffect, useState, useMemo } from 'react'
import { getUnreadMessageCount } from '@/app/actions/messagesActions'
import { usePermissions } from '@/contexts/PermissionContext'
import { Badge } from '@/components/ui-v2/display/Badge'
import type { ModuleName, ActionType } from '@/types/rbac'

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
  { name: 'Customers', href: '/customers', icon: UserGroupIcon, permission: { module: 'customers', action: 'view' } },
  { name: 'Messages', href: '/messages', icon: EnvelopeIcon, permission: { module: 'messages', action: 'view' } },
];

const secondaryNavigation: NavigationItemWithPermission[] = [
  { name: 'Table Bookings', href: '/table-bookings', icon: QueueListIcon, permission: { module: 'table_bookings', action: 'view' } },
  { name: 'Private Bookings', href: '/private-bookings', icon: BuildingOfficeIcon, permission: { module: 'private_bookings', action: 'view' } },
  // VIP Club removed
];

const tertiaryNavigation: NavigationItemWithPermission[] = [
  { name: 'Employees', href: '/employees', icon: IdentificationIcon, permission: { module: 'employees', action: 'view' } },
  { name: 'Quick Add Note', href: '#', icon: PencilSquareIcon, action: true },
];

const quaternaryNavigation: NavigationItemWithPermission[] = [
  { name: 'Invoices', href: '/invoices', icon: DocumentTextIcon, permission: { module: 'invoices', action: 'view' } },
  { name: 'Short Links', href: '/short-links', icon: LinkIcon },
  { name: 'Settings', href: '/settings', icon: CogIcon, permission: { module: 'settings', action: 'view' } },
];

interface NavigationProps {
  onQuickAddNoteClick: () => void;
  onNavigate?: () => void;
}

export function Navigation({ onQuickAddNoteClick, onNavigate }: NavigationProps) {
  const pathname = usePathname()
  const [unreadCount, setUnreadCount] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const { hasPermission, loading: permissionsLoading } = usePermissions()

  useEffect(() => {
    // Load unread count on mount
    async function loadUnreadCount() {
      const result = await getUnreadMessageCount()
      setUnreadCount(result.badge)
    }
    
    loadUnreadCount()
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      loadUnreadCount()
    }, 30000)
    
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Check if mobile on mount and window resize
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640) // 640px is Tailwind's 'sm' breakpoint
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Filter navigation items based on permissions
  const filteredPrimaryNav = useMemo(() => {
    if (permissionsLoading) return [];
    return primaryNavigation.filter(item => 
      !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
  }, [hasPermission, permissionsLoading]);

  const filteredSecondaryNav = useMemo(() => {
    if (permissionsLoading) return [];
    return secondaryNavigation.filter(item => {
      // Hide VIP Club on mobile
      if (isMobile && item.name === 'VIP Club') {
        return false;
      }
      return !item.permission || hasPermission(item.permission.module, item.permission.action);
    });
  }, [hasPermission, permissionsLoading, isMobile]);

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

  const renderNavItem = (item: NavigationItemWithPermission) => {
    const isActive = !item.action && item.href === '/' 
      ? pathname === '/'
      : !item.action && pathname.startsWith(item.href);

    if (item.action && item.name === 'Quick Add Note') {
      return (
        <button
          key={item.name}
          onClick={onQuickAddNoteClick}
          className={`
            group flex items-center px-2 py-2 text-sm font-medium rounded-md w-full
            text-gray-100 hover:bg-green-700 hover:text-white
            focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-sidebar
          `}
        >
          <item.icon
            className={`mr-3 h-6 w-6 text-green-200 group-hover:text-white`}
            aria-hidden="true"
          />
          {item.name}
        </button>
      );
    }

    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={onNavigate}
        className={`
          group flex items-center px-2 py-2 text-sm font-medium rounded-md
          ${isActive
            ? 'bg-green-700 text-white' 
            : 'text-gray-100 hover:bg-green-700 hover:text-white'
          }
        `}
      >
        <item.icon
          className={`
            mr-3 h-6 w-6
            ${isActive
              ? 'text-white'
              : 'text-green-200 group-hover:text-white'
            }
          `}
          aria-hidden="true"
        />
        {item.name}
        {item.name === 'Messages' && unreadCount > 0 && (
          <Badge variant="error" className="ml-auto">
            {unreadCount}
          </Badge>
        )}
      </Link>
    );
  }

  if (permissionsLoading) {
    return (
      <nav className="space-y-1 px-2">
        <div className="animate-pulse space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 bg-green-700 rounded opacity-50"></div>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav className="space-y-1 px-2">
      {filteredPrimaryNav.map(renderNavItem)}
      
      {/* Only show divider if there are items in both sections */}
      {filteredPrimaryNav.length > 0 && filteredSecondaryNav.length > 0 && (
        <div className="pt-2 pb-1">
          <hr className="border-t border-green-600 opacity-75" />
        </div>
      )}
      
      {filteredSecondaryNav.map(renderNavItem)}
      
      {/* Divider between secondary and tertiary */}
      {filteredSecondaryNav.length > 0 && filteredTertiaryNav.length > 0 && (
        <div className="pt-2 pb-1">
          <hr className="border-t border-green-600 opacity-75" />
        </div>
      )}
      
      {filteredTertiaryNav.map(renderNavItem)}
      
      {/* Divider between tertiary and quaternary */}
      {filteredTertiaryNav.length > 0 && filteredQuaternaryNav.length > 0 && (
        <div className="pt-2 pb-1">
          <hr className="border-t border-green-600 opacity-75" />
        </div>
      )}
      
      {filteredQuaternaryNav.map(renderNavItem)}
    </nav>
  )
} 
