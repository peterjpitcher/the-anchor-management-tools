'use client'

/**
 * VirtualList Component
 * 
 * High-performance list rendering for large datasets.
 * Only renders visible items to optimize performance.
 */

import { useRef, useState, useEffect, useCallback, ReactNode, CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export interface VirtualListProps<T> {
  /**
   * Array of items to render
   */
  items: T[]
  
  /**
   * Height of each item (must be fixed)
   */
  itemHeight: number
  
  /**
   * Height of the container
   */
  height: number | string
  
  /**
   * Render function for each item
   */
  renderItem: (item: T, index: number) => ReactNode
  
  /**
   * Number of items to render outside visible area
   * @default 5
   */
  overscan?: number
  
  /**
   * Key extractor function
   */
  getKey?: (item: T, index: number) => string | number
  
  /**
   * Loading state
   * @default false
   */
  loading?: boolean
  
  /**
   * Loading indicator
   */
  loadingIndicator?: ReactNode
  
  /**
   * Empty state
   */
  emptyState?: ReactNode
  
  /**
   * Callback when scroll reaches end
   */
  onEndReached?: () => void
  
  /**
   * Threshold for onEndReached (px from bottom)
   * @default 50
   */
  endReachedThreshold?: number
  
  /**
   * Whether to show scrollbar
   * @default true
   */
  showScrollbar?: boolean
  
  /**
   * Additional container classes
   */
  className?: string
  
  /**
   * Container style
   */
  style?: CSSProperties
  
  /**
   * Item container style
   */
  itemStyle?: CSSProperties
  
  /**
   * Whether items have separators
   * @default false
   */
  separated?: boolean
  
  /**
   * Separator height (included in itemHeight)
   * @default 1
   */
  separatorHeight?: number
  
  /**
   * Custom scroll handler
   */
  onScroll?: (scrollTop: number) => void
  
  /**
   * Whether to maintain scroll position when items change
   * @default false
   */
  maintainScrollPosition?: boolean
  
  /**
   * Ref to expose scroll methods
   */
  scrollRef?: React.RefObject<VirtualListHandle>
}

export interface VirtualListHandle {
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end') => void
  scrollToTop: () => void
  scrollToBottom: () => void
  getScrollPosition: () => number
}

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  renderItem,
  overscan = 5,
  getKey,
  loading = false,
  loadingIndicator,
  emptyState,
  onEndReached,
  endReachedThreshold = 50,
  showScrollbar = true,
  className,
  style,
  itemStyle,
  separated = false,
  separatorHeight = 1,
  onScroll,
  maintainScrollPosition = false,
  scrollRef,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [isScrolling, setIsScrolling] = useState(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout>()
  const lastScrollTopRef = useRef(0)
  const endReachedRef = useRef(false)
  
  // Calculate container height
  const containerHeight = typeof height === 'number' ? height : 0
  const totalHeight = items.length * itemHeight
  
  // Calculate visible range
  const startIndex = Math.floor(scrollTop / itemHeight)
  const endIndex = Math.ceil((scrollTop + containerHeight) / itemHeight)
  
  // Add overscan
  const visibleStartIndex = Math.max(0, startIndex - overscan)
  const visibleEndIndex = Math.min(items.length - 1, endIndex + overscan)
  
  // Get visible items
  const visibleItems = items.slice(visibleStartIndex, visibleEndIndex + 1)
  
  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop
    setScrollTop(newScrollTop)
    lastScrollTopRef.current = newScrollTop
    
    // Set scrolling state
    setIsScrolling(true)
    clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false)
    }, 150)
    
    // Check if end reached
    const scrollBottom = newScrollTop + containerHeight
    const threshold = totalHeight - endReachedThreshold
    
    if (scrollBottom >= threshold && !endReachedRef.current && onEndReached) {
      endReachedRef.current = true
      onEndReached()
    } else if (scrollBottom < threshold) {
      endReachedRef.current = false
    }
    
    // Custom scroll handler
    onScroll?.(newScrollTop)
  }, [containerHeight, totalHeight, endReachedThreshold, onEndReached, onScroll])
  
  // Maintain scroll position when items change
  useEffect(() => {
    if (maintainScrollPosition && scrollElementRef.current) {
      scrollElementRef.current.scrollTop = lastScrollTopRef.current
    }
  }, [items, maintainScrollPosition])
  
  // Expose scroll methods
  useEffect(() => {
    if (scrollRef) {
      const handle: VirtualListHandle = {
        scrollToIndex: (index, align = 'start') => {
          if (!scrollElementRef.current) return
          
          let scrollPosition = index * itemHeight
          
          if (align === 'center') {
            scrollPosition = scrollPosition - containerHeight / 2 + itemHeight / 2
          } else if (align === 'end') {
            scrollPosition = scrollPosition - containerHeight + itemHeight
          }
          
          scrollElementRef.current.scrollTop = Math.max(0, Math.min(scrollPosition, totalHeight - containerHeight))
        },
        scrollToTop: () => {
          if (scrollElementRef.current) {
            scrollElementRef.current.scrollTop = 0
          }
        },
        scrollToBottom: () => {
          if (scrollElementRef.current) {
            scrollElementRef.current.scrollTop = totalHeight
          }
        },
        getScrollPosition: () => scrollTop,
      }
      
      ;(scrollRef as any).current = handle
    }
  }, [scrollRef, itemHeight, containerHeight, totalHeight, scrollTop])
  
  // Empty state
  if (!loading && items.length === 0 && emptyState) {
    return (
      <div
        className={cn('flex items-center justify-center', className)}
        style={{ height, ...style }}
      >
        {emptyState}
      </div>
    )
  }
  
  return (
    <div
      ref={containerRef}
      className={cn(
        'relative',
        !showScrollbar && 'scrollbar-hide',
        className
      )}
      style={{ height, ...style }}
    >
      <div
        ref={scrollElementRef}
        className="h-full overflow-auto"
        onScroll={handleScroll}
      >
        {/* Total height container */}
        <div
          style={{
            height: totalHeight,
            position: 'relative',
          }}
        >
          {/* Visible items */}
          {visibleItems.map((item, index) => {
            const actualIndex = visibleStartIndex + index
            const key = getKey ? getKey(item, actualIndex) : actualIndex
            const top = actualIndex * itemHeight
            
            return (
              <div
                key={key}
                style={{
                  position: 'absolute',
                  top,
                  left: 0,
                  right: 0,
                  height: itemHeight,
                  ...itemStyle,
                }}
                className={cn(
                  separated && actualIndex < items.length - 1 && 'border-b border-gray-200'
                )}
              >
                {renderItem(item, actualIndex)}
              </div>
            )
          })}
          
          {/* Loading indicator */}
          {loading && loadingIndicator && (
            <div
              style={{
                position: 'absolute',
                top: items.length * itemHeight,
                left: 0,
                right: 0,
              }}
              className="flex items-center justify-center py-4"
            >
              {loadingIndicator}
            </div>
          )}
        </div>
      </div>
      
      {/* Scroll indicator */}
      {isScrolling && showScrollbar && (
        <div className="absolute right-2 top-2 bg-gray-900 text-white text-xs px-2 py-1 rounded">
          {startIndex + 1}-{Math.min(endIndex, items.length)} / {items.length}
        </div>
      )}
    </div>
  )
}

