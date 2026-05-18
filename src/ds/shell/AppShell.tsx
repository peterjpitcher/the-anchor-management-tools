'use client'

import { useState, useCallback, type ReactNode } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { Sidebar } from './Sidebar'
import { SidebarNav, NAV_GROUPS } from './SidebarNav'
import { UserFooter } from './UserFooter'
import { Topbar } from './Topbar'
import { Icon } from '@/ds/icons'
import type { NavGroup } from './SidebarNav'

interface AppShellProps {
  children: ReactNode
  showSidebar?: boolean
  userName: string
  userRole: string
  onSignOut: () => void
  isSigningOut: boolean
}

export function AppShell({
  children,
  showSidebar = true,
  userName,
  userRole,
  onSignOut,
  isSigningOut,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const openMobile = useCallback(() => setMobileOpen(true), [])
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  const handleMobileNavigate = useCallback(() => {
    setMobileOpen(false)
  }, [])

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Desktop sidebar */}
      {showSidebar && (
        <Sidebar
          navGroups={NAV_GROUPS}
          userName={userName}
          userRole={userRole}
          onSignOut={onSignOut}
          isSigningOut={isSigningOut}
        />
      )}

      {/* Mobile sidebar overlay */}
      {showSidebar && (
        <Dialog open={mobileOpen} onClose={closeMobile} className="relative z-50 md:hidden">
          <DialogBackdrop className="fixed inset-0 bg-black/40 transition-opacity" />
          <div className="fixed inset-0 flex">
            <DialogPanel className="relative flex w-[var(--spacing-sidebar-expanded)] flex-col bg-sidebar-bg">
              {/* Close button */}
              <div className="flex items-center justify-between h-[var(--spacing-topbar)] px-3">
                <span className="text-[15px] font-bold text-sidebar-fg">The Anchor</span>
                <button
                  type="button"
                  onClick={closeMobile}
                  className="p-1.5 rounded-[var(--radius-default)] text-sidebar-fg-muted hover:text-sidebar-fg hover:bg-sidebar-hover-bg transition-colors"
                  aria-label="Close menu"
                >
                  <Icon name="x" size={20} />
                </button>
              </div>

              {/* Navigation */}
              <div className="flex-1 py-3 overflow-y-auto">
                <SidebarNav items={NAV_GROUPS} onNavigate={handleMobileNavigate} />
              </div>

              {/* User footer */}
              <UserFooter
                userName={userName}
                userRole={userRole}
                onSignOut={() => {
                  closeMobile()
                  onSignOut()
                }}
                isSigningOut={isSigningOut}
              />
            </DialogPanel>
          </div>
        </Dialog>
      )}

      {/* Main content area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {showSidebar && <Topbar onMenuOpen={openMobile} />}
        <main className="flex-1 overflow-auto bg-bg p-[12px_16px_40px] md:p-[22px_28px_40px]">
          {children}
        </main>
      </div>
    </div>
  )
}
