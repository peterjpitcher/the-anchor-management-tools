'use client'

import { Icon } from '@/ds/icons'
import { Button } from '@/ds/primitives/Button'

interface TopbarProps {
  onMenuOpen?: () => void
}

export function Topbar({ onMenuOpen }: TopbarProps) {
  return (
    <header className="sticky top-0 z-10 h-[var(--spacing-topbar)] flex items-center px-4 md:px-6 bg-surface border-b border-border">
      {/* Mobile hamburger */}
      <button
        type="button"
        className="md:hidden shrink-0 p-1.5 -ml-1 mr-2 rounded-[var(--radius-default)] hover:bg-surface-hover transition-colors"
        onClick={onMenuOpen}
        aria-label="Open menu"
      >
        <Icon name="menu" size={20} className="text-text" />
      </button>

      {/* Search placeholder */}
      <div className="flex-1 max-w-md">
        <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-[var(--radius-default)] px-3 py-1.5 text-[13px] text-text-subtle cursor-default">
          <Icon name="search" size={16} className="shrink-0" />
          <span>Search...</span>
        </div>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Bell / notification */}
        <button
          type="button"
          className="relative w-10 h-10 inline-flex items-center justify-center rounded-[var(--radius-default)] hover:bg-surface-hover transition-colors"
          aria-label="Notifications"
        >
          <Icon name="bell" size={18} className="text-text-muted" />
          {/* Red dot indicator */}
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-danger" />
        </button>

        {/* New button */}
        <Button variant="primary" size="sm" icon={<Icon name="plus" size={14} />}>
          <span className="hidden sm:inline">New</span>
        </Button>
      </div>
    </header>
  )
}
