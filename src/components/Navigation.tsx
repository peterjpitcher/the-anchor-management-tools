'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarIcon, UserGroupIcon, HomeIcon, IdentificationIcon, BuildingStorefrontIcon, PencilSquareIcon, CogIcon } from '@heroicons/react/24/outline'

const primaryNavigation = [
  { name: 'Dashboard', href: '/', icon: HomeIcon },
  { name: 'Events', href: '/events', icon: CalendarIcon },
  { name: 'Customers', href: '/customers', icon: UserGroupIcon },
];

const secondaryNavigation = [
  { name: 'Employees', href: '/employees', icon: IdentificationIcon },
  { name: 'Quick Add Note', href: '#', icon: PencilSquareIcon, action: true },
  { name: 'Settings', href: '/settings', icon: CogIcon },
  // Example of another section if needed in future
  // { name: 'The Anchor Mgmt', href: '/anchor', icon: BuildingStorefrontIcon }, 
];

interface NavigationProps {
  onQuickAddNoteClick: () => void;
}

export function Navigation({ onQuickAddNoteClick }: NavigationProps) {
  const pathname = usePathname()

  type NavigationItem = {
    name: string;
    href: string;
    icon: React.ElementType;
    action?: boolean;
  };

  const renderNavItem = (item: NavigationItem) => {
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
      </Link>
    );
  }

  return (
    <nav className="space-y-1 px-2">
      {(primaryNavigation as NavigationItem[]).map(renderNavItem)}
      
      {/* Divider */}
      <div className="pt-2 pb-1">
        <hr className="border-t border-green-600 opacity-75" />
      </div>
      
      {(secondaryNavigation as NavigationItem[]).map(renderNavItem)}
    </nav>
  )
} 