'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, UserGroupIcon, HomeIcon, IdentificationIcon, PencilSquareIcon } from '@heroicons/react/24/outline'

// ADDED Props interface
interface BottomNavigationProps {
  onQuickAddNoteClick: () => void;
}

export function BottomNavigation({ onQuickAddNoteClick }: BottomNavigationProps) { // ADDED onQuickAddNoteClick prop
  const pathname = usePathname()

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
              <item.icon className="w-5 h-5 sm:w-6 sm:h-6" />
              <span className="text-xs sm:text-sm">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  )
} 