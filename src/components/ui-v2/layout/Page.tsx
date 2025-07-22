/**
 * Page Component
 * 
 * Used on 105/107 pages (98%)
 * 
 * Standardizes page layout with header, title, description, actions, and content.
 * Handles loading states, error states, and breadcrumbs.
 */

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Container } from './Container'
import { Spinner } from '../feedback/Spinner'
import { Alert } from '../feedback/Alert'
import { ErrorBoundary } from '../utility/ErrorBoundary'
import type { BaseComponentProps } from '../types'

export interface BreadcrumbItem {
  label: string
  href?: string
  onClick?: () => void
}

export interface PageProps extends BaseComponentProps {
  /**
   * Page title - displayed in the header
   */
  title: string
  
  /**
   * Optional description below the title
   */
  description?: string
  
  /**
   * Action buttons/links to display in the header
   */
  actions?: ReactNode
  
  /**
   * Breadcrumb navigation items
   */
  breadcrumbs?: BreadcrumbItem[]
  
  /**
   * Loading state - shows spinner overlay
   */
  loading?: boolean
  
  /**
   * Error state - shows error message
   */
  error?: Error | string | null
  
  /**
   * Retry function for error state
   */
  onRetry?: () => void
  
  /**
   * Container size
   * @default 'xl'
   */
  containerSize?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
  
  /**
   * Whether to add vertical spacing
   * @default true
   */
  spacing?: boolean
  
  /**
   * Custom header content (replaces title/description/actions)
   */
  header?: ReactNode
}

export function Page({
  title,
  description,
  actions,
  breadcrumbs,
  loading = false,
  error = null,
  onRetry,
  containerSize = '2xl',
  spacing = true,
  header,
  className,
  children,
  ...props
}: PageProps) {
  // Error state
  if (error) {
    const errorMessage = typeof error === 'string' ? error : error.message
    
    return (
      <Container size={containerSize} className="py-8">
        <Alert variant="error"
          title="Something went wrong"
          description={errorMessage}
          actions={
            onRetry && (
              <button
                onClick={onRetry}
                className="text-sm font-medium text-red-600 hover:text-red-500"
              >
                Try again
              </button>
            )
          }
        />
      </Container>
    )
  }
  
  return (
    <ErrorBoundary>
      <div
        className={cn(
          'min-h-screen bg-gray-50',
          className
        )}
        {...props}
      >
        {/* Header Section */}
        {(header || title || breadcrumbs) && (
          <div className="bg-white shadow">
            <Container size={containerSize}>
              {/* Breadcrumbs */}
              {breadcrumbs && breadcrumbs.length > 0 && (
                <nav className="py-3 border-b border-gray-200" aria-label="Breadcrumb">
                  <ol className="flex items-center space-x-2 text-sm">
                    {breadcrumbs.map((item, index) => (
                      <li key={index} className="flex items-center">
                        {index > 0 && (
                          <svg
                            className="w-4 h-4 mx-2 text-gray-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                        {item.href ? (
                          <a
                            href={item.href}
                            className="text-gray-500 hover:text-gray-700"
                          >
                            {item.label}
                          </a>
                        ) : item.onClick ? (
                          <button
                            onClick={item.onClick}
                            className="text-gray-500 hover:text-gray-700"
                          >
                            {item.label}
                          </button>
                        ) : (
                          <span className="text-gray-900 font-medium">
                            {item.label}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              
              {/* Custom header or default header */}
              {header || (
                <div className="py-6">
                  <div className="md:flex md:items-center md:justify-between">
                    <div className="flex-1 min-w-0">
                      <h1 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
                        {title}
                      </h1>
                      {description && (
                        <p className="mt-1 text-sm text-gray-500">
                          {description}
                        </p>
                      )}
                    </div>
                    {actions && (
                      <div className="mt-4 flex md:mt-0 md:ml-4 space-x-3">
                        {actions}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Container>
          </div>
        )}
        
        {/* Main Content */}
        <main className={spacing ? 'py-6 sm:py-8' : ''}>
          <Container size={containerSize}>
            {/* Loading overlay */}
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Spinner size="lg" />
              </div>
            )}
            
            {/* Content */}
            {!loading && children}
          </Container>
        </main>
      </div>
    </ErrorBoundary>
  )
}