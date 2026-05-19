'use client'

import React from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Spinner } from '@/ds/primitives/Spinner'
import { Alert } from '@/ds/primitives/Alert'
import { Button } from '@/ds/primitives/Button'
import { Icon } from '@/ds/icons'

/* ------------------------------------------------------------------ */
/*  HeaderNav — underline-style tab navigation (legacy-compatible)    */
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

  const resolvedItems = React.useMemo(() => {
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
          active =
            hrefWithoutHash === pathname ||
            (hrefWithoutHash !== '/' && pathname.startsWith(hrefWithoutHash))
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

  return (
    <div className={cn('relative w-full sm:flex-1', className)}>
      <nav className="overflow-x-auto text-sm sm:text-base" aria-label="Section navigation">
        <ul className="flex w-max min-w-full items-center gap-4 sm:gap-6 -mb-px">
          {resolvedItems.map(({ item, active }, index) => {
            const { href, onClick, label, icon, disabled, badge } = item
            const key = `${label}-${index}`
            const content = (
              <span
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap px-1 py-3 border-b-2 transition-colors duration-150 text-sm font-medium',
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                  disabled && 'opacity-50 pointer-events-none',
                )}
              >
                {icon && <span className="flex items-center">{icon}</span>}
                <span>{label}</span>
                {badge !== undefined && badge !== null && (
                  <span
                    className={cn(
                      'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                      active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600',
                    )}
                  >
                    {badge}
                  </span>
                )}
              </span>
            )

            return (
              <li key={key} className="flex flex-shrink-0">
                {href ? (
                  <Link
                    href={href}
                    className="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={onClick}
                    disabled={disabled}
                    className="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    {content}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
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
  hideMobileMenuButton = false,
  compactHeader = false,
}: PageLayoutProps) {
  const router = useRouter()
  const showMobileHeaderActionsInNavRow = Boolean(headerActions) && !showHeaderActionsOnMobile
  const hasNavRow =
    (navItems && navItems.length > 0) || Boolean(navActions) || showMobileHeaderActionsInNavRow

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
              className="mt-2 text-sm font-medium text-red-600 hover:text-red-500"
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
          <span className="ml-3 text-sm text-gray-500">{loadingLabel}</span>
        </div>
      )
    }

    return children
  })()

  /* Mobile header */
  const mobileHeader = (
    <div className={cn(compactHeader ? 'flex items-center gap-1.5 md:hidden' : 'flex items-center gap-2 md:hidden')}>
      {backButton && (
        <button
          type="button"
          onClick={
            backButton.onBack ||
            (backButton.href ? () => router.push(backButton.href!) : undefined)
          }
          className="rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 p-2 focus:outline-none focus:ring-2 focus:ring-gray-500/50"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1
          className={cn(
            compactHeader ? 'text-base font-bold text-gray-900 truncate' : 'text-lg font-bold text-gray-900 truncate',
          )}
        >
          {title}
        </h1>
        {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
      </div>
      {showHeaderActionsOnMobile && headerActions && (
        <div className="ml-1 flex items-center gap-2">{headerActions}</div>
      )}
      {!hideMobileMenuButton && (
        <button
          type="button"
          className="relative rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 p-2 focus:outline-none focus:ring-2 focus:ring-gray-500/50"
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

  /* Desktop header */
  const desktopHeader = (
    <div className={cn(compactHeader ? 'hidden md:flex md:flex-col md:gap-1.5' : 'hidden md:flex md:flex-col md:gap-3')}>
      <div className="flex flex-row items-start justify-between gap-4">
        <div className="flex-1">
          <h1
            className={cn(
              compactHeader
                ? 'text-xl lg:text-2xl font-bold text-gray-900'
                : 'text-2xl lg:text-3xl font-bold text-gray-900',
            )}
          >
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
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
              >
                {backButton.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div
      className={cn(
        'flex min-h-screen flex-col bg-gray-100 sm:-mx-6 sm:-mt-6',
        className,
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Page header */}
      <div className={cn('bg-white border-b border-gray-200', headerClassName)}>
        <div
          className={
            compactHeader
              ? 'px-3 py-2 md:px-4 md:py-3 lg:px-6'
              : 'px-4 pt-3 pb-3 md:px-6 md:pt-8 md:pb-6 lg:px-12'
          }
        >
          {mobileHeader}
          {desktopHeader}

          {breadcrumbs && breadcrumbs.length > 0 && (
            <div className={compactHeader ? 'mt-2' : 'mt-4'}>
              <nav
                aria-label="Breadcrumbs"
                className="flex items-center gap-1 text-sm text-gray-500"
              >
                {breadcrumbs.map((crumb, i) => {
                  const isLast = i === breadcrumbs.length - 1
                  return (
                    <React.Fragment key={crumb.label}>
                      {i > 0 && (
                        <Icon name="chevronRight" size={14} className="text-gray-400 flex-shrink-0" />
                      )}
                      {isLast ? (
                        <span className="text-gray-900 font-medium truncate">{crumb.label}</span>
                      ) : crumb.href ? (
                        <a href={crumb.href} className="hover:text-gray-700 transition-colors truncate">
                          {crumb.label}
                        </a>
                      ) : (
                        <span className="truncate">{crumb.label}</span>
                      )}
                    </React.Fragment>
                  )
                })}
              </nav>
            </div>
          )}
        </div>

        {/* Sub-navigation / toolbar */}
        {(navRow || toolbar) && (
          <div className={compactHeader ? 'px-3 md:px-4 lg:px-6' : 'px-4 md:px-6 lg:px-12'}>
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

      <main id="main-content" className={cn('flex-1', padded && 'pb-4 sm:pb-6 md:pb-8')}>
        <div
          className={cn(
            'w-full mx-auto',
            maxWidthClasses[containerSize],
            padded && 'px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 md:pt-8',
            !padded && 'pt-0',
            contentClassName,
          )}
        >
          {content}
        </div>
      </main>
    </div>
  )
}
