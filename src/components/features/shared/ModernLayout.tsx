'use client'

import { useState, useEffect } from 'react'
import { ModernSidebar, navigationGroups } from './ModernSidebar'
import { TopBar } from './TopBar'
import { CommandPalette, useCommandPalette, CommandItem } from '@/components/ui-v2/navigation/CommandPalette'
import AddNoteModal from '@/components/modals/AddNoteModal'
import { User } from '@supabase/supabase-js'
import { 
  PencilSquareIcon, 
  ArrowRightOnRectangleIcon 
} from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import { usePermissions } from '@/contexts/PermissionContext'
import { cn } from '@/lib/utils'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import Image from 'next/image'

interface ModernLayoutProps {
  children: React.ReactNode;
  user: User | null;
  onSignOut: () => void;
}

export function ModernLayout({ children, user, onSignOut }: ModernLayoutProps) {
  const router = useRouter()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false)
  
  const { isOpen: isCommandPaletteOpen, open: openCommandPalette, close: closeCommandPalette } = useCommandPalette()
  const { hasPermission } = usePermissions()

  // Handle window resize for responsive sidebar
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) { // lg breakpoint
        setSidebarCollapsed(true)
      }
    }
    
    // Initial check
    handleResize()
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Construct commands from navigation groups
  const navigationCommands: CommandItem[] = navigationGroups.flatMap(group => 
    group.items
      .filter(item => !item.permission || hasPermission(item.permission.module, item.permission.action))
      .map(item => ({
        id: `nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`,
        title: item.name,
        href: item.href,
        icon: <item.icon className="w-5 h-5" />,
        category: group.name,
        keywords: [item.name, group.name]
      }))
  )

  const actionCommands: CommandItem[] = [
    {
      id: 'action-add-note',
      title: 'Quick Add Note',
      icon: <PencilSquareIcon className="w-5 h-5" />,
      action: () => setIsAddNoteModalOpen(true),
      category: 'Actions',
      shortcut: 'N'
    },
    {
      id: 'action-sign-out',
      title: 'Sign Out',
      icon: <ArrowRightOnRectangleIcon className="w-5 h-5" />,
      action: () => onSignOut(),
      category: 'Account'
    }
  ]

  const allCommands = [...navigationCommands, ...actionCommands]

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile Sidebar Overlay */}
      <Transition.Root show={isMobileMenuOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 md:hidden" onClose={setIsMobileMenuOpen}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/80" />
          </Transition.Child>

          <div className="fixed inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <Transition.Child
                  as={Fragment}
                  enter="ease-in-out duration-300"
                  enterFrom="opacity-0"
                  enterTo="opacity-100"
                  leave="ease-in-out duration-300"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                    <button
                      type="button"
                      className="-m-2.5 p-2.5"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <span className="sr-only">Close sidebar</span>
                      <XMarkIcon className="h-6 w-6 text-white" aria-hidden="true" />
                    </button>
                  </div>
                </Transition.Child>
                
                {/* Mobile Sidebar Content */}
                <ModernSidebar 
                  onQuickAddNoteClick={() => {
                    setIsAddNoteModalOpen(true)
                    setIsMobileMenuOpen(false)
                  }}
                  collapsed={false}
                  setCollapsed={() => {}} // No collapsing on mobile
                  className="w-full"
                />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex flex-col h-screen sticky top-0 z-30 shadow-xl shadow-green-900/5">
        <ModernSidebar 
          onQuickAddNoteClick={() => setIsAddNoteModalOpen(true)}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar 
          user={user}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onSearchClick={openCommandPalette}
          onSignOut={onSignOut}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>

      {/* Global Modals */}
      <CommandPalette 
        open={isCommandPaletteOpen}
        onClose={closeCommandPalette}
        commands={allCommands}
      />

      <AddNoteModal 
        isOpen={isAddNoteModalOpen} 
        onClose={() => setIsAddNoteModalOpen(false)} 
      />
    </div>
  )
}
