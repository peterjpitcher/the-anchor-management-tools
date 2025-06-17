'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, UserGroupIcon, HomeIcon, IdentificationIcon, PencilSquareIcon, EnvelopeIcon } from '@heroicons/react/24/outline'
import { useEffect, useState, useMemo } from 'react'
import { getUnreadMessageCount } from '@/app/actions/messagesActions'
import { usePermissions } from '@/contexts/PermissionContext'
import type { ModuleName, ActionType } from '@/types/rbac'

// ADDED Props interface
interface BottomNavigationProps {
  onQuickAddNoteClick: () => void;
}

export function BottomNavigation({ onQuickAddNoteClick }: BottomNavigationProps) { // ADDED onQuickAddNoteClick prop
  const pathname = usePathname()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    // Load unread count on mount
    async function loadUnreadCount() {
      const result = await getUnreadMessageCount()
      setUnreadCount(result.count)
    }
    
    loadUnreadCount()
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      loadUnreadCount()
    }, 30000)
    
    return () => clearInterval(interval)
  }, [])

  const isActive = (path: string) => path === '/' ? pathname === '/' : pathname.startsWith(path)

  // Define a type for navigation items that includes the optional 'action' property
  type NavigationItem = {
    name: string;
    href: string;
    icon: React.ElementType;
    action?: boolean; // Optional: to identify items that trigger actions
    permission?: { module: ModuleName; action: ActionType };
  };

  const { hasPermission, loading: permissionsLoading } = usePermissions()

  const allNavigationItems: NavigationItem[] = [
    { name: 'Home', href: '/', icon: HomeIcon, permission: { module: 'dashboard', action: 'view' } },
    { name: 'Events', href: '/events', icon: CalendarIcon, permission: { module: 'events', action: 'view' } },
    { name: 'Customers', href: '/customers', icon: UserGroupIcon, permission: { module: 'customers', action: 'view' } },
    { name: 'Messages', href: '/messages', icon: EnvelopeIcon, permission: { module: 'messages', action: 'view' } },
    { name: 'Employees', href: '/employees', icon: IdentificationIcon, permission: { module: 'employees', action: 'view' } },
  ]

  // Filter navigation items based on permissions
  const navigationItems = useMemo(() => {
    if (permissionsLoading) return [];
    return allNavigationItems.filter(item => 
      !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
  }, [hasPermission, permissionsLoading])

  if (permissionsLoading) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-white border-t border-gray-200 md:hidden">
        <div className="grid h-full max-w-lg grid-cols-5 mx-auto">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="inline-flex flex-col items-center justify-center px-2 sm:px-5">
              <div className="w-6 h-6 bg-gray-200 rounded animate-pulse"></div>
              <div className="w-12 h-3 bg-gray-200 rounded mt-1 animate-pulse"></div>
            </div>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-white border-t border-gray-200 md:hidden">
      <div className={`grid h-full max-w-lg grid-cols-${navigationItems.length} mx-auto`}>
        {navigationItems.map((item) => {
          if (item.action && item.name === 'Add Note') {
            return (
              <button
                key={item.name}
                onClick={onQuickAddNoteClick} // Use the passed prop
                className={`inline-flex flex-col items-center justify-center px-2 sm:px-5 hover:bg-gray-50 text-gray-500 hover:text-gray-900 w-full h-full`}
              >
                <item.icon className="w-5 h-5 sm:w-6 sm:h-6" />
                <span className="text-xs sm:text-sm">{item.name}</span>
              </button>
            );
          }
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`inline-flex flex-col items-center justify-center px-2 sm:px-5 hover:bg-gray-50 ${
                isActive(item.href)
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <div className="relative">
                <item.icon className="w-5 h-5 sm:w-6 sm:h-6" />
                {item.name === 'Messages' && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-xs sm:text-sm">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  )
} 