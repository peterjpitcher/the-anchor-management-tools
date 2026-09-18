'use client'

import React from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Spinner } from '@/ds/primitives/Spinner'
import { Alert } from '@/ds/primitives/Alert'
import { Button } from '@/ds/primitives/Button'
import { Icon } from '@/ds/icons'
import { SectionNav } from './SectionNav'

/* ------------------------------------------------------------------ */
/*  HeaderNav — PageLayout adapter for the standard SectionNav        */
/* ------------------------------------------------------------------ */

export interface HeaderNavItem {
  label: string
  href?: string
  onClick?: () => void
  icon?: React.ReactNode
  active?: boolean
  disabled?: boolean
  badge?: string | number
}

function HeaderNav({
  items,
  className,
}: {
  items: HeaderNavItem[]
  className?: string
}) {
  const pathname = usePathname()
  const getItemId = React.useCallback((item: HeaderNavItem, index: number) => {
    if (item.href) return item.href.startsWith('#') ? item.href : item.href.split('#')[0]
    return `${item.label}-${index}`
  }, [])

  const resolvedItems = React.useMemo(() => {
    const hrefItems = items
      .map((item) => {
        if (!item.href || item.href.startsWith('#')) return null
        return { item, hrefWithoutHash: item.href.split('#')[0] }
      })
      .filter((item): item is { item: HeaderNavItem; hrefWithoutHash: string } => Boolean(item))

    const activeHref = hrefItems
      .filter(({ hrefWithoutHash }) =>
        hrefWithoutHash === pathname ||
        (hrefWithoutHash !== '/' && pathname.startsWith(`${hrefWithoutHash}/`)),
      )
      .sort((a, b) => b.hrefWithoutHash.length - a.hrefWithoutHash.length)[0]?.hrefWithoutHash

    const computed = items.map((item) => {
      if (typeof item.active === 'boolean') {
        return { item, active: item.active }
      }

      let active = false
      if (item.href) {
        if (item.href.startsWith('#')) {
          active = typeof window !== 'undefined' && item.href === window.location.hash
        } else {
          const hrefWithoutHash = item.href.split('#')[0]
          active = hrefWithoutHash === activeHref
        }
      }

      return { item, active }
    })

    // Default-select the first item when all are local anchors
    if (!computed.some(({ active }) => active) && computed.length > 0) {
      const allLocalAnchors = computed.every(
        ({ item }) => !item.href || item.href.startsWith('#'),
      )
      if (allLocalAnchors) {
        computed[0].active = true
      }
    }

    return computed
  }, [items, pathname])

  if (resolvedItems.length === 0) return null

  const sectionItems = resolvedItems.map(({ item }, index) => ({
    id: getItemId(item, index),
    label: item.label,
    href: item.href,
    badge: item.badge,
    icon: item.icon,
    disabled: item.disabled,
  }))

  const activeItem = resolvedItems.find(({ active }) => active)
  const activeId = activeItem
    ? getItemId(activeItem.item, resolvedItems.indexOf(activeItem))
    : sectionItems[0]?.id ?? ''

  const handleSelect = (id: string) => {
    const match = resolvedItems.find(({ item }, index) => getItemId(item, index) === id)
    match?.item.onClick?.()
  }

  return (
    <div className={cn('relative w-full sm:flex-1', className)}>
      <SectionNav items={sectionItems} activeId={activeId} onSelect={handleSelect} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  PageLayout                                                        */
/* ------------------------------------------------------------------ */

export interface PageLayoutProps {
  title: string
  subtitle?: string
  breadcrumbs?: Array<{ label: string; href?: string }>
  backButton?: { label: string; href?: string; onBack?: () => void }
  headerActions?: React.ReactNode
  showHeaderActionsOnMobile?: boolean
  hideMobileMenuButton?: boolean
  compactHeader?: boolean
  /**
   * 'default' sits on the app background like PageHeader, so list and detail pages look the
   * same. 'dark' paints the page and header in the sidebar green for the FOH manager kiosk.
   */
  headerVariant?: 'default' | 'dark'
  navItems?: HeaderNavItem[]
  navActions?: React.ReactNode
  toolbar?: React.ReactNode
  children?: React.ReactNode
  padded?: boolean
  containerSize?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
  loading?: boolean
  loadingLabel?: string
  error?: Error | string | null
  onRetry?: () => void
  className?: string
  headerClassName?: string
  contentClassName?: string
}

const maxWidthClasses: Record<string, string> = {
  sm: 'max-w-screen-sm',
  md: 'max-w-screen-md',
  lg: 'max-w-screen-lg',
  xl: 'max-w-screen-xl',
  '2xl': 'max-w-screen-2xl',
  full: 'max-w-full',
}

/*
 * Spacing. AppShell's <main> pads the page (12px 16px on phones, the shell-pad tokens from the
 * shell breakpoint up). PageLayout cancels that padding with matching negative margins and adds
 * it back inside, so the dark kiosk variant can paint edge to edge while the default variant's
 * title and content line up exactly with pages that use PageHeader.
 */
const BLEED = '-mx-4 -mt-3 shell:-mx-shell-pad-x shell:-mt-shell-pad-top'
const INSET_X = 'px-4 shell:px-shell-pad-x'
const INSET_X_COMPACT = 'px-3 shell:px-4'

export function PageLayout({
  title,
  subtitle,
  breadcrumbs,
  backButton,
  headerActions,
  navItems,
  navActions,
  toolbar,
  children,
  padded = true,
  containerSize = 'full',
  loading = false,
  loadingLabel = 'Loading...',
  error = null,
  onRetry,
  className,
  headerClassName,
  contentClassName,
  showHeaderActionsOnMobile = false,
  hideMobileMenuButton = true,
  compactHeader = false,
  headerVariant = 'default',
}: PageLayoutProps) {
  const router = useRouter()
  const dark = headerVariant === 'dark'
  const insetX = compactHeader ? INSET_X_COMPACT : INSET_X
  const showMobileHeaderActionsInNavRow = Boolean(headerActions) && !showHeaderActionsOnMobile
  const hasNavRow =
    (navItems && navItems.length > 0) || Boolean(navActions) || showMobileHeaderActionsInNavRow

  const titleColour = dark ? 'text-on-dark' : 'text-text-strong'
  const subtitleColour = dark ? 'text-on-dark-muted' : 'text-text-muted'
  const iconButton = cn(
    'rounded-md p-2 focus-visible:outline-hidden focus-visible:shadow-ring',
    dark
      ? 'text-on-dark-muted hover:bg-on-dark-hover hover:text-on-dark'
      : 'text-text-muted hover:bg-surface-hover hover:text-text',
  )

  const headerActionsNode = headerActions ? (
    <div className="flex flex-wrap items-center justify-end gap-2">{headerActions}</div>
  ) : undefined

  const navRowActionsNode =
    navActions || showMobileHeaderActionsInNavRow ? (
      <div
        className={cn(
          'flex flex-wrap items-center gap-2',
          navItems && navItems.length > 0 ? '' : 'sm:ml-auto',
          !navActions && 'md:hidden',
        )}
      >
        {navActions}
        {showMobileHeaderActionsInNavRow && headerActions && (
          <div className="flex flex-wrap items-center gap-2 md:hidden">{headerActions}</div>
        )}
      </div>
    ) : null

  const navRow = hasNavRow ? (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between w-full">
      {navItems && navItems.length > 0 ? <HeaderNav items={navItems} /> : null}
      {navRowActionsNode}
    </div>
  ) : null

  const content = (() => {
    if (error) {
      const errorMessage = typeof error === 'string' ? error : error.message
      return (
        <Alert
          tone="danger"
          title="Something went wrong"
        >
          {errorMessage}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-sm font-medium text-danger-fg hover:underline focus-visible:outline-hidden focus-visible:shadow-ring"
            >
              Try again
            </button>
          )}
        </Alert>
      )
    }

    if (loading) {
      return (
        <div className="flex min-h-[200px] items-center justify-center">
          <Spinner size="lg" />
          <span className="ml-3 text-sm text-text-muted">{loadingLabel}</span>
        </div>
      )
    }

    return children
  })()

  const breadcrumbsNode =
    breadcrumbs && breadcrumbs.length > 0 ? (
      <nav
        aria-label="Breadcrumbs"
        className={cn('mb-2 flex items-center gap-1 text-sm', subtitleColour)}
      >
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1
          return (
            <React.Fragment key={crumb.label}>
              {i > 0 && (
                <Icon
                  name="chevronRight"
                  size={14}
                  className={cn('flex-shrink-0', dark ? 'text-on-dark-subtle' : 'text-text-subtle')}
                />
              )}
              {isLast ? (
                <span className={cn('truncate font-medium', dark ? 'text-on-dark' : 'text-text')}>
                  {crumb.label}
                </span>
              ) : crumb.href ? (
                <a
                  href={crumb.href}
                  className={cn('truncate transition-colors', dark ? 'hover:text-on-dark' : 'hover:text-text')}
                >
                  {crumb.label}
                </a>
              ) : (
                <span className="truncate">{crumb.label}</span>
              )}
            </React.Fragment>
          )
        })}
      </nav>
    ) : null

  /* Mobile header */
  const mobileHeader = (
    <div className={cn(compactHeader ? 'flex items-center gap-1.5 md:hidden' : 'flex items-center gap-2 md:hidden')}>
      {backButton && (
        <button
          type="button"
          aria-label={backButton.label}
          onClick={
            backButton.onBack ||
            (backButton.href ? () => router.push(backButton.href!) : undefined)
          }
          className={iconButton}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1
          className={cn(
            'truncate font-bold tracking-tight',
            compactHeader ? 'text-base' : 'text-lg',
            titleColour,
          )}
        >
          {title}
        </h1>
        {subtitle && <p className={cn('truncate text-xs', subtitleColour)}>{subtitle}</p>}
      </div>
      {showHeaderActionsOnMobile && headerActions && (
        <div className="ml-1 flex items-center gap-2">{headerActions}</div>
      )}
      {!hideMobileMenuButton && (
        <button
          type="button"
          className={cn('relative', iconButton)}
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('open-mobile-menu'))
            }
          }}
        >
          <span className="sr-only">Open menu</span>
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}
    </div>
  )

  /* Desktop header: the same title, subtitle and action row as PageHeader */
  const desktopHeader = (
    <div className="hidden md:flex md:flex-row md:items-start md:justify-between md:gap-4">
      <div className="min-w-0 flex-1">
        <h1
          className={cn(
            'font-bold tracking-tight',
            compactHeader ? 'text-xl' : 'text-2xl',
            titleColour,
          )}
        >
          {title}
        </h1>
        {subtitle && <p className={cn('mt-1 text-sm', subtitleColour)}>{subtitle}</p>}
      </div>

      {(headerActionsNode || backButton) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {headerActionsNode}
          {backButton && (
            <Button
              variant="ghost"
              onClick={
                backButton.onBack ||
                (backButton.href ? () => router.push(backButton.href!) : undefined)
              }
              icon={<Icon name="chevronLeft" size={16} />}
              className={dark ? 'text-on-dark hover:bg-on-dark-hover' : undefined}
            >
              {backButton.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div
      className={cn(
        'flex flex-col',
        BLEED,
        dark && 'min-h-screen bg-brand-700',
        className,
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-surface focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:text-sm focus:font-medium focus:text-text"
      >
        Skip to main content
      </a>

      {/* Page header */}
      <div
        className={cn(
          dark ? 'border-b border-on-dark-border' : 'mb-4',
          headerClassName,
        )}
      >
        <div
          className={cn(
            insetX,
            compactHeader ? 'pt-2 pb-2 shell:pt-3 shell:pb-3' : 'pt-3 pb-4 shell:pt-shell-pad-top',
          )}
        >
          {breadcrumbsNode}
          {mobileHeader}
          {desktopHeader}
        </div>

        {/* Sub-navigation / toolbar */}
        {(navRow || toolbar) && (
          <div className={cn(insetX, compactHeader ? 'pb-2' : 'pb-4')}>
            <div
              className={cn(
                compactHeader
                  ? 'flex flex-wrap items-center gap-2 text-xs md:gap-3 md:text-sm'
                  : 'flex flex-wrap items-center gap-3 text-xs md:gap-4 md:text-sm',
              )}
            >
              {toolbar ? (
                <div className="flex flex-col gap-3 w-full">
                  {navRow}
                  {toolbar}
                </div>
              ) : (
                navRow
              )}
            </div>
          </div>
        )}
      </div>

      <main id="main-content" className={cn('flex-1', padded && 'pb-4')}>
        <div
          className={cn(
            'w-full mx-auto',
            maxWidthClasses[containerSize],
            padded ? cn(insetX, 'pt-0') : 'pt-0',
            contentClassName,
          )}
        >
          {content}
        </div>
      </main>
    </div>
  )
}
