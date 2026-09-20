'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
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
  collapsedGroups?: string[]
  onToggleGroup?: (label: string) => void
  children?: ReactNode
}

export function Sidebar({ navGroups, userName, userRole, onSignOut, isSigningOut, onNavigate,
  collapsedGroups, onToggleGroup, children }: SidebarProps) {
  const [expanded, setExpanded] = useState(false)
  const pathname = usePathname()
  useEffect(() => setExpanded(false), [pathname])
  const open = expanded
  const navigate = () => {
    // Focus remains on the link for keyboard users, but no longer holds the rail open.
    setExpanded(false)
    onNavigate?.()
  }
  const mainGroups = navGroups?.filter(group => group.label !== 'Admin')
  const settingsGroups = navGroups?.filter(group => group.label === 'Admin')

  return (
    <div className="ds-sidebar-rail relative hidden shell:block">
      <div className="ds-sidebar flex h-full flex-col bg-sidebar" data-expanded={open}
        onPointerEnter={event => { if (event.pointerType !== 'touch') setExpanded(true) }}
        onPointerLeave={() => { setExpanded(false) }}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}
        onKeyDown={event => {
          // Portalled dialogs bubble through React but have their own dismissal keys.
          if (!event.currentTarget.contains(event.target as Node)) return
          if (event.key === 'Tab') setExpanded(true)
          if (event.key === 'Escape') {
            setExpanded(false)
          }
        }}>
        <div className="ds-sidebar-brand shrink-0 text-sidebar-fg">
          {open ? (
            <div className="px-2 pt-2">
              <img src="/orange-jelly/logo-horizontal-white.png" alt="Orange Jelly" className="h-auto w-full" />

            </div>
          ) : (
            <button type="button" className="grid h-12 w-full place-items-center hover:bg-sidebar-hover-bg"
              aria-label="Expand menu" aria-expanded={false} onClick={() => setExpanded(true)}>
              <img src="/orange-jelly/logo-icon-white.png" alt="Orange Jelly" className="h-8 w-8 object-contain" />
            </button>
          )}
        </div>
        <div className="ds-sidebar-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-0.5">
          {mainGroups ? <SidebarNav items={mainGroups} onNavigate={navigate} collapsedGroups={collapsedGroups} onToggleGroup={onToggleGroup} /> : children}
        </div>
        {!!settingsGroups?.length && <div className="shrink-0 border-t border-sidebar-border py-0.5">
          <SidebarNav items={settingsGroups} onNavigate={navigate} collapsedGroups={collapsedGroups} onToggleGroup={onToggleGroup} ariaLabel="Account and settings" />
        </div>}
        {userName && onSignOut && <UserFooter userName={userName} userRole={userRole ?? ''}
          onSignOut={onSignOut} isSigningOut={isSigningOut ?? false} onNavigate={navigate} />}
      </div>
    </div>
  )
}
