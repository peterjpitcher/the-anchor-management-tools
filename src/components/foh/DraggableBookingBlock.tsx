'use client'

import React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'

function parseClockToMinutes(t: string): number {
  return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10)
}

interface DraggableBookingBlockProps {
  bookingId: string
  bookingLabel: string
  fromTime: string
  tableId: string
  tableName: string
  durationMinutes: number
  timelineStartMin: number
  timelineEndMin: number
  leftPct: number
  widthPct: number
  isDraggingAny: boolean
  liveSnapTime: string | null
  isOutOfBounds: boolean
  canDrag: boolean
  isManagerKiosk: boolean
  className: string
  style?: React.CSSProperties
  title?: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}

export function DraggableBookingBlock({
  bookingId,
  bookingLabel,
  fromTime,
  tableId,
  tableName,
  durationMinutes,
  timelineStartMin,
  timelineEndMin,
  leftPct,
  widthPct,
  isDraggingAny,
  liveSnapTime: _liveSnapTime,
  isOutOfBounds: _isOutOfBounds,
  canDrag,
  isManagerKiosk,
  className,
  style,
  title,
  onClick,
  children,
}: DraggableBookingBlockProps) {
  const canDragThis = canDrag && !isManagerKiosk

  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: bookingId,
    disabled: !canDragThis,
    data: {
      bookingId,
      bookingLabel,
      fromTime,
      tableId,
      tableName,
      durationMinutes,
      startMinutes: parseClockToMinutes(fromTime),
      timelineStartMin,
      timelineEndMin,
    },
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={cn(
        className,
        canDragThis && !isDraggingAny ? 'cursor-grab' : '',
        isDragging ? 'opacity-40 cursor-grabbing' : '',
      )}
      style={{
        position: 'absolute',
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        ...style,
      }}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
