'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { PanelLeft, Pin, PinOff } from 'lucide-react'
import { Icon } from '@/ds/icons'
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
  pinned?: boolean
  onPinnedChange?: (pinned: boolean) => void
  collapsedGroups?: string[]
  onToggleGroup?: (label: string) => void
  shortcuts?: NavGroup[]
  shortcutControl?: ReactNode
  shortcutPickerOpen?: boolean
  children?: ReactNode
}

export function Sidebar({ navGroups, userName, userRole, onSignOut, isSigningOut, onNavigate,
  pinned = false, onPinnedChange, collapsedGroups, onToggleGroup, shortcuts, shortcutControl, shortcutPickerOpen = false, children }: SidebarProps) {
  const [expanded, setExpanded] = useState(false)
  const pathname = usePathname()
  useEffect(() => setExpanded(false), [pathname])
  const open = pinned || expanded || shortcutPickerOpen
  const navigate = () => {
    // Focus remains on the link for keyboard users, but no longer holds the rail open.
    setExpanded(false)
    onNavigate?.()
  }
  const mainGroups = navGroups?.filter(group => group.label !== 'Settings')
  const settingsGroups = navGroups?.filter(group => group.label === 'Settings')

  return (
    <div className="ds-sidebar-rail relative hidden shell:block" data-pinned={pinned}>
      <div className="ds-sidebar flex h-full flex-col bg-sidebar" data-expanded={open}
        onPointerLeave={() => { if (!shortcutPickerOpen) setExpanded(false) }}
        onBlurCapture={event => { if (!shortcutPickerOpen && !event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}
        onKeyDown={event => {
          // Portalled dialogs bubble through React but have their own dismissal keys.
          if (!event.currentTarget.contains(event.target as Node)) return
          if (event.key === 'Tab') setExpanded(true)
          if (event.key === 'Escape') {
            setExpanded(false)
            onPinnedChange?.(false)
          }
        }}>
        <div className="ds-sidebar-brand flex h-8 shrink-0 items-center text-sidebar-fg">
          <button type="button" data-menu-toggle className="ds-brand-icon h-8 hover:bg-sidebar-hover-bg"
            aria-label={open ? 'Collapse menu' : 'Expand menu'} aria-expanded={open}
            title={open ? 'Collapse menu' : 'Expand menu'}
            onClick={() => { if (pinned) onPinnedChange?.(false); setExpanded(!open) }}>
            <PanelLeft size={20} aria-hidden="true" />
          </button>
          <span className="ds-label min-w-0 flex flex-1 items-center gap-2 text-sm font-semibold"><img src="/orange-jelly/logo-icon-white.png" alt="Orange Jelly" className="h-6 w-6 object-contain" />The Anchor</span>
          {onPinnedChange && (
            <button type="button" className="ds-label mr-2 grid h-6 w-6 place-items-center rounded-sm hover:bg-sidebar-hover-bg"
              aria-label={pinned ? 'Unpin menu' : 'Pin menu open'} aria-pressed={pinned}
              title={pinned ? 'Unpin menu' : 'Pin menu open'}
              onClick={() => { setExpanded(false); onPinnedChange(!pinned) }}>
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          )}
        </div>
        <button type="button" className="ds-nav-link shrink-0 rounded-sm text-sidebar-fg-muted hover:bg-sidebar-hover-bg"
          aria-label="Find or go to" title="Find or go to (Ctrl/Cmd+K)"
          onClick={() => { navigate(); window.dispatchEvent(new CustomEvent('open-global-search')) }}>
          <span className="ds-nav-icon"><Icon name="search" size={18} /></span>
          <span className="ds-label text-ui">Find or go to...</span>
        </button>
        <div className="ds-sidebar-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-0.5">
          {!!shortcuts?.length && <div className="ds-shortcuts"><SidebarNav items={shortcuts} onNavigate={navigate} ariaLabel="Your shortcuts" /></div>}
          {shortcutControl && <div className="ds-shortcut-control">{shortcutControl}</div>}
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
