'use client'

import React, { useRef, useState } from 'react'
import { useSwipeToAction } from '@/hooks/use-swipe'
import { TrashIcon, PencilIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

interface SwipeableItemProps {
  children: React.ReactNode
  onDelete?: () => void
  onEdit?: () => void
  deleteLabel?: string
  editLabel?: string
  className?: string
  actionsClassName?: string
}

export function SwipeableItem({
  children,
  onDelete,
  onEdit,
  deleteLabel = 'Delete',
  editLabel = 'Edit',
  className,
  actionsClassName
}: SwipeableItemProps) {
  const itemRef = useRef<HTMLDivElement>(null)
  const [showActions, setShowActions] = useState(false)

  useSwipeToAction(itemRef, {
    onSwipeLeft: () => setShowActions(true),
    onSwipeRight: () => setShowActions(false),
    threshold: 50
  })

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Background actions */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex items-center gap-2 px-4 transition-opacity',
          showActions ? 'opacity-100' : 'opacity-0 pointer-events-none',
          actionsClassName
        )}
      >
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white shadow-md active:scale-95"
            aria-label={editLabel}
          >
            <PencilIcon className="h-5 w-5" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white shadow-md active:scale-95"
            aria-label={deleteLabel}
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Main content */}
      <div
        ref={itemRef}
        className={cn(
          'relative bg-white transition-transform',
          showActions && '-translate-x-32'
        )}
        onClick={() => showActions && setShowActions(false)}
      >
        {children}
      </div>
    </div>
  )
}

// Swipeable card for mobile
interface SwipeableCardProps {
  children: React.ReactNode
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  className?: string
}

export function SwipeableCard({
  children,
  onSwipeLeft,
  onSwipeRight,
  className
}: SwipeableCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null)

  useSwipeToAction(cardRef, {
    onSwipeLeft: () => {
      setSwipeDirection('left')
      setTimeout(() => {
        onSwipeLeft?.()
        setSwipeDirection(null)
      }, 300)
    },
    onSwipeRight: () => {
      setSwipeDirection('right')
      setTimeout(() => {
        onSwipeRight?.()
        setSwipeDirection(null)
      }, 300)
    },
    threshold: 100,
    rubberBandEffect: true
  })

  return (
    <div
      ref={cardRef}
      className={cn(
        'transition-all duration-300',
        swipeDirection === 'left' && '-translate-x-full opacity-0',
        swipeDirection === 'right' && 'translate-x-full opacity-0',
        className
      )}
    >
      {children}
    </div>
  )
}