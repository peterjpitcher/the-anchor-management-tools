'use client'

import React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'

interface DroppableLaneTimelineProps {
  tableId: string
  tableName: string
  className: string
  canEdit: boolean
  onLaneClick: () => void
  children: React.ReactNode
}

export function DroppableLaneTimeline({
  tableId,
  tableName,
  className,
  canEdit,
  onLaneClick,
  children,
}: DroppableLaneTimelineProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: tableId,
    data: { tableName },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'ring-2 ring-inset ring-[hsl(var(--primary)/0.3)] bg-white/10')}
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={onLaneClick}
      onKeyDown={
        canEdit
          ? (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onLaneClick()
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}