/**
 * VirtualGrid - Virtual scrolling for grid layouts
 */
export interface VirtualGridProps<T> extends Omit<VirtualListProps<T>, 'itemHeight' | 'renderItem'> {
  /**
   * Number of columns
   */
  columns: number
  
  /**
   * Row height
   */
  rowHeight: number
  
  /**
   * Gap between items
   * @default 0
   */
  gap?: number
  
  /**
   * Render function for each item
   */
  renderItem: (item: T, index: number, column: number, row: number) => ReactNode
}

export function VirtualGrid<T>({
  items,
  columns,
  rowHeight,
  gap = 0,
  renderItem,
  ...props
}: VirtualGridProps<T>) {
  // Group items into rows
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns))
  }
  
  const { getKey, ...restProps } = props
  
  return (
    <VirtualList<T[]>
      {...restProps}
      items={rows}
      itemHeight={rowHeight + gap}
      renderItem={(row, rowIndex) => (
        <div
          className="flex"
          style={{
            gap,
            padding: `${gap / 2}px`,
          }}
        >
          {row.map((item, colIndex) => {
            const itemIndex = rowIndex * columns + colIndex
            return (
              <div
                key={itemIndex}
                style={{
                  flex: `1 1 ${100 / columns}%`,
                  maxWidth: `${100 / columns}%`,
                }}
              >
                {renderItem(item, itemIndex, colIndex, rowIndex)}
              </div>
            )
          })}
          {/* Fill empty cells */}
          {row.length < columns && Array.from({ length: columns - row.length }).map((_, i) => (
            <div
              key={`empty-${i}`}
              style={{
                flex: `1 1 ${100 / columns}%`,
                maxWidth: `${100 / columns}%`,
              }}
            />
          ))}
        </div>
      )}
    />
  )
}

/**
 * useVirtualList - Hook for virtual list state management
 */
export function useVirtualList<T>(items: T[], itemHeight: number) {
  const scrollRef = useRef<VirtualListHandle>(null)
  
  const scrollToItem = (index: number, align?: 'start' | 'center' | 'end') => {
    scrollRef.current?.scrollToIndex(index, align)
  }
  
  const scrollToTop = () => {
    scrollRef.current?.scrollToTop()
  }
  
  const scrollToBottom = () => {
    scrollRef.current?.scrollToBottom()
  }
  
  const getScrollPosition = () => {
    return scrollRef.current?.getScrollPosition() || 0
  }
  
  return {
    scrollRef,
    scrollToItem,
    scrollToTop,
    scrollToBottom,
    getScrollPosition,
  }
}