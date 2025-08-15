'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, UserGroupIcon, PencilSquareIcon, EnvelopeIcon, BuildingOfficeIcon, IdentificationIcon, DocumentTextIcon, HomeIcon, StarIcon, Bars3Icon, Cog6ToothIcon } from '@heroicons/react/24/outline'
import { useEffect, useState, useMemo } from 'react'
import { getUnreadMessageCount } from '@/app/actions/messagesActions'
import { usePermissions } from '@/contexts/PermissionContext'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ModuleName, ActionType } from '@/types/rbac'

// ADDED Props interface
interface BottomNavigationProps {
  onQuickAddNoteClick: () => void;
}

export function BottomNavigation({ onQuickAddNoteClick }: BottomNavigationProps) { // ADDED onQuickAddNoteClick prop
  const pathname = usePathname()
  const [unreadCount, setUnreadCount] = useState(0)
  const [moreDrawerOpen, setMoreDrawerOpen] = useState(false)

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

  // Split navigation items into primary (bottom nav) and secondary (drawer)
  const { primaryItems, secondaryItems } = useMemo(() => {
    const allNavigationItems: NavigationItem[] = [
      { name: 'Dashboard', href: '/', icon: HomeIcon, permission: { module: 'dashboard', action: 'view' } },
      { name: 'Events', href: '/events', icon: CalendarIcon, permission: { module: 'events', action: 'view' } },
      { name: 'Customers', href: '/customers', icon: UserGroupIcon, permission: { module: 'customers', action: 'view' } },
      { name: 'Messages', href: '/messages', icon: EnvelopeIcon, permission: { module: 'messages', action: 'view' } },
      { name: 'Private', href: '/private-bookings', icon: BuildingOfficeIcon, permission: { module: 'private_bookings', action: 'view' } },
      { name: 'VIP Club', href: '/loyalty/admin', icon: StarIcon, permission: { module: 'loyalty', action: 'view' } },
      { name: 'Employees', href: '/employees', icon: IdentificationIcon, permission: { module: 'employees', action: 'view' } },
      { name: 'Notes', href: '#', icon: PencilSquareIcon, action: true },
      { name: 'Invoices', href: '/invoices', icon: DocumentTextIcon, permission: { module: 'invoices', action: 'view' } },
      { name: 'Settings', href: '/settings', icon: Cog6ToothIcon, permission: { module: 'settings', action: 'view' } },
    ]
    
    if (permissionsLoading) return { primaryItems: [], secondaryItems: [] };
    
    const filteredItems = allNavigationItems.filter(item => 
      item.action || !item.permission || hasPermission(item.permission.module, item.permission.action)
    );
    
    // Primary items: Dashboard, Events, Customers, Messages (4 items)
    const primary = filteredItems.slice(0, 4);
    // Secondary items: Everything else
    const secondary = filteredItems.slice(4);
    
    return { primaryItems: primary, secondaryItems: secondary };
  }, [hasPermission, permissionsLoading])

  if (permissionsLoading) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-gray-300 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex h-16 overflow-x-auto scrollbar-hide">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="inline-flex flex-col items-center justify-center min-w-[90px] px-2">
              <div className="w-6 h-6 bg-white/20 rounded animate-pulse"></div>
              <div className="w-12 h-3 bg-white/20 rounded mt-1 animate-pulse"></div>
            </div>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-gray-300 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex h-16 justify-around items-center">
          {/* Primary navigation items - max 4 items */}
          {primaryItems.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center justify-center flex-1 min-h-[44px] py-2 transition-colors ${
                isActive(item.href)
                  ? 'bg-white/20 text-white'
                  : 'text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20'
              }`}
            >
              <div className="relative">
                <item.icon className="w-6 h-6" />
                {item.name === 'Messages' && unreadCount > 0 && (
                  <span className="absolute -top-2 -right-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold leading-none text-white bg-red-600 rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-xs mt-1">{item.name}</span>
            </Link>
          ))}
          
          {/* More button - opens drawer with secondary items */}
          {secondaryItems.length > 0 && (
            <button
              onClick={() => setMoreDrawerOpen(true)}
              className="flex flex-col items-center justify-center flex-1 min-h-[44px] py-2 text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
            >
              <Bars3Icon className="w-6 h-6" />
              <span className="text-xs mt-1">More</span>
            </button>
          )}
        </div>
      </nav>

      {/* Secondary navigation drawer using shadcn/ui Sheet */}
      <Sheet open={moreDrawerOpen} onOpenChange={setMoreDrawerOpen}>
        <SheetContent side={"bottom" as const} className="h-auto max-h-[80vh] rounded-t-xl">
          <SheetHeader>
            <SheetTitle>More Options</SheetTitle>
            <SheetDescription>
              Access additional features and settings
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="h-full max-h-[60vh] mt-4">
            <div className="grid grid-cols-3 gap-4 pb-safe">
              {secondaryItems.map((item) => {
                if (item.action && item.name === 'Notes') {
                  return (
                    <button
                      key={item.name}
                      onClick={() => {
                        onQuickAddNoteClick();
                        setMoreDrawerOpen(false);
                      }}
                      className="flex flex-col items-center justify-center p-4 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors min-h-[88px]"
                    >
                      <item.icon className="w-8 h-8 text-gray-700 mb-2" />
                      <span className="text-sm text-gray-900">{item.name}</span>
                    </button>
                  );
                }
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMoreDrawerOpen(false)}
                    className={`flex flex-col items-center justify-center p-4 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors min-h-[88px] ${
                      isActive(item.href) ? 'bg-gray-100' : ''
                    }`}
                  >
                    <item.icon className="w-8 h-8 text-gray-700 mb-2" />
                    <span className="text-sm text-gray-900">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  )
} 