'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ArrowDownIcon } from '@heroicons/react/24/outline'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
  disabled?: boolean
  threshold?: number
  className?: string
  refreshText?: string
  pullingText?: string
  releasingText?: string
}

export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  threshold = 80,
  className,
  refreshText = 'Refreshing...',
  pullingText = 'Pull to refresh',
  releasingText = 'Release to refresh'
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const currentY = useRef(0)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return
    
    const container = containerRef.current
    if (!container || container.scrollTop > 0) return
    
    startY.current = e.touches[0].clientY
    setIsPulling(true)
  }, [disabled, isRefreshing])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling || disabled || isRefreshing) return
    
    const container = containerRef.current
    if (!container || container.scrollTop > 0) {
      setIsPulling(false)
      setPullDistance(0)
      return
    }
    
    currentY.current = e.touches[0].clientY
    const distance = Math.max(0, currentY.current - startY.current)
    
    // Apply resistance for more natural feel
    const resistedDistance = Math.min(distance * 0.5, threshold * 2)
    setPullDistance(resistedDistance)
    
    // Prevent default scrolling when pulling
    if (distance > 0) {
      e.preventDefault()
    }
  }, [isPulling, disabled, isRefreshing, threshold])

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling || disabled || isRefreshing) return
    
    setIsPulling(false)
    
    if (pullDistance >= threshold) {
      setIsRefreshing(true)
      setPullDistance(threshold)
      
      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }, [isPulling, disabled, isRefreshing, pullDistance, threshold, onRefresh])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Use passive: false to allow preventDefault in touchmove
    const options = { passive: false }
    
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, options)
    container.addEventListener('touchend', handleTouchEnd, { passive: true })
    
    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  const getStatusText = () => {
    if (isRefreshing) return refreshText
    if (pullDistance >= threshold) return releasingText
    if (isPulling) return pullingText
    return ''
  }

  const rotation = Math.min(180, (pullDistance / threshold) * 180)
  const opacity = Math.min(1, pullDistance / threshold)

  return (
    <div className={cn('relative h-full overflow-hidden', className)}>
      {/* Pull indicator */}
      <div
        className="absolute left-0 right-0 top-0 z-10 flex items-center justify-center transition-opacity duration-200"
        style={{
          height: `${pullDistance}px`,
          opacity,
        }}
      >
        <div className="flex flex-col items-center justify-center">
          <ArrowDownIcon
            className={cn(
              'h-6 w-6 text-gray-600 transition-transform duration-200',
              isRefreshing && 'animate-spin'
            )}
            style={{
              transform: `rotate(${rotation}deg)`,
            }}
          />
          <span className="mt-2 text-sm text-gray-600">
            {getStatusText()}
          </span>
        </div>
      </div>
      
      {/* Content container */}
      <div
        ref={containerRef}
        className="h-full overflow-auto"
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// Hook for easy integration
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }, [onRefresh])
  
  return {
    isRefreshing,
    handleRefresh
  }
}