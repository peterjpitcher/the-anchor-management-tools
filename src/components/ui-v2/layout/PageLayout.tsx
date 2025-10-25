import React from 'react'
import { cn } from '@/lib/utils'
import { Container } from './Container'
import { PageHeader } from './PageHeader'
import { HeaderNav, type HeaderNavItem } from '../navigation/HeaderNav'
import { Spinner } from '../feedback/Spinner'
import { Alert } from '../feedback/Alert'
import { ErrorBoundary } from '../utility/ErrorBoundary'

export interface PageLayoutProps {
  title: string
  subtitle?: string
  breadcrumbs?: Array<{
    label: string
    href?: string
  }>
  /**
   * Back button rendered to the right of the title on desktop and near the title on mobile.
   * Matches the existing PageHeader back button API.
   */
  backButton?: {
    label: string
    href?: string
    onBack?: () => void
  }
  /**
   * Prominent actions rendered in the top-right of the header.
   * Typically primary/secondary buttons.
   */
  headerActions?: React.ReactNode
  /**
   * Secondary navigation displayed beneath the header.
   */
  navItems?: HeaderNavItem[]
  /**
   * Optional trailing actions aligned with the secondary navigation.
   */
  navActions?: React.ReactNode
  /**
   * Additional custom content to render below the header navigation row.
   */
  toolbar?: React.ReactNode
  children?: React.ReactNode
  /**
   * Controls the padding applied around the main content.
   * @default true
   */
  padded?: boolean
  /**
   * Maximum width for the main content container.
   * @default 'full'
   */
  containerSize?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
  /**
   * Loading state for the page body.
   */
  loading?: boolean
  /**
   * Custom label displayed alongside the loading spinner.
   */
  loadingLabel?: string
  /**
   * Optional error state rendered in place of children.
   */
  error?: Error | string | null
  /**
   * Retry handler for the error state.
   */
  onRetry?: () => void
  /**
   * Root element class names.
   */
  className?: string
  /**
   * Additional class names for the header wrapper.
   */
  headerClassName?: string
  /**
   * Additional class names for the content wrapper.
   */
  contentClassName?: string
}

/**
 * PageLayout - Unified wrapper that pairs the app sidebar with a consistent
 * dark header, optional secondary navigation, and padded content area.
 */
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
}: PageLayoutProps) {
  const hasNavRow = (navItems && navItems.length > 0) || Boolean(navActions)

  const headerActionsNode = headerActions ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {headerActions}
    </div>
  ) : undefined

  const navRow = hasNavRow ? (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {navItems && navItems.length > 0 ? (
        <HeaderNav items={navItems} />
      ) : (
        <span className="sr-only">Navigation</span>
      )}
      {navActions && (
        <div className="flex flex-wrap items-center gap-2">
          {navActions}
        </div>
      )}
    </div>
  ) : null

  const content = (() => {
    if (error) {
      const errorMessage = typeof error === 'string' ? error : error.message
      return (
        <Alert
          variant="error"
          title="Something went wrong"
          description={errorMessage}
          actions={
            onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-sm font-medium text-red-600 hover:text-red-500"
              >
                Try again
              </button>
            )
          }
        />
      )
    }

    if (loading) {
      return (
        <div className="flex min-h-[200px] items-center justify-center">
          <Spinner size="lg" label={loadingLabel} showLabel />
        </div>
      )
    }

    return children
  })()

  return (
    <ErrorBoundary>
      <div
        className={cn(
          'flex min-h-screen flex-col bg-gray-100 sm:-mx-6 sm:-mt-6',
          className,
        )}
      >
        <PageHeader
          title={title}
          subtitle={subtitle}
          breadcrumbs={breadcrumbs}
          backButton={backButton}
          actions={
            toolbar ? (
              <div className="flex flex-col gap-3">
                {navRow}
                {toolbar}
              </div>
            ) : navRow
          }
          className={headerClassName}
          headerActions={headerActionsNode}
        />

        <main className={cn('flex-1', padded && 'pb-4 sm:pb-6 md:pb-8')}>
          <Container
            size={containerSize}
            className={cn(
              padded && 'pt-4 sm:pt-6 md:pt-8',
              !padded && 'pt-0',
              contentClassName,
            )}
          >
            {content}
          </Container>
        </main>
      </div>
    </ErrorBoundary>
  )
}
