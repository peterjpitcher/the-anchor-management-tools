'use client'

import React, { useEffect, useRef } from 'react'
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
  FohTimelineZoom,
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
  /**
   * 'day' draws the whole opening window across the width. 'now' draws about five hours, scrolls
   * sideways and keeps the Now line in view. Defaults to 'day'.
   */
  zoom?: FohTimelineZoom
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

// The table column is as narrow as a table name allows, so the hours get the width (owner review,
// 22 November 2026: at 220px and more the day was squeezed and no guest name could be read).
const TABLE_COLUMN_PX = 160
const LANE_GRID_CLASS = 'grid grid-cols-[160px_minmax(0,1fr)]'
/** How much of the day the 'now' zoom shows across the width. */
const NOW_ZOOM_MINUTES = 5 * 60
/** After staff scroll the 'now' zoom by hand it is left alone for this long before following again. */
const FOLLOW_PAUSE_MS = 60 * 1000

// The dot beside the status word. Full class strings: Tailwind only generates what it can read.
const STATUS_DOT_CLASS: Record<string, string> = {
  confirmed: 'bg-primary',
  seated: 'bg-success',
  pending_payment: 'bg-warning',
  no_show: 'bg-danger',
  left: 'bg-text-soft',
  completed: 'bg-text-soft',
  cancelled: 'bg-text-soft',
}

/** The status in one short word, to sit beside its dot on a block. */
function shortStatusWord(visualState: string, fallback: string): string {
  if (visualState === 'pending_payment') return 'Unpaid'
  if (visualState === 'confirmed') return 'Booked'
  return fallback
}

