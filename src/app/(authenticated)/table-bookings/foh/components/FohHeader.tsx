'use client'

import React, { useEffect, useState } from 'react'
import { Alert, Button, Icon, IconButton, LinkButton, Popover } from '@/ds'
import { cn } from '@/lib/utils'
import type { FohUpcomingEvent, FohStyleVariant, FohCreateMode, FohTimelineZoom, FohViewMode } from '../types'
import { formatDateInLondon } from '@/lib/dateUtils'
import { formatNextEventUrgency, shiftIsoDate } from '../utils'

type FohHeaderProps = {
  date: string
  setDate: (date: string | ((current: string) => string)) => void
  canEdit: boolean
  styleVariant: FohStyleVariant
  clockNow: Date
  /** The service date in force: the night before, from midnight until an after-midnight close. */
  serviceDateNow: string
  totals: { bookings: number; covers: number; privateHireGuests?: number | null }
  viewMode: FohViewMode
  outsideCount: number
  onViewModeChange: (mode: FohViewMode) => void
  nextUpcomingEvent: FohUpcomingEvent | null
  upcomingEventsLoaded: boolean
  submittingFoodOrderAlert: boolean
  statusMessage: string | null
  errorMessage: string | null
  /** Lines staff must read after a party-size change; kept until dismissed (BK-043). */
  staffNotice?: string[] | null
  onDismissStaffNotice?: () => void
  lastInteractionAtMsRef: React.MutableRefObject<number>
  /** The name search, and the "last updated" line or its warning. Built by the screen. */
  search?: React.ReactNode
  freshness?: React.ReactNode
  /** The freshness slot is showing its warning, which needs the whole width. */
  freshnessWide?: boolean
  /** Day or Now on the timeline. The control is left out when no handler is given. */
  timelineZoom?: FohTimelineZoom
  onTimelineZoomChange?: (zoom: FohTimelineZoom) => void
  /** "Open 12pm to 10pm", or "Closed all day". */
  openHoursLabel?: string | null
  /** settings manage: Table Setup is offered in the More menu. */
  canManageSettings?: boolean
  onSendFoodOrderAlert: () => void
  onOpenCreateModal: (options?: {
    mode?: FohCreateMode
    laneTableId?: string
    laneTableName?: string
    suggestedTime?: string
    prefill?: Partial<{ booking_date: string; purpose: 'food' | 'drinks' | 'event'; event_id: string }>
  }) => void
}

// Every control is 44px tall for a thumb but only as wide as its word: the old header's buttons
// were full size, stacked in six bands, and pushed the first table 60% of the way down the screen
// (owner review, 22 November 2026).
const COMPACT_CONTROL = 'min-h-touch shrink-0 px-2.5'

/**
 * The floor screen's toolbar: one row of controls and one slim line of facts.
 *
 *  - Left: the day (previous, date, next, today).
 *  - Middle: the name search, sized to what is left.
 *  - Right: Inside or Outside, Day or Now, Walk-in, Add booking, and "More" for what is used
 *    rarely (Food Order, Checklists, Vouchers, Table Setup, booking guests onto the next event).
 *  - Under it, as plain small text: bookings and covers, the next event, opening hours and when
 *    the screen was last updated.
 */
