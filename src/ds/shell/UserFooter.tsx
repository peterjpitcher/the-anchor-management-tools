'use client'

import { Avatar } from '@/ds/primitives/Avatar'
import { Icon } from '@/ds/icons'

interface UserFooterProps {
  userName: string
  userRole: string
  onSignOut: () => void
  isSigningOut: boolean
}

export function UserFooter({ userName, userRole, onSignOut, isSigningOut }: UserFooterProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 border-t border-sidebar-border">
      <Avatar name={userName} size="sm" />
      <div className="ds-label flex-1 min-w-0">
        <div className="text-[13px] font-medium text-sidebar-fg truncate">{userName}</div>
        <div className="text-xs text-sidebar-fg-muted">{userRole}</div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        disabled={isSigningOut}
        className="ds-label shrink-0 p-1 rounded-[var(--radius-default)] text-sidebar-fg-muted hover:text-sidebar-fg hover:bg-sidebar-hover-bg transition-colors disabled:opacity-50"
        aria-label="Sign out"
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}
