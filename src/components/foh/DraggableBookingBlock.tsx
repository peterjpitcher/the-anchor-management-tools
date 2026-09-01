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
  // Raw booking fields used to compute draggability inside this component
  canEdit: boolean
  status: string | null
  isPrivateBlock: boolean
  assignmentCount: number | null
  styleVariant: 'default' | 'manager_kiosk'
  className: string
  statusClassName: string
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
  canEdit,
  status,
  isPrivateBlock,
  assignmentCount,
  styleVariant,
  className,
  statusClassName,
  style,
  title,
  onClick,
  children,
}: DraggableBookingBlockProps) {
  // Evaluate all non-draggable conditions as specified:
  // kiosk mode, canEdit, terminal statuses, private blocks, multi-table bookings
  const canDragThis =
    styleVariant !== 'manager_kiosk' &&
    canEdit &&
    !isPrivateBlock &&
    (assignmentCount ?? 1) <= 1 &&
    status !== 'cancelled' &&
    status !== 'no_show' &&
    status !== 'completed'

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
      statusClassName,
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
        canDragThis ? 'cursor-grab' : '',
        isDragging ? 'opacity-40 cursor-grabbing' : '',
      )}
      style={{
        position: 'absolute',
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        // dnd-kit's PointerSensor needs this on touch devices. Without it the browser claims
        // the gesture as a pan of the timeline's horizontal scroller and fires pointercancel,
        // so a touch drag can never start. Only set when the block is actually draggable, so
        // panning still works by starting the gesture on a locked or non-editable block.
        ...(canDragThis ? { touchAction: 'none' as const } : null),
        ...style,
      }}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