export const FohHeader = React.memo(function FohHeader(props: FohHeaderProps) {
  const {
    date,
    setDate,
    canEdit,
    styleVariant,
    clockNow,
    serviceDateNow,
    totals,
    viewMode,
    outsideCount,
    onViewModeChange,
    nextUpcomingEvent,
    upcomingEventsLoaded,
    submittingFoodOrderAlert,
    statusMessage,
    errorMessage,
    staffNotice,
    onDismissStaffNotice,
    lastInteractionAtMsRef,
    search,
    freshness,
    freshnessWide = false,
    timelineZoom = 'day',
    onTimelineZoomChange,
    openHoursLabel,
    canManageSettings = false,
    onSendFoodOrderAlert,
    onOpenCreateModal,
  } = props

  const isManagerKioskStyle = styleVariant === 'manager_kiosk'
  const viewingToday = date === serviceDateNow
  const touch = () => { lastInteractionAtMsRef.current = Date.now() }
  const openNowCreateModal = (mode: FohCreateMode) => {
    // A walk-in is always the day being worked, so the screen goes back to it. "Add booking"
    // keeps the date being looked at (owner decision, 22 November 2026): it used to jump to today.
    if (mode === 'walk_in') setDate(serviceDateNow)
    touch()
    onOpenCreateModal({ mode })
  }

  // "Food Order" texts the kitchen, and a text cannot be taken back, so the first tap asks and the
  // second sends. The question takes itself away after a few seconds if nobody answers it.
  const [confirmingFoodOrder, setConfirmingFoodOrder] = useState(false)
  useEffect(() => {
    if (!confirmingFoodOrder) return
    const timer = window.setTimeout(() => setConfirmingFoodOrder(false), 8000)
    return () => window.clearTimeout(timer)
  }, [confirmingFoodOrder])

  const dateInputClass =
    'min-h-touch w-36 shrink-0 rounded-sm border border-border-strong bg-surface px-2 text-ui text-text outline-hidden focus:border-border-focus focus:shadow-ring'
  const segmentGroupClass = 'inline-flex shrink-0 items-center rounded-default border border-border-strong bg-surface-hover p-0.5'
  const segmentClass = (active: boolean) =>
    cn(
      'min-h-touch rounded-sm px-2.5 text-xs font-medium transition focus-visible:outline-hidden focus-visible:shadow-ring',
      active ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
    )
  const factClass = 'whitespace-nowrap'
  const alertGap = 'mt-2'

  return (
    <div className={cn('rounded-lg border border-border bg-surface', isManagerKioskStyle ? 'p-2' : 'p-3')}>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* The day */}
        <IconButton
          type="button"
          variant="secondary"
          label="Previous day"
          icon={<Icon name="chevronLeft" size={18} />}
          onClick={() => { setDate((current: string) => shiftIsoDate(current, -1)); touch() }}
          className="size-11 shrink-0"
        />
        <input
          id="foh-date"
          type="date"
          aria-label="Service date"
          value={date}
          onChange={(event) => { setDate(event.target.value); touch() }}
          className={dateInputClass}
        />
        <IconButton
          type="button"
          variant="secondary"
          label="Next day"
          icon={<Icon name="chevronRight" size={18} />}
          onClick={() => { setDate((current: string) => shiftIsoDate(current, 1)); touch() }}
          className="size-11 shrink-0"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={viewingToday}
          onClick={() => { setDate(serviceDateNow); touch() }}
          className={COMPACT_CONTROL}
        >
          Today
        </Button>

        {/* The search takes what is left, and no more than it needs. */}
        {search ? <div className="min-w-44 max-w-md flex-1">{search}</div> : <div className="flex-1" />}

        {/* View toggle: always visible (a view control, not gated by canEdit). */}
        <div className={segmentGroupClass} role="group" aria-label="Seating view">
          <button
            type="button"
            onClick={() => onViewModeChange('inside')}
            aria-pressed={viewMode === 'inside'}
            className={segmentClass(viewMode === 'inside')}
          >
            Inside
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('outside')}
            aria-pressed={viewMode === 'outside'}
            className={segmentClass(viewMode === 'outside')}
          >
            Outside ({outsideCount})
          </button>
        </div>

        {onTimelineZoomChange && viewMode === 'inside' && (
          <div className="inline-flex shrink-0 items-center gap-0.5" role="group" aria-label="Timeline zoom">
            <Button
              type="button"
              variant={timelineZoom === 'day' ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={timelineZoom === 'day'}
              title="The whole day across the screen"
              onClick={() => { onTimelineZoomChange('day'); touch() }}
              className={COMPACT_CONTROL}
            >
              Day
            </Button>
            <Button
              type="button"
              variant={timelineZoom === 'now' ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={timelineZoom === 'now'}
              title="About five hours around now, larger"
              onClick={() => { onTimelineZoomChange('now'); touch() }}
              className={COMPACT_CONTROL}
            >
              Now
            </Button>
          </div>
        )}

        {canEdit && (
          <>
            <Button type="button" variant="primary" size="sm" onClick={() => openNowCreateModal('walk_in')} className={COMPACT_CONTROL}>
              Walk-in
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => openNowCreateModal('booking')} className={COMPACT_CONTROL}>
              Add booking
            </Button>
          </>
        )}

        {/* Everything used rarely, behind one button. */}
        <Popover
          align="right"
          width="sm"
          label="More"
          panelClassName="p-2"
          trigger={
            <Button type="button" variant="secondary" size="sm" className={COMPACT_CONTROL} iconRight={<Icon name="chevronDown" size={14} />}>
              More
            </Button>
          }
        >
          {({ close }) => (
            <div className="flex flex-col gap-1.5" data-touch-targets="">
              {canEdit && (
                // Deliberately loud: it texts the kitchen, so it stays red and in capitals. It
                // only asks here; the text goes on the second tap.
                <Button
                  type="button"
                  variant="danger"
                  disabled={submittingFoodOrderAlert}
                  aria-label="Food order: text the kitchen"
                  onClick={() => { close(); setConfirmingFoodOrder(true); touch() }}
                  className="min-h-touch w-full font-extrabold uppercase tracking-wide"
                >
                  {submittingFoodOrderAlert ? 'Sending...' : 'Food Order'}
                </Button>
              )}
              {canEdit && nextUpcomingEvent && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    close()
                    touch()
                    onOpenCreateModal({
                      mode: 'booking',
                      prefill: { booking_date: nextUpcomingEvent.date, purpose: 'event', event_id: nextUpcomingEvent.id },
                    })
                  }}
                  className="h-auto min-h-touch w-full whitespace-normal py-1 text-left"
                >
                  Book guests for {nextUpcomingEvent.name}
                </Button>
              )}
              <LinkButton href="/checklists" variant="secondary" className="min-h-touch w-full">
                Checklists
              </LinkButton>
              <LinkButton href="/vouchers/foh" variant="secondary" className="min-h-touch w-full">
                Vouchers
              </LinkButton>
              {canManageSettings && (
                <LinkButton href="/settings/table-bookings" variant="secondary" className="min-h-touch w-full">
                  Table Setup
                </LinkButton>
              )}
            </div>
          )}
        </Popover>
      </div>

      {canEdit && confirmingFoodOrder && (
        <div
          role="group"
          aria-label="Text the kitchen?"
          className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-danger-border bg-danger-soft px-2 py-1"
        >
          <span className="text-sm font-semibold text-danger-fg">Text the kitchen that a food order is in?</span>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => { setConfirmingFoodOrder(false); onSendFoodOrderAlert() }}
            className={cn(COMPACT_CONTROL, 'font-extrabold')}
          >
            Send
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingFoodOrder(false)} className={COMPACT_CONTROL}>
            Cancel
          </Button>
        </div>
      )}

      {/* The facts, as one slim line of small plain text. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs leading-5 text-text-muted">
        <span className={cn(factClass, 'font-medium text-text')}>
          {totals.bookings} {totals.bookings === 1 ? 'booking' : 'bookings'} · {totals.covers} covers
          {typeof totals.privateHireGuests === 'number' && totals.privateHireGuests > 0
            ? ` · ${totals.privateHireGuests} private hire guests`
            : ''}
        </span>
        {openHoursLabel ? <span className={factClass}>{openHoursLabel}</span> : null}
        <span className="min-w-0 flex-1 truncate" role="status" aria-label="Next event reminder">
          {!upcomingEventsLoaded
            ? 'Loading next event...'
            : nextUpcomingEvent
              ? (
                <>
                  <span className="font-semibold text-warning-fg">Next event:</span>{' '}
                  {nextUpcomingEvent.name} · {formatNextEventUrgency(nextUpcomingEvent, clockNow)}
                </>
              )
              : 'No upcoming events'}
        </span>
        {freshness && !freshnessWide ? <span className="shrink-0">{freshness}</span> : null}
      </div>

      {/* The stale warning takes a whole row of its own: it must not be squeezed. */}
      {freshness && freshnessWide ? <div className={alertGap}>{freshness}</div> : null}

      {!viewingToday && (
        <div className={cn('rounded-lg border border-warning-border bg-warning-soft px-3 py-1 text-sm text-warning-fg', alertGap)}>
          Viewing <span className="font-semibold">{formatDateInLondon(date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>,
          not today. This screen returns to today after 5 minutes of inactivity.
        </div>
      )}

      {statusMessage && (
        <Alert tone="success" size="sm" className={alertGap}>
          {statusMessage}
        </Alert>
      )}

      {errorMessage && (
        <Alert tone="danger" size="sm" className={alertGap}>
          {errorMessage}
        </Alert>
      )}

      {staffNotice && staffNotice.length > 0 && (
        <Alert
          tone="warning"
          size="sm"
          title="Check this booking"
          closable
          onClose={onDismissStaffNotice}
          className={alertGap}
        >
          <ul className="list-disc space-y-1 pl-4">
            {staffNotice.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  )
})