// The markers on a timeline block, most important first, because a narrow block cuts the row off
// at its right edge: an allergy, then a deposit that is owed, then one that is paid, a Christmas
// booking, and the rest. Each is a short word in its colour, never a bordered pill: a pill cut in
// half at the edge of a block reads as a fault (owner review, 22 November 2026). The guest having
// confirmed is a tick with an accessible name.
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
  const marker = 'shrink-0 text-xs font-bold leading-4'
  return (
    <span className={cn('inline-flex flex-nowrap items-center gap-1.5', className)}>
      {noteMarker === 'allergy' ? <span className={cn(marker, 'text-danger-fg')}>Allergy</span> : null}
      {depositOwed ? (
        <span className={cn(marker, 'text-warning-fg')} title="Deposit owed">
          &pound; owed
        </span>
      ) : null}
      {deposit === 'paid' ? (
        <span className={cn(marker, 'text-success-fg')} title="Deposit paid">
          &pound; paid
        </span>
      ) : null}
      {isChristmas ? (
        <span className={cn(marker, 'text-info-fg')} title="Christmas booking">
          Xmas
        </span>
      ) : null}
      {guestConfirmed ? (
        <span className={cn(marker, 'text-success-fg')} role="img" aria-label="Confirmed by guest" title="Confirmed by guest">
          ✓
        </span>
      ) : null}
      {booking.is_outside_seating ? <span className={cn(marker, 'text-info-fg')}>Outside</span> : null}
      {highChairs > 0 ? <span className={cn(marker, 'font-medium')}>High chair ×{highChairs}</span> : null}
      {noteMarker === 'note' ? <span className={cn(marker, 'font-medium')}>Note</span> : null}
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
    zoom = 'day',
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

  // Both layouts draw the same dense timeline; styleVariant only decides whether blocks drag.
  const timelineDuration = Math.max(1, timeline.endMin - timeline.startMin)
  // How many screen-widths of hours the track is drawn across: 1 for the whole day.
  const zoomFactor = zoom === 'now' ? Math.max(1, timelineDuration / NOW_ZOOM_MINUTES) : 1

  const laneMetaCellClass = 'flex flex-col justify-center bg-surface px-2'
  // Two 16px lines for the name and one for the status: 52px of block in a 56px lane.
  const laneTimelineClass = cn(
    'relative h-14 overflow-hidden bg-surface-2/60',
    canEdit && 'cursor-pointer hover:bg-primary/5'
  )
  const laneEmptyClass = 'absolute inset-0 flex items-center px-2 text-xs text-text-soft'
  // Blocks sit inside the lane's overflow-hidden track, which would clip an outer focus ring.
  // @container lets a block show less as it gets narrower: below 7rem only the name and size.
  const bookingBlockBaseClass =
    '@container absolute top-0.5 h-13 overflow-hidden rounded-sm border px-1 py-px text-left text-xs shadow-sm transition hover:brightness-105 focus-visible:outline-hidden focus-visible:shadow-ring-inset'
  // Status colours on blocks are tints (bg-primary/15 and so on), so each block sits on an
  // opaque card of the same shape. Without it, tick lines and any overlapping block would show
  // through the text.
  const bookingUnderlayClass = 'pointer-events-none absolute top-0.5 h-13 rounded-sm bg-surface'
  const bookingOverlayBaseClass = 'h-13 overflow-hidden rounded-sm border px-1 py-px text-left text-xs'

  // The Now label must never sit on top of an hour label. Hour labels sit just right of their
  // tick, so the ones the Now label would cover are left out while it is there.
  const nowMinute = currentTimelineLeftPct == null
    ? null
    : timeline.startMin + (currentTimelineLeftPct / 100) * timelineDuration
  const hourLabelIsUnderNow = (tickMinute: number) =>
    nowMinute != null && nowMinute > tickMinute - 14 / zoomFactor && nowMinute < tickMinute + 40 / zoomFactor

  // --- The 'now' zoom keeps the Now line in the middle of the view ---
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastManualScrollAtRef = useRef(0)
  const followScrollRef = useRef(false)
  useEffect(() => {
    // A fresh choice of zoom always re-centres, whatever was scrolled before.
    lastManualScrollAtRef.current = 0
  }, [zoom])
  useEffect(() => {
    const scroller = scrollRef.current
    if (zoom !== 'now' || !scroller || currentTimelineLeftPct == null) return
    if (Date.now() - lastManualScrollAtRef.current < FOLLOW_PAUSE_MS) return
    const trackWidth = scroller.scrollWidth - TABLE_COLUMN_PX
    const visibleWidth = scroller.clientWidth - TABLE_COLUMN_PX
    const target = Math.max(0, (trackWidth * currentTimelineLeftPct) / 100 - visibleWidth / 2)
    if (Math.abs(scroller.scrollLeft - target) < 2) return
    followScrollRef.current = true
    scroller.scrollLeft = target
  }, [zoom, currentTimelineLeftPct, schedule?.date, timelineDuration])

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-surface">
      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-surface/70">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      >
        <div
          ref={scrollRef}
          className="overflow-x-auto"
          onScroll={() => {
            if (followScrollRef.current) { followScrollRef.current = false; return }
            lastManualScrollAtRef.current = Date.now()
          }}
        >
          <div
            className="min-w-[900px]"
            style={zoomFactor > 1
              ? { width: `calc(${TABLE_COLUMN_PX}px + (100% - ${TABLE_COLUMN_PX}px) * ${zoomFactor.toFixed(4)})` }
              : undefined}
          >
            {/* The hour row: its own band above the lanes, opaque and above them, so no block
                can ever cover an hour label. */}
            <div className={cn(LANE_GRID_CLASS, 'relative z-20 border-b border-border bg-surface-2')}>
              <div className="sticky left-0 z-30 flex items-center bg-surface-2 px-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Table
              </div>
              {/* No horizontal padding. The drag snap measures this element and converts a pointer
                  offset into a time, but the lane tracks below it have no padding, so any here
                  made the header a few pixels wider than the lanes and skewed every snapped time. */}
              <div ref={timelineRef} className="relative h-7 overflow-hidden">
                {timeline.ticks.map((minute) => {
                  const left = ((minute - timeline.startMin) / timelineDuration) * 100
                  return (
                    <div key={`tick-header-${minute}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
                      <div className="h-full border-l border-border" />
                      {hourLabelIsUnderNow(minute) ? null : (
                        <span className="absolute left-1 top-1.5 whitespace-nowrap text-xs font-medium leading-4 text-text-muted">
                          {formatLaneMinuteLabel(minute)}
                        </span>
                      )}
                    </div>
                  )
                })}
                {currentTimelineLeftPct != null && (
                  <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${currentTimelineLeftPct}%` }}>
                    <div className="h-full w-0.5 -translate-x-1/2 bg-danger/85" />
                    <span className="absolute left-0 top-1 -translate-x-1/2 rounded-sm bg-danger px-1 text-xs font-semibold leading-4 text-on-dark">
                      Now
                    </span>
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
            className="fixed z-[9999] pointer-events-none select-none rounded-sm bg-surface opacity-95 shadow-lg ring-2 ring-white/70"
            style={{
              left: pointerPosition.x,
              top: pointerPosition.y,
              width: activeDragData.widthPx,
            }}
          >
            <div className={cn(bookingOverlayBaseClass, activeDragData.statusClassName)}>
              <p className="truncate font-semibold">{activeDragData.bookingLabel}</p>
              {liveSnapTime && !isOutOfBounds && (
                <p className="truncate text-xs font-semibold opacity-80">{formatTime12Hour(liveSnapTime)}</p>
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

/**
 * What a timeline block says (owner review, 22 November 2026). The NAME comes first, with the
 * party size, and may run onto a second line before it is cut. Under it, when the block is wide
 * enough: a status dot with one short word, the markers, and the times if there is still room. A
 * narrow block shows the name and size only; everything else is in the panel on tap.
 */
export function BookingBlockContent({ booking }: { booking: FohBooking }) {
  const visualState = getBookingVisualState(booking)
  const statusWord = shortStatusWord(visualState, getBookingVisualLabel(booking))
  const guestLabel = booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)
  const windowLabel = formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)
  const isPlainBooking = !booking.is_private_block && !booking.capacity_label

  return (
    <>
      <span className="line-clamp-2 block break-words font-bold leading-4">
        {guestLabel}
        {isPlainBooking ? ` · ${booking.party_size || 1}` : ''}
      </span>
      <span className="hidden items-center gap-1.5 overflow-hidden whitespace-nowrap leading-4 @min-[7rem]:flex">
        {booking.is_private_block ? (
          <span className="shrink-0 font-medium">Private hire</span>
        ) : booking.capacity_label ? (
          <span className="shrink-0 font-medium">{booking.capacity_label}</span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 font-medium">
            <span aria-hidden="true" className={cn('size-2 rounded-full', STATUS_DOT_CLASS[visualState] ?? 'bg-text-soft')} />
            {statusWord}
          </span>
        )}
        <BookingMarkers booking={booking} />
        <span className="hidden shrink-0 font-normal opacity-80 @min-[13rem]:inline">{windowLabel}</span>
      </span>
    </>
  )
}

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
        const detailLine = booking.is_private_block
          ? `Private hire · ${windowLabel}`
          : booking.capacity_label
            ? `${booking.capacity_label} · ${windowLabel}`
            : `${booking.party_size || 1} people · ${visualLabel} · ${windowLabel}`
        // A sitting cut short when the party left can be a sliver. Every block keeps room for a
        // first name and the party size; a later booking on the lane is drawn over its tail.
        const minWidth = { minWidth: '6rem' }

        return (
          <React.Fragment key={`${lane.table_id}-${booking.id}`}>
            <div
              aria-hidden="true"
              className={bookingUnderlayClass}
              style={{ left: `${leftPct}%`, width: `${widthPct}%`, ...minWidth }}
            />
            <DraggableBookingBlock
              bookingId={booking.id}
              bookingLabel={guestLabel}
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
              style={minWidth}
              title={`${guestLabel} · ${booking.booking_reference || booking.id.slice(0, 8)} · ${detailLine}`}
              onClick={(event) => {
                event.stopPropagation()
                onBookingClick(booking, lane.table_id, lane.table_name)
              }}
            >
              <BookingBlockContent booking={booking} />
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
          {canEdit ? 'Tap to add a walk-in' : 'Free all day'}
        </div>
      )}
    </>
  )

  const seats = lane.capacity ? `${lane.capacity} seats` : null
  const fullLabel = [
    lane.table_name,
    lane.table_number ? `table ${lane.table_number}` : null,
    seats,
    lane.area,
    lane.is_bookable === false ? 'not bookable' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className={cn(LANE_GRID_CLASS, 'border-b border-border last:border-b-0')}>
      {/* The name and the seats only: the table number and the room are in the title, for anyone
          who needs them, and no longer take the width the hours need. */}
      <div className={cn(laneMetaCellClass, 'sticky left-0 z-10 border-r border-border')} title={fullLabel}>
        <p className="truncate text-sm font-semibold leading-5 text-text">{lane.table_name}</p>
        <p className="truncate text-xs leading-4 text-text-muted">
          {seats ?? 'Seats not set'}
          {lane.is_bookable === false ? ' · not bookable' : ''}
        </p>
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
