'use client'

import { SidebarNav } from './SidebarNav'
import { UserFooter } from './UserFooter'
import { Icon } from '@/ds/icons'
import type { NavGroup } from './SidebarNav'

interface SidebarProps {
  navGroups: NavGroup[]
  userName: string
  userRole: string
  onSignOut: () => void
  isSigningOut: boolean
  onNavigate?: () => void
}

export function Sidebar({ navGroups, userName, userRole, onSignOut, isSigningOut, onNavigate }: SidebarProps) {
  return (
    <div className="ds-sidebar bg-sidebar-bg flex flex-col hidden md:flex">
      {/* Logo area — matches topbar height */}
      <div className="flex items-center justify-center h-[var(--spacing-topbar)] shrink-0 px-3">
        <Icon name="home" size={24} className="text-sidebar-fg shrink-0" />
        <span className="ds-label ml-2 text-[15px] font-bold text-sidebar-fg whitespace-nowrap">
          The Anchor
        </span>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-3 overflow-hidden">
        <SidebarNav items={navGroups} onNavigate={onNavigate} />
      </div>

      {/* User footer */}
      <UserFooter
        userName={userName}
        userRole={userRole}
        onSignOut={onSignOut}
        isSigningOut={isSigningOut}
      />
    </div>
  )
}
