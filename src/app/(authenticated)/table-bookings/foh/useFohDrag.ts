'use client'

import { useState, useRef, useCallback } from 'react'
import type React from 'react'
import {
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { snapToInterval } from './snapToInterval'

export type PendingMove =
  | {
      type: 'time'
      bookingId: string
      bookingLabel: string
      fromTime: string
      toTime: string
      tableId: string
      tableName: string
    }
  | {
      type: 'table'
      bookingId: string
      bookingLabel: string
      time: string
      fromTableId: string
      fromTableName: string
      toTableId: string
      toTableName: string
    }

interface DragBookingData {
  bookingId: string
  bookingLabel: string
  fromTime: string
  tableId: string
  tableName: string
  durationMinutes: number
  startMinutes: number
  timelineStartMin: number
  timelineEndMin: number
}

/**
 * Owns all drag-and-drop state for the FOH schedule.
 * Pass a ref to the timeline container div so we can detect out-of-bounds drags.
 */
export function useFohDrag(timelineRef: React.RefObject<HTMLElement | null>): {
  pendingMove: PendingMove | null
  isDragging: boolean
  liveSnapTime: string | null
  isOutOfBounds: boolean
  isSubmitting: boolean
  confirmError: string | null
  sensors: ReturnType<typeof useSensors>
  onDragStart: (event: DragStartEvent) => void
  onDragMove: (event: DragMoveEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  confirm: () => Promise<void>
  cancel: () => void
} {
  const [isDragging, setIsDragging] = useState(false)
  const [liveSnapTime, setLiveSnapTime] = useState<string | null>(null)
  const [isOutOfBounds, setIsOutOfBounds] = useState(false)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // Track drag data in a ref so callbacks always have fresh data without re-renders
  const dragDataRef = useRef<DragBookingData | null>(null)
  // Use a ref for isOutOfBounds to avoid stale closures in onDragEnd
  const isOutOfBoundsRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const onDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragBookingData | undefined
    if (!data) return
    dragDataRef.current = data
    setIsDragging(true)
    setLiveSnapTime(data.fromTime)
    setConfirmError(null)
  }, [])

  const onDragMove = useCallback((event: DragMoveEvent) => {
    const data = dragDataRef.current
    if (!data || !timelineRef.current) return

    const containerRect = timelineRef.current.getBoundingClientRect()
    const pointerX = (event.activatorEvent as PointerEvent).clientX + event.delta.x

    // Out-of-bounds detection
    if (pointerX < containerRect.left || pointerX > containerRect.right) {
      isOutOfBoundsRef.current = true
      setIsOutOfBounds(true)
      return
    }
    isOutOfBoundsRef.current = false
    setIsOutOfBounds(false)

    // Calculate snap position from pointer position
    const offsetPx = pointerX - containerRect.left
    const { timeString } = snapToInterval(
      offsetPx,
      containerRect.width,
      data.timelineStartMin,
      data.timelineEndMin,
      data.durationMinutes,
      15,
    )
    setLiveSnapTime(timeString)
  }, [timelineRef])

  const onDragEnd = useCallback((event: DragEndEvent) => {
    setIsDragging(false)
    setLiveSnapTime(null)

    // Prefer the ref (set by onDragStart), fall back to event data for isolated calls
    const data = dragDataRef.current ?? (event.active.data.current as DragBookingData | undefined) ?? null
    dragDataRef.current = null

    if (!data || !event.over) {
      isOutOfBoundsRef.current = false
      setIsOutOfBounds(false)
      return
    }

    // If dragged out of bounds entirely, reject the drop
    if (isOutOfBoundsRef.current) {
      isOutOfBoundsRef.current = false
      setIsOutOfBounds(false)
      return
    }

    const toTableId = String(event.over.id)
    const sameTable = toTableId === data.tableId

    if (sameTable) {
      // Time change drag
      if (!timelineRef.current) {
        isOutOfBoundsRef.current = false
        setIsOutOfBounds(false)
        return
      }
      const containerRect = timelineRef.current.getBoundingClientRect()
      const pointerX = (event.activatorEvent as PointerEvent).clientX + event.delta.x
      const offsetPx = pointerX - containerRect.left

      const { timeString: toTime } = snapToInterval(
        offsetPx,
        containerRect.width,
        data.timelineStartMin,
        data.timelineEndMin,
        data.durationMinutes,
        15,
      )

      // Only set pending if the time actually changed
      if (toTime === data.fromTime) return

      setPendingMove({
        type: 'time',
        bookingId: data.bookingId,
        bookingLabel: data.bookingLabel,
        fromTime: data.fromTime,
        toTime,
        tableId: data.tableId,
        tableName: data.tableName,
      })
    } else {
      // Table change drag — preserve original time
      const overData = event.over.data.current as { tableName?: string } | undefined
      const toTableName = overData?.tableName ?? toTableId

      setPendingMove({
        type: 'table',
        bookingId: data.bookingId,
        bookingLabel: data.bookingLabel,
        time: data.fromTime,
        fromTableId: data.tableId,
        fromTableName: data.tableName,
        toTableId,
        toTableName,
      })
    }
  }, [timelineRef])

  const confirm = useCallback(async () => {
    // Guard: if no pending move, do nothing (isSubmitting is already false)
    if (!pendingMove) return
    setIsSubmitting(true)
    setConfirmError(null)

    try {
      if (pendingMove.type === 'time') {
        const res = await fetch(`/api/foh/bookings/${pendingMove.bookingId}/time`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ time: pendingMove.toTime }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error ?? 'Failed to update booking time')
        }
      } else {
        const res = await fetch(`/api/foh/bookings/${pendingMove.bookingId}/move-table`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table_id: pendingMove.toTableId }),
        })
        if (res.status === 409) {
          const body = await res.json().catch(() => ({})) as { error?: string }
          setConfirmError(body.error ?? 'That slot is no longer available')
          return // Keep modal open on conflict
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error ?? 'Failed to move booking')
        }
      }
      setPendingMove(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setConfirmError(message)
    } finally {
      setIsSubmitting(false)
    }
  }, [pendingMove])

  const cancel = useCallback(() => {
    setPendingMove(null)
    setConfirmError(null)
  }, [])

  return {
    pendingMove,
    isDragging,
    liveSnapTime,
    isOutOfBounds,
    isSubmitting,
    confirmError,
    sensors,
    onDragStart,
    onDragMove,
    onDragEnd,
    confirm,
    cancel,
  }
}
