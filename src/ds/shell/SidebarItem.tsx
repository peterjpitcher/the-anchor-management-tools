'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * SidebarItem — individual navigation item in sidebar
 * @deprecated Use navGroups prop on Sidebar/SidebarNav instead
 */

export interface SidebarItemProps {
  href?: string
  onClick?: (e?: React.MouseEvent) => void
  icon?: React.ElementType
  active?: boolean
  badge?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function SidebarItem({ href, onClick, icon: IconComponent, active, badge, className, children }: SidebarItemProps) {
  const classes = cn(
    'flex items-center gap-3 px-3 py-2 mx-2 rounded-[var(--radius-default)] text-[13px] font-medium transition-colors',
    active
      ? 'bg-sidebar-active-bg text-sidebar-fg'
      : 'text-sidebar-fg-muted hover:bg-sidebar-hover-bg hover:text-sidebar-fg',
    className
  )

  const content = (
    <>
      {IconComponent && <IconComponent className="w-5 h-5 shrink-0" />}
      <span className="ds-label truncate">{children}</span>
      {badge && <span className="ml-auto flex items-center">{badge}</span>}
    </>
  )

  if (href) {
    return (
      <Link href={href} onClick={onClick} className={classes}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={cn(classes, 'w-full text-left')}>
      {content}
    </button>
  )
}
