'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { DndContext, type DragStartEvent, type DragMoveEvent, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core'
import { DraggableBookingBlock } from '@/components/foh/DraggableBookingBlock'
import { DroppableLaneTimeline } from '@/components/foh/DroppableLaneTimeline'
import { DragConfirmationModal } from '@/components/foh/DragConfirmationModal'
import type {
  FohBooking,
  FohLane,
  FohScheduleResponse,
  FohStyleVariant,
  TimelineRange,
} from '../types'
import {
  formatBookingWindow,
  formatLaneMinuteLabel,
  getBookingVisualState,
  getBookingVisualLabel,
  getSundayPreorderBorderStyle,
  resolveBookingWindowMinutes,
  statusBlockClass,
} from '../utils'
import type { PendingMove } from '../useFohDrag'

type FohTimelineProps = {
  schedule: FohScheduleResponse['data'] | null
  date: string
  timeline: TimelineRange
  canEdit: boolean
  loading: boolean
  styleVariant: FohStyleVariant
  currentTimelineLeftPct: number | null
  // Drag state
  sensors: SensorDescriptor<SensorOptions>[]
  activeDragData: {
    bookingId: string
    bookingLabel: string
    widthPx: number
    statusClassName: string
  } | null
  pointerPosition: { x: number; y: number } | null
  liveSnapTime: string | null
  isOutOfBounds: boolean
  pendingMove: PendingMove | null
  isSubmitting: boolean
  confirmError: string | null
  // Refs
  timelineRef: React.RefObject<HTMLDivElement | null>
  // Callbacks
  onDragStart: (event: DragStartEvent) => void
  onDragMove: (event: DragMoveEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onConfirmMove: () => Promise<void>
  onCancelMove: () => void
  onBookingClick: (booking: FohBooking, laneTableId: string, laneTableName: string) => void
  onLaneClick: (lane: { table_id: string; table_name: string }) => void
}

export const FohTimeline = React.memo(function FohTimeline(props: FohTimelineProps) {
  const {
    schedule,
    date,
    timeline,
    canEdit,
    loading,
    styleVariant,
    currentTimelineLeftPct,
    sensors,
    activeDragData,
    pointerPosition,
    liveSnapTime,
    isOutOfBounds,
    pendingMove,
    isSubmitting,
    confirmError,
    timelineRef,
    onDragStart,
    onDragMove,
    onDragEnd,
    onConfirmMove,
    onCancelMove,
    onBookingClick,
    onLaneClick,
  } = props

  const isManagerKioskStyle = styleVariant === 'manager_kiosk'
  const panelSurfaceClass = isManagerKioskStyle
    ? 'rounded-xl border border-green-200 bg-white shadow-sm'
    : 'rounded-lg border border-gray-200 bg-white'
  const swimlaneCardClass = cn(panelSurfaceClass, isManagerKioskStyle ? 'p-2' : 'p-4')
  const swimlaneHeaderRowClass = cn(
    'flex items-center justify-between',
    isManagerKioskStyle ? 'mb-2' : 'mb-3'
  )
  const tableHeaderCellClass = cn(
    'font-semibold uppercase tracking-wide text-gray-600',
    isManagerKioskStyle ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'
  )
  const timelineHeaderTrackClass = cn(
    'relative',
    isManagerKioskStyle ? 'h-10 px-1.5' : 'h-10 px-2'
  )
  const laneMetaCellClass = cn(
    'space-y-1 bg-white',
    isManagerKioskStyle ? 'px-2 py-1.5' : 'px-3 py-2'
  )
  const laneTimelineClass = cn(
    'relative overflow-hidden bg-gray-50/60',
    isManagerKioskStyle ? 'h-12 pt-1' : 'h-14',
    canEdit && 'cursor-pointer hover:bg-sidebar/5'
  )
  const laneEmptyClass = cn(
    'absolute inset-0 flex items-center text-gray-400',
    isManagerKioskStyle ? 'px-2 text-[10px]' : 'px-3 text-xs'
  )
  const bookingBlockBaseClass = isManagerKioskStyle
    ? 'absolute top-0.5 h-11 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[9px] shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-sidebar/40'
    : 'absolute top-1 h-12 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[10px] shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-sidebar/40'
  const bookingOverlayBaseClass = isManagerKioskStyle
    ? 'h-11 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[9px]'
    : 'h-12 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[10px]'
  const timelineTickLabelClass = cn(
    'absolute -translate-x-1/2 font-medium text-gray-500',
    isManagerKioskStyle ? 'top-0.5 text-[9px]' : 'pt-0.5 text-[10px]'
  )
  const nowLineLabelClass = cn(
    'absolute left-0 -translate-x-1/2 rounded bg-red-600 text-white font-semibold',
    isManagerKioskStyle ? 'top-0.5 px-1 py-px text-[8px]' : 'top-0.5 px-1.5 py-px text-[9px]'
  )

  const timelineDuration = Math.max(1, timeline.endMin - timeline.startMin)

  return (
    <div className={cn(swimlaneCardClass, 'relative')}>
      <div className={swimlaneHeaderRowClass}>
        <h3 className="text-sm font-semibold text-gray-900">Table availability swimlanes</h3>
        <p className={cn('text-gray-500', isManagerKioskStyle ? 'text-[10px]' : 'text-xs')}>
          Service window {schedule?.service_window?.start_time || '09:00'} - {schedule?.service_window?.end_time || '23:00'}
          {schedule?.service_window?.end_next_day ? ' (+1 day)' : ''}
        </p>
      </div>

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/70">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-sidebar" />
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      >
        <div className="overflow-x-auto">
          <div className="min-w-[980px] border border-gray-200">
            <div className="grid grid-cols-[220px_1fr] border-b border-gray-200 bg-gray-50">
              <div className={cn(tableHeaderCellClass, 'sticky left-0 z-10 bg-gray-50')}>Table</div>
              <div ref={timelineRef} className={timelineHeaderTrackClass}>
                {timeline.ticks.map((minute) => {
                  const left = ((minute - timeline.startMin) / timelineDuration) * 100
                  return (
                    <div key={`tick-header-${minute}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
                      <div className="h-full border-l border-gray-200" />
                      <span className={timelineTickLabelClass}>
                        {formatLaneMinuteLabel(minute)}
                      </span>
                    </div>
                  )
                })}
                {currentTimelineLeftPct != null && (
                  <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${currentTimelineLeftPct}%` }}>
                    <div className="h-full w-0.5 -translate-x-1/2 bg-red-500/85" />
                    <span className={nowLineLabelClass}>Now</span>
                  </div>
                )}
              </div>
            </div>

            {(schedule?.lanes || []).map((lane) => (
              <LaneRow
                key={lane.table_id}
                lane={lane}
                schedule={schedule}
                date={date}
                timeline={timeline}
                timelineDuration={timelineDuration}
                canEdit={canEdit}
                styleVariant={styleVariant}
                currentTimelineLeftPct={currentTimelineLeftPct}
                bookingBlockBaseClass={bookingBlockBaseClass}
                laneMetaCellClass={laneMetaCellClass}
                laneTimelineClass={laneTimelineClass}
                laneEmptyClass={laneEmptyClass}
                onBookingClick={onBookingClick}
                onLaneClick={onLaneClick}
              />
            ))}
          </div>
        </div>
        {activeDragData && pointerPosition ? (
          <div
            className={cn(
              bookingOverlayBaseClass,
              activeDragData.statusClassName,
              'fixed z-[9999] pointer-events-none select-none opacity-95 shadow-xl ring-2 ring-white/70'
            )}
            style={{
              left: pointerPosition.x,
              top: pointerPosition.y,
              width: activeDragData.widthPx,
            }}
          >
            <p className="truncate font-semibold">{activeDragData.bookingLabel}</p>
            {liveSnapTime && !isOutOfBounds && (
              <p className="truncate text-xs font-semibold opacity-80">{liveSnapTime}</p>
            )}
            {isOutOfBounds && (
              <p className="truncate text-xs font-semibold text-red-200 opacity-80">Out of range</p>
            )}
          </div>
        ) : null}
      </DndContext>
      <DragConfirmationModal
        pendingMove={pendingMove}
        onConfirm={onConfirmMove}
        onCancel={onCancelMove}
        isSubmitting={isSubmitting}
        error={confirmError}
      />
    </div>
  )
})

// Inner lane row component
const LaneRow = React.memo(function LaneRow(props: {
  lane: FohLane
  schedule: FohScheduleResponse['data'] | null
  date: string
  timeline: TimelineRange
  timelineDuration: number
  canEdit: boolean
  styleVariant: FohStyleVariant
  currentTimelineLeftPct: number | null
  bookingBlockBaseClass: string
  laneMetaCellClass: string
  laneTimelineClass: string
  laneEmptyClass: string
  onBookingClick: (booking: FohBooking, laneTableId: string, laneTableName: string) => void
  onLaneClick: (lane: { table_id: string; table_name: string }) => void
}) {
  const {
    lane,
    schedule,
    date,
    timeline,
    timelineDuration,
    canEdit,
    styleVariant,
    currentTimelineLeftPct,
    bookingBlockBaseClass,
    laneMetaCellClass,
    laneTimelineClass,
    laneEmptyClass,
    onBookingClick,
    onLaneClick,
  } = props

  return (
    <div className="grid grid-cols-[220px_1fr] border-b border-gray-200 last:border-b-0">
      <div className={cn(laneMetaCellClass, 'sticky left-0 z-10')}>
        <div>
          <p className="text-xs font-semibold text-gray-900">
            {lane.table_name}
            {lane.table_number ? <span className="ml-1 text-xs text-gray-500">({lane.table_number})</span> : null}
          </p>
          <p className="text-[11px] text-gray-500">
            Capacity {lane.capacity || '-'}
            {lane.area ? ` · ${lane.area}` : ''}
            {lane.is_bookable === false ? ' · not bookable' : ''}
          </p>
        </div>
      </div>

      <DroppableLaneTimeline
        tableId={lane.table_id}
        tableName={lane.table_name}
        className={laneTimelineClass}
        canEdit={canEdit}
        onLaneClick={() => {
          onLaneClick({
            table_id: lane.table_id,
            table_name: lane.table_name
          })
        }}
      >
        {timeline.ticks.map((minute) => {
          const left = ((minute - timeline.startMin) / timelineDuration) * 100
          return (
            <div key={`tick-${lane.table_id}-${minute}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
              <div className="h-full border-l border-gray-200" />
            </div>
          )
        })}

        {lane.bookings.map((booking) => {
          const window = resolveBookingWindowMinutes(booking, schedule?.date || date)
          if (!window) return null

          const clippedStart = Math.max(window.start, timeline.startMin)
          const clippedEnd = Math.min(window.end, timeline.endMin)
          if (clippedEnd <= clippedStart) return null

          const leftPct = ((clippedStart - timeline.startMin) / timelineDuration) * 100
          const widthPct = Math.max(2.2, ((clippedEnd - clippedStart) / timelineDuration) * 100)
          const visualState = getBookingVisualState(booking)
          const visualLabel = getBookingVisualLabel(booking)
          const visualClassName = statusBlockClass(visualState)

          return (
            <DraggableBookingBlock
              key={`${lane.table_id}-${booking.id}`}
              bookingId={booking.id}
              bookingLabel={booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)}
              fromTime={booking.booking_time}
              tableId={lane.table_id}
              tableName={lane.table_name}
              durationMinutes={window.end - window.start}
              timelineStartMin={timeline.startMin}
              timelineEndMin={timeline.endMin}
              leftPct={leftPct}
              widthPct={widthPct}
              canEdit={canEdit}
              status={booking.status}
              isPrivateBlock={Boolean(booking.is_private_block)}
              assignmentCount={booking.assignment_count ?? null}
              styleVariant={styleVariant}
              className={cn(bookingBlockBaseClass, visualClassName)}
              statusClassName={visualClassName}
              style={getSundayPreorderBorderStyle(booking)}
              title={`${booking.guest_name || 'Guest'} · ${booking.booking_reference || booking.id.slice(0, 8)} · ${formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)} · ${visualLabel}`}
              onClick={(event) => {
                event.stopPropagation()
                onBookingClick(booking, lane.table_id, lane.table_name)
              }}
            >
              <p className="truncate font-semibold">
                {booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)}
              </p>
              <p className="truncate">
                {booking.is_private_block
                  ? formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)
                  : `${formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)} · ${booking.party_size || 1}p · ${visualLabel}`}
              </p>
              {booking.booking_type === 'sunday_lunch' && (
                <p
                  className={`truncate text-xs font-semibold mt-0.5 ${booking.sunday_preorder_completed_at ? 'text-green-300' : 'text-amber-300'}`}
                >
                  {booking.sunday_preorder_completed_at ? '\u2713 Pre-order done' : '\u23F3 Pre-order pending'}
                </p>
              )}
            </DraggableBookingBlock>
          )
        })}

        {currentTimelineLeftPct != null && (
          <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${currentTimelineLeftPct}%` }}>
            <div className="h-full w-0.5 -translate-x-1/2 bg-red-500/75" />
          </div>
        )}

        {lane.bookings.length === 0 && (
          <div className={laneEmptyClass}>
            {canEdit ? 'Tap lane to add walk-in' : 'Available for entire visible service window'}
          </div>
        )}
      </DroppableLaneTimeline>
    </div>
  )
})
