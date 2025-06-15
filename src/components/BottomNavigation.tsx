'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, UserGroupIcon, HomeIcon, IdentificationIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'
import { getTotalUnreadCount } from '@/app/actions/messageActions'

// ADDED Props interface
interface BottomNavigationProps {
  onQuickAddNoteClick: () => void;
}

export function BottomNavigation({ onQuickAddNoteClick }: BottomNavigationProps) { // ADDED onQuickAddNoteClick prop
  const pathname = usePathname()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    // Load unread count on mount
    getTotalUnreadCount().then(setUnreadCount)
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      getTotalUnreadCount().then(setUnreadCount)
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
  };

  const navigationItems: NavigationItem[] = [
    { name: 'Dashboard', href: '/', icon: HomeIcon },
    { name: 'Events', href: '/events', icon: CalendarIcon },
    { name: 'Customers', href: '/customers', icon: UserGroupIcon },
    { name: 'Employees', href: '/employees', icon: IdentificationIcon },
    { name: 'Add Note', href: '#', icon: PencilSquareIcon, action: true }, // Mark as action, href changed to #
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-white border-t border-gray-200 md:hidden">
      <div className="grid h-full max-w-lg grid-cols-5 mx-auto">
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
                {item.name === 'Customers' && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-blue-600 rounded-full">
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