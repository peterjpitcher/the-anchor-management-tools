'use client'

import { SidebarNav } from './SidebarNav'
import { UserFooter } from './UserFooter'
import { Icon } from '@/ds/icons'
import type { NavGroup } from './SidebarNav'

export interface SidebarProps {
  navGroups?: NavGroup[]
  userName?: string
  userRole?: string
  onSignOut?: () => void
  isSigningOut?: boolean
  onNavigate?: () => void
  /** Legacy children-based API */
  children?: React.ReactNode
}

export function Sidebar({ navGroups, userName, userRole, onSignOut, isSigningOut, onNavigate, children }: SidebarProps) {
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
        {navGroups ? (
          <SidebarNav items={navGroups} onNavigate={onNavigate} />
        ) : (
          children
        )}
      </div>

      {/* User footer */}
      {userName && onSignOut && (
        <UserFooter
          userName={userName}
          userRole={userRole ?? ''}
          onSignOut={onSignOut}
          isSigningOut={isSigningOut ?? false}
        />
      )}
    </div>
  )
}
