'use client'

import { Anchor } from 'lucide-react'
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
      <div className="flex items-center justify-center min-h-[var(--spacing-topbar)] shrink-0 px-3 py-2">
        <Anchor className="ds-logo-icon h-7 w-7 text-white shrink-0" />
        <img
          src="/logo.png"
          alt="The Anchor"
          className="ds-logo-full w-full px-4"
        />
      </div>

      {/* Navigation */}
      <div className="ds-sidebar-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-3">
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
