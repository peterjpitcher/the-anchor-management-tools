'use client'

import { User } from '@supabase/supabase-js'
import { 
  Bars3Icon, 
  BellIcon, 
  MagnifyingGlassIcon, 
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  Cog6ToothIcon
} from '@heroicons/react/24/outline'
import { usePathname } from 'next/navigation'
import { Breadcrumbs } from '@/components/ui-v2/navigation/Breadcrumbs'
import { Dropdown } from '@/components/ui-v2/navigation/Dropdown'
import { cn } from '@/lib/utils'

interface TopBarProps {
  user: User | null;
  onOpenMobileMenu: () => void;
  onSearchClick: () => void;
  onSignOut: () => void;
  className?: string;
}

export function TopBar({ 
  user, 
  onOpenMobileMenu, 
  onSearchClick, 
  onSignOut,
  className 
}: TopBarProps) {
  const pathname = usePathname()

  // Generate breadcrumbs from pathname
  const breadcrumbs = pathname === '/' 
    ? [{ label: 'Dashboard', current: true }]
    : pathname?.split('/').filter(Boolean).map((segment, index, array) => {
        const href = '/' + array.slice(0, index + 1).join('/');
        // Capitalize and format segment
        const label = segment
          .replace(/-/g, ' ')
          .replace(/^\w/, c => c.toUpperCase());
        
        return {
          label,
          href: index === array.length - 1 ? undefined : href,
          current: index === array.length - 1
        };
      }) || [];

  // Prepend Home if not on dashboard
  if (pathname !== '/') {
    breadcrumbs.unshift({ label: 'Dashboard', href: '/', current: false });
  }

  const userMenuItems = [
    {
      key: 'user-info',
      label: (
        <div className="flex flex-col">
          <span className="text-xs text-gray-500">Signed in as</span>
          <span className="font-medium truncate max-w-[150px]">{user?.email}</span>
        </div>
      ),
      disabled: true,
    },
    { key: 'divider-1', divider: true, label: '' },
    {
      key: 'settings',
      label: 'Settings',
      icon: <Cog6ToothIcon className="w-4 h-4" />,
      href: '/settings'
    },
    {
      key: 'sign-out',
      label: 'Sign out',
      icon: <ArrowRightOnRectangleIcon className="w-4 h-4" />,
      onClick: onSignOut,
      danger: true
    }
  ];

  return (
    <header className={cn("h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 lg:px-8", className)}>
      
      {/* Left: Mobile Menu & Breadcrumbs */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="md:hidden -ml-2 p-2 text-gray-500 hover:text-gray-700 rounded-md"
          onClick={onOpenMobileMenu}
        >
          <span className="sr-only">Open menu</span>
          <Bars3Icon className="h-6 w-6" aria-hidden="true" />
        </button>

        <div className="hidden md:block">
          <Breadcrumbs items={breadcrumbs} />
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Search */}
        <button
          type="button"
          onClick={onSearchClick}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          title="Search (Cmd+K)"
        >
          <span className="sr-only">Search</span>
          <MagnifyingGlassIcon className="h-5 w-5" aria-hidden="true" />
        </button>

        {/* Notifications (Placeholder) */}
        <button
          type="button"
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors relative"
        >
          <span className="sr-only">View notifications</span>
          <BellIcon className="h-5 w-5" aria-hidden="true" />
          {/* <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" /> */}
        </button>

        {/* Separator */}
        <div className="h-6 w-px bg-gray-200 hidden sm:block" aria-hidden="true" />

        {/* User Dropdown */}
        <Dropdown 
          items={userMenuItems}
          trigger={
            <div className="flex items-center gap-2 hover:bg-gray-50 rounded-full p-1 pl-2 pr-2 transition-colors cursor-pointer border border-transparent hover:border-gray-200">
              <div className="h-8 w-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm font-medium ring-2 ring-white">
                {user?.email?.[0].toUpperCase() || 'U'}
              </div>
              <span className="hidden sm:block text-sm font-medium text-gray-700 max-w-[100px] truncate">
                {user?.email?.split('@')[0]}
              </span>
            </div>
          }
          placement="bottom-end"
          menuWidth={200}
        />
      </div>
    </header>
  )
}
