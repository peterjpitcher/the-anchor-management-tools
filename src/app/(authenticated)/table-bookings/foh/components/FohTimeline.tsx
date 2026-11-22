'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { bookingNoteMarker } from '@/lib/table-bookings/allergy-words'
import { isChristmasBookingType } from '@/lib/table-bookings/christmas'
import { getTableBookingDepositState } from '@/lib/table-bookings/ui'
import { formatTime12Hour } from '@/lib/dateUtils'
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

// The markers on a timeline block, most important first, because a narrow block cuts the row off
// at its right edge: an allergy, then a deposit that is owed, then one that is paid, a Christmas
// booking, and the rest. Each is a word as well as a colour, at the smallest body size (12px):
// the 10px pills this replaces could not be read at arm's length from the till (owner decision,
// 22 November 2026). Rendered identically on FOH blocks so seating context reads the same.
export function BookingMarkers({ booking, className }: { booking: FohBooking; className?: string }) {
  if (booking.is_private_block) return null
  const highChairs = booking.high_chair_count ?? 0
  // Allergy in red when the allergy field is filled in, a note mentions an allergen or a guest's seat
  // records one, otherwise Note when the booking carries one (BK-052): allergies have mostly arrived
  // in the notes.
  const noteMarker = bookingNoteMarker({
    allergies: booking.allergies,
    dietaryRequirements: booking.dietary_requirements,
    notes: booking.special_requirements,
    guestAllergies: booking.guest_allergies,
  })
  // The guest tapped 'confirm' on the day-before text (BK-094).
  const guestConfirmed = Boolean(booking.guest_confirmed_at)
  // Read from the booking itself, never the payments ledger: a PayPal deposit lives on the booking.
  const deposit = getTableBookingDepositState(booking).kind
  const depositOwed = deposit === 'pending' || deposit === 'required'
  const isChristmas = isChristmasBookingType(booking.booking_type)
  if (
    !booking.is_outside_seating && highChairs <= 0 && !noteMarker && !guestConfirmed
    && deposit !== 'paid' && !depositOwed && !isChristmas
  ) return null
  const pill = 'inline-flex shrink-0 items-center rounded-pill border px-1.5 text-xs font-semibold leading-4'
  return (
    <span className={cn('flex flex-nowrap items-center gap-1 overflow-hidden', className)}>
      {noteMarker === 'allergy' ? (
        <span className={cn(pill, 'border-danger-border bg-danger-soft text-danger-fg')}>Allergy</span>
      ) : null}
      {depositOwed ? (
        <span className={cn(pill, 'border-warning-border bg-warning-soft text-warning-fg')} title="Deposit owed">
          &pound; owed
        </span>
      ) : null}
      {deposit === 'paid' ? (
        <span className={cn(pill, 'border-success-border bg-success-soft text-success-fg')} title="Deposit paid">
          &pound; paid
        </span>
      ) : null}
      {isChristmas ? (
        <span className={cn(pill, 'border-info-border bg-info-soft text-info-fg')} title="Christmas booking">
          Xmas
        </span>
      ) : null}
      {booking.is_outside_seating ? (
        <span className={cn(pill, 'border-transparent bg-info-soft text-info-fg')}>Outside</span>
      ) : null}
      {highChairs > 0 ? (
        <span className={cn(pill, 'border-border bg-surface-2 text-text-muted')}>High chair ×{highChairs}</span>
      ) : null}
      {guestConfirmed ? (
        <span className={cn(pill, 'border-transparent bg-success-soft text-success-fg')} title="Confirmed by guest">
          Confirmed ✓
        </span>
      ) : null}
      {noteMarker === 'note' ? (
        <span className={cn(pill, 'border-border bg-surface-2 text-text-muted')}>Note</span>
      ) : null}
    </span>
  )
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
  // One card treatment for both styles; the kiosk only packs it tighter.
  const swimlaneCardClass = cn('rounded-lg border border-border bg-surface', isManagerKioskStyle ? 'p-2' : 'p-4')
  const swimlaneHeaderRowClass = cn(
    'flex items-center justify-between',
    isManagerKioskStyle ? 'mb-2' : 'mb-3'
  )
  const tableHeaderCellClass = cn(
    'font-semibold uppercase tracking-wide text-text-muted',
    isManagerKioskStyle ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-xs'
  )
  // No horizontal padding. The drag snap measures this element and converts a pointer offset
  // into a time, but the lane tracks below it have no padding, so any here made the header a
  // few pixels wider than the lanes and skewed every snapped time by that difference.
  const timelineHeaderTrackClass = 'relative h-10'
  const laneMetaCellClass = cn(
    'space-y-1 bg-surface',
    isManagerKioskStyle ? 'px-2 py-1.5' : 'px-3 py-2'
  )
  const laneTimelineClass = cn(
    // Tall enough for three 12px lines in a block: who and what state, the name, the markers.
    'relative h-16 overflow-hidden bg-surface-2/60',
    canEdit && 'cursor-pointer hover:bg-primary/5'
  )
  const laneEmptyClass = cn(
    'absolute inset-0 flex items-center text-text-soft',
    isManagerKioskStyle ? 'px-2 text-xs' : 'px-3 text-xs'
  )
  // Blocks sit inside the lane's overflow-hidden track, which would clip an outer focus ring.
  // Block text is 12px, the smallest body size: nothing on a block is 10px any more.
  const bookingBlockBaseClass = cn(
    'absolute top-1 h-14 overflow-hidden rounded-md border py-0.5 text-left text-xs shadow-sm transition hover:brightness-105 focus-visible:outline-hidden focus-visible:shadow-ring-inset',
    isManagerKioskStyle ? 'px-1' : 'px-1.5'
  )
  // Status colours on blocks are tints (bg-primary/15 and so on), so each block sits on an
  // opaque card of the same shape. Without it, tick lines and any overlapping block would show
  // through the text.
  const bookingUnderlayClass = 'pointer-events-none absolute top-1 h-14 rounded-md bg-surface'
  const bookingOverlayBaseClass = cn(
    'h-14 overflow-hidden rounded-md border py-0.5 text-left text-xs',
    isManagerKioskStyle ? 'px-1' : 'px-1.5'
  )
  const timelineTickLabelClass = cn(
    'absolute -translate-x-1/2 text-xs font-medium text-text-muted',
    isManagerKioskStyle ? 'top-0.5' : 'pt-0.5'
  )
  const nowLineLabelClass = cn(
    'absolute left-0 top-0.5 -translate-x-1/2 rounded-sm bg-danger py-px text-xs font-semibold text-on-dark',
    isManagerKioskStyle ? 'px-1' : 'px-1.5'
  )

  const timelineDuration = Math.max(1, timeline.endMin - timeline.startMin)

  return (
    <div className={cn(swimlaneCardClass, 'relative')}>
      <div className={swimlaneHeaderRowClass}>
        <h3 className="text-sm font-semibold text-text">Table availability swimlanes</h3>
        <p className="text-xs text-text-muted">
          {schedule?.service_window?.source === 'closed' ? (
            'Closed all day'
          ) : (
            <>
              Open {formatTime12Hour(schedule?.service_window?.start_time || '09:00')} to{' '}
              {formatTime12Hour(schedule?.service_window?.end_time || '23:00')}
              {schedule?.service_window?.end_next_day ? ' (next day)' : ''}
            </>
          )}
        </p>
      </div>

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-surface/70">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      >
        <div className="overflow-x-auto">
          <div className="min-w-[980px] border border-border">
            <div className="grid grid-cols-[220px_1fr] border-b border-border bg-surface-2">
              <div className={cn(tableHeaderCellClass, 'sticky left-0 z-10 bg-surface-2')}>Table</div>
              <div ref={timelineRef} className={timelineHeaderTrackClass}>
                {timeline.ticks.map((minute) => {
                  const left = ((minute - timeline.startMin) / timelineDuration) * 100
                  return (
                    <div key={`tick-header-${minute}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
                      <div className="h-full border-l border-border" />
                      <span className={timelineTickLabelClass}>
                        {formatLaneMinuteLabel(minute)}
                      </span>
                    </div>
                  )
                })}
                {currentTimelineLeftPct != null && (
                  <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${currentTimelineLeftPct}%` }}>
                    <div className="h-full w-0.5 -translate-x-1/2 bg-danger/85" />
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
                bookingUnderlayClass={bookingUnderlayClass}
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
          // The opaque card underneath keeps the tinted status colour readable over the page.
          <div
            className="fixed z-[9999] pointer-events-none select-none rounded-md bg-surface opacity-95 shadow-lg ring-2 ring-white/70"
            style={{
              left: pointerPosition.x,
              top: pointerPosition.y,
              width: activeDragData.widthPx,
            }}
          >
            <div className={cn(bookingOverlayBaseClass, activeDragData.statusClassName)}>
              <p className="truncate font-semibold">{activeDragData.bookingLabel}</p>
              {liveSnapTime && !isOutOfBounds && (
                <p className="truncate text-xs font-semibold opacity-80">{liveSnapTime}</p>
              )}
              {isOutOfBounds && (
                <p className="truncate text-xs font-semibold text-danger-fg">Out of range</p>
              )}
            </div>
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
  bookingUnderlayClass: string
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
    bookingUnderlayClass,
    laneMetaCellClass,
    laneTimelineClass,
    laneEmptyClass,
    onBookingClick,
    onLaneClick,
  } = props

  const trackContent = (
    <>
      {timeline.ticks.map((minute) => {
        const left = ((minute - timeline.startMin) / timelineDuration) * 100
        return (
          <div key={`tick-${lane.table_id}-${minute}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
            <div className="h-full border-l border-border" />
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
        const isEventOnlyBlock = Boolean(booking.is_communal_event_block || booking.id.startsWith('communal-') || booking.id.startsWith('standing-'))
        const isLockedBlock = isEventOnlyBlock
        const windowLabel = formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)
        const guestLabel = booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)
        // Party size and state come first, in words, so they are what is left when a narrow block
        // cuts its text off. The colour says the same thing, but never on its own.
        const headline = booking.is_private_block
          ? 'Private hire'
          : booking.capacity_label
            ? booking.capacity_label
            : `${booking.party_size || 1} · ${visualLabel}`
        const detailLine = `${headline} · ${windowLabel}`

        return (
          <React.Fragment key={`${lane.table_id}-${booking.id}`}>
            <div
              aria-hidden="true"
              className={bookingUnderlayClass}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            />
            <DraggableBookingBlock
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
              canEdit={canEdit && !isLockedBlock}
              status={booking.status}
              isPrivateBlock={Boolean(booking.is_private_block)}
              assignmentCount={booking.assignment_count ?? null}
              styleVariant={styleVariant}
              className={cn(bookingBlockBaseClass, visualClassName)}
              statusClassName={visualClassName}
              title={`${booking.guest_name || 'Guest'} · ${booking.booking_reference || booking.id.slice(0, 8)} · ${detailLine}`}
              onClick={(event) => {
                event.stopPropagation()
                onBookingClick(booking, lane.table_id, lane.table_name)
              }}
            >
              <p className="truncate font-bold leading-4">{headline}</p>
              <p className="truncate leading-4">
                {guestLabel}
                <span className="font-normal"> · {windowLabel}</span>
              </p>
              <BookingMarkers booking={booking} className="mt-0.5" />
            </DraggableBookingBlock>
          </React.Fragment>
        )
      })}

      {currentTimelineLeftPct != null && (
        <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${currentTimelineLeftPct}%` }}>
          <div className="h-full w-0.5 -translate-x-1/2 bg-danger/75" />
        </div>
      )}

      {lane.bookings.length === 0 && (
        <div className={laneEmptyClass}>
          {canEdit ? 'Tap lane to add walk-in' : 'Available for entire visible service window'}
        </div>
      )}
    </>
  )

  return (
    <div className="grid grid-cols-[220px_1fr] border-b border-border last:border-b-0">
      <div className={cn(laneMetaCellClass, 'sticky left-0 z-10')}>
        <div>
          <p className="text-xs font-semibold text-text">
            {lane.table_name}
            {lane.table_number ? <span className="ml-1 text-xs text-text-muted">({lane.table_number})</span> : null}
          </p>
          <p className="text-xs text-text-muted">
            Seats {lane.capacity || '-'}
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
        {trackContent}
      </DroppableLaneTimeline>
    </div>
  )
})
