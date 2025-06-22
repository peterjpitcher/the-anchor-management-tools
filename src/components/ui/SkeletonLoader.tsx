import React from 'react'

interface SkeletonLoaderProps {
  variant?: 'text' | 'card' | 'table' | 'list' | 'custom'
  lines?: number
  className?: string
}

export function SkeletonLoader({ variant = 'text', lines = 1, className = '' }: SkeletonLoaderProps) {
  if (variant === 'text') {
    return (
      <div className={`animate-pulse space-y-3 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-4 bg-gray-200 rounded w-full" />
        ))}
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div className={`bg-white shadow sm:rounded-lg p-6 animate-pulse ${className}`}>
        <div className="h-6 bg-gray-200 rounded w-3/4 mb-4" />
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded" />
          <div className="h-4 bg-gray-200 rounded w-5/6" />
        </div>
      </div>
    )
  }

  if (variant === 'table') {
    return (
      <div className={`bg-white shadow overflow-hidden sm:rounded-lg ${className}`}>
        <div className="animate-pulse">
          {/* Header */}
          <div className="bg-gray-50 px-6 py-3">
            <div className="h-4 bg-gray-300 rounded w-full" />
          </div>
          {/* Rows */}
          <div className="divide-y divide-gray-200">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-6 py-4 flex space-x-4">
                <div className="h-4 bg-gray-200 rounded w-1/4" />
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-4 bg-gray-200 rounded w-1/6" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'list') {
    return (
      <div className={`bg-white shadow overflow-hidden sm:rounded-lg divide-y divide-gray-200 ${className}`}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-4 py-4 sm:px-6 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
              <div className="h-8 w-8 bg-gray-200 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Custom variant - just return the wrapper
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="h-4 bg-gray-200 rounded w-3/4" />
      <div className="space-y-3 mt-4">
        <div className="h-4 bg-gray-200 rounded" />
        <div className="h-4 bg-gray-200 rounded w-5/6" />
      </div>
    </div>
  )
}

// Specific skeleton for loading spinner
export function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex justify-center p-4 ${className}`}>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
    </div>
  )
}

// Page loading skeleton
export function PageLoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <SkeletonLoader variant="text" lines={2} />
        </div>
      </div>
      
      {/* Content */}
      <SkeletonLoader variant="table" />
    </div>
  )
}