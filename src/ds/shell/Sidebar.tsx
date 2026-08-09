'use client'

import { Anchor } from 'lucide-react'
import { SidebarNav } from './SidebarNav'
import { UserFooter } from './UserFooter'
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
    // The rail holds the layout space (a fixed 64px). The panel inside is
    // absolutely positioned, so expanding on hover overlays the page rather
    // than shoving every column sideways.
    <div className="ds-sidebar-rail relative hidden shell:block">
      <div className="ds-sidebar flex h-full flex-col bg-sidebar-bg">
        {/* Logo area. The height is fixed rather than a min-height: the full
            logo is a 400x180 image, so letting it size itself grew this row
            from 52px to 95px on expand and pushed the whole nav 43px down every
            time the pointer crossed the rail. */}
        <div className="flex h-[var(--spacing-logo-row)] shrink-0 items-center justify-center px-3 pt-5 pb-3">
          <Anchor className="ds-logo-icon h-7 w-7 shrink-0 text-white" />
          <img
            src="/logo.png"
            alt="The Anchor"
            className="ds-logo-full h-full w-full object-contain"
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
    </div>
  )
}
