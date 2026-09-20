'use client'

import Link from 'next/link'
import { Avatar } from '@/ds/primitives/Avatar'
import { Icon } from '@/ds/icons'

interface UserFooterProps {
  userName: string
  userRole: string
  onSignOut: () => void
  isSigningOut: boolean
  onNavigate?: () => void
}

export function UserFooter({ userName, userRole, onSignOut, isSigningOut, onNavigate }: UserFooterProps) {
  return (
    <div className="ds-sidebar-footer flex shrink-0 items-center gap-2 px-3 py-1 border-t border-sidebar-border">
      <Link href="/profile" aria-label="Open my profile" title="My profile" onClick={onNavigate} className="shrink-0"><Avatar name={userName} size="sm" /></Link>
      <div className="ds-label flex-1 min-w-0">
        <div className="text-ui font-medium text-sidebar-fg truncate">{userName}</div>
        <div className="text-xs text-sidebar-fg-muted">{userRole}</div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        disabled={isSigningOut}
        className="ds-label shrink-0 p-1 rounded-default text-sidebar-fg-muted hover:text-sidebar-fg hover:bg-sidebar-hover-bg transition-colors disabled:opacity-50 focus-visible:outline-hidden focus-visible:shadow-ring"
        aria-label="Sign out"
      >
        <Icon name="logout" size={16} />
      </button>
    </div>
  )
}
