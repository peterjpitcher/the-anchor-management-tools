'use client'

import React, { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'

interface VirtualListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  height?: string | number
  itemHeight?: number
  overscan?: number
  className?: string
  containerClassName?: string
  getItemKey?: (item: T, index: number) => string | number
  onEndReached?: () => void
  endReachedThreshold?: number
  loading?: boolean
  loadingComponent?: React.ReactNode
  emptyComponent?: React.ReactNode
}

export function VirtualList<T>({
  items,
  renderItem,
  height = '100%',
  itemHeight = 80,
  overscan = 5,
  className,
  containerClassName,
  getItemKey,
  onEndReached,
  endReachedThreshold = 5,
  loading = false,
  loadingComponent,
  emptyComponent
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Handle infinite scroll
  React.useEffect(() => {
    if (!onEndReached) return

    const lastItem = virtualItems[virtualItems.length - 1]
    if (!lastItem) return

    if (
      lastItem.index >= items.length - endReachedThreshold &&
      !loading
    ) {
      onEndReached()
    }
  }, [virtualItems, items.length, endReachedThreshold, loading, onEndReached])

  if (items.length === 0 && !loading) {
    return (
      <div className={cn('flex items-center justify-center p-8', containerClassName)}>
        {emptyComponent || <p className="text-gray-500">No items to display</p>}
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className={cn('overflow-auto', containerClassName)}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index]
          const key = getItemKey 
            ? getItemKey(item, virtualItem.index) 
            : virtualItem.index

          return (
            <div
              key={key}
              data-index={virtualItem.index}
              className={className}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderItem(item, virtualItem.index)}
            </div>
          )
        })}
        {loading && virtualItems.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: virtualizer.getTotalSize(),
              left: 0,
              width: '100%',
              padding: '1rem',
            }}
          >
            {loadingComponent || (
              <div className="flex items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Mobile-optimized virtual list with card layout
export function VirtualCardList<T>({
  items,
  renderCard,
  gap = 16,
  ...props
}: Omit<VirtualListProps<T>, 'renderItem'> & {
  renderCard: (item: T, index: number) => React.ReactNode
  gap?: number
}) {
  return (
    <VirtualList
      items={items}
      renderItem={(item, index) => (
        <div style={{ padding: `${gap / 2}px` }}>
          {renderCard(item, index)}
        </div>
      )}
      itemHeight={120 + gap} // Typical card height + gap
      {...props}
    />
  )
}