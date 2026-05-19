'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Icon } from '@/ds/icons'
import { Avatar } from '@/ds/primitives/Avatar'

interface TopbarProps {
  onMenuOpen?: () => void
  fohMode?: boolean
  userName?: string
  onSignOut?: () => void
  isSigningOut?: boolean
}

export function Topbar({ onMenuOpen, fohMode = false, userName, onSignOut, isSigningOut }: TopbarProps) {
  const [avatarOpen, setAvatarOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const closeDropdown = useCallback(() => setAvatarOpen(false), [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!avatarOpen) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [avatarOpen, closeDropdown])

  // Close dropdown on Escape
  useEffect(() => {
    if (!avatarOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDropdown()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [avatarOpen, closeDropdown])

  return (
    <header className={`sticky top-0 z-10 h-[var(--spacing-topbar)] flex items-center px-4 md:px-6 bg-surface border-b border-border ${!fohMode ? 'md:hidden' : ''}`}>
      {/* Mobile hamburger — only when sidebar is available (onMenuOpen provided) */}
      {onMenuOpen && (
        <button
          type="button"
          className="shrink-0 p-1.5 -ml-1 mr-2 rounded-[var(--radius-default)] hover:bg-surface-hover transition-colors"
          onClick={onMenuOpen}
          aria-label="Open menu"
        >
          <Icon name="menu" size={20} className="text-text" />
        </button>
      )}

      {/* FOH mode: show venue name */}
      {fohMode && (
        <div className="flex-1">
          <span className="text-sm font-semibold text-text">Front of House</span>
        </div>
      )}

      {/* Right side actions */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Avatar dropdown — shown in FOH mode for sign-out */}
        {fohMode && userName && (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setAvatarOpen(!avatarOpen)}
              className="rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              aria-label="User menu"
              aria-expanded={avatarOpen}
              aria-haspopup="true"
            >
              <Avatar name={userName} size="md" />
            </button>

            {avatarOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-surface border border-border rounded-[var(--radius-default)] shadow-lg py-1 z-50">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-sm font-medium text-text truncate">{userName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeDropdown()
                    onSignOut?.()
                  }}
                  disabled={isSigningOut}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover transition-colors disabled:opacity-50"
                >
                  {isSigningOut ? 'Signing out...' : 'Sign Out'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
