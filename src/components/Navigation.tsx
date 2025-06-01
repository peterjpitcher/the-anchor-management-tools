'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarIcon, UserGroupIcon, HomeIcon, IdentificationIcon, BuildingStorefrontIcon } from '@heroicons/react/24/outline'

const primaryNavigation = [
  { name: 'Dashboard', href: '/', icon: HomeIcon },
  { name: 'Events', href: '/events', icon: CalendarIcon },
  { name: 'Customers', href: '/customers', icon: UserGroupIcon },
];

const secondaryNavigation = [
  { name: 'Employees', href: '/employees', icon: IdentificationIcon },
  // Example of another section if needed in future
  // { name: 'The Anchor Mgmt', href: '/anchor', icon: BuildingStorefrontIcon }, 
];

export function Navigation() {
  const pathname = usePathname()

  const renderNavItem = (item: typeof primaryNavigation[0]) => {
    const isActive = item.href === '/' 
      ? pathname === '/'
      : pathname.startsWith(item.href);
    return (
      <Link
        key={item.name}
        href={item.href}
        className={`
          group flex items-center px-2 py-2 text-sm font-medium rounded-md
          ${isActive
            ? 'bg-orange-600 text-white'
            : 'text-orange-100 hover:bg-orange-400 hover:text-orange-50'
          }
        `}
      >
        <item.icon
          className={`
            mr-3 h-6 w-6
            ${isActive
              ? 'text-white'
              : 'text-orange-200 group-hover:text-orange-50'
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
      {primaryNavigation.map(renderNavItem)}
      
      {/* Divider */}
      <div className="pt-2 pb-1">
        <hr className="border-t border-orange-400 opacity-50" />
      </div>
      
      {secondaryNavigation.map(renderNavItem)}
    </nav>
  )
} 