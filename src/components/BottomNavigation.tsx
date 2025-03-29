'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, UserGroupIcon, BookOpenIcon } from '@heroicons/react/24/outline'

export function BottomNavigation() {
  const pathname = usePathname()

  const isActive = (path: string) => pathname === path

  const navigationItems = [
    {
      name: 'Events',
      href: '/events',
      icon: CalendarIcon,
    },
    {
      name: 'Customers',
      href: '/customers',
      icon: UserGroupIcon,
    },
    {
      name: 'Bookings',
      href: '/bookings',
      icon: BookOpenIcon,
    },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-white border-t border-gray-200 md:hidden">
      <div className="grid h-full max-w-lg grid-cols-3 mx-auto">
        {navigationItems.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className={`inline-flex flex-col items-center justify-center px-5 hover:bg-gray-50 ${
              isActive(item.href)
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <item.icon className="w-6 h-6" />
            <span className="text-sm">{item.name}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
} 