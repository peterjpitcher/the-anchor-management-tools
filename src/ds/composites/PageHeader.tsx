import React from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ds/icons'

/* ------------------------------------------------------------------ */
/*  PageHeader                                                        */
/*  Server component -- no 'use client' directive                     */
/* ------------------------------------------------------------------ */

interface Breadcrumb {
  label: string
  href?: string
}

interface PageHeaderProps {
  /** Breadcrumb trail. Last item rendered as current (no link). */
  breadcrumbs?: Breadcrumb[]
  /** Page title */
  title: string
  /** Optional subtitle below the title */
  subtitle?: string
  /** Action buttons rendered on the right side of the title row */
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ breadcrumbs, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('pb-4 mb-4', className)}>
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumbs" className="flex items-center gap-1 text-sm text-text-muted mb-2">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1
            return (
              <React.Fragment key={crumb.label}>
                {i > 0 && (
                  <Icon name="chevronRight" size={14} className="text-text-subtle flex-shrink-0" />
                )}
                {isLast ? (
                  <span className="text-text font-medium truncate">{crumb.label}</span>
                ) : crumb.href ? (
                  <a href={crumb.href} className="hover:text-text transition-colors truncate">
                    {crumb.label}
                  </a>
                ) : (
                  <span className="truncate">{crumb.label}</span>
                )}
              </React.Fragment>
            )
          })}
        </nav>
      )}

      {/* Title row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-strong tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-text-muted mt-1">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
