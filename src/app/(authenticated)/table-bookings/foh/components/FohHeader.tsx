'use client'

import React from 'react'
import Image from 'next/image'
import { Alert, Button, LinkButton } from '@/ds'
import { cn } from '@/lib/utils'
import type { FohUpcomingEvent, FohStyleVariant, FohCreateMode, FohViewMode } from '../types'
import { formatNextEventUrgency, shiftIsoDate } from '../utils'

type FohHeaderProps = {
  date: string
  setDate: (date: string | ((current: string) => string)) => void
  canEdit: boolean
  styleVariant: FohStyleVariant
  clockNow: Date
  /** The service date in force: the night before, from midnight until an after-midnight close. */
  serviceDateNow: string
  totals: { bookings: number; covers: number }
  viewMode: FohViewMode
  outsideCount: number
  onViewModeChange: (mode: FohViewMode) => void
  nextUpcomingEvent: FohUpcomingEvent | null
  upcomingEventsLoaded: boolean
  submittingFoodOrderAlert: boolean
  statusMessage: string | null
  errorMessage: string | null
  lastInteractionAtMsRef: React.MutableRefObject<number>
  onSendFoodOrderAlert: () => void
  onOpenCreateModal: (options?: {
    mode?: FohCreateMode
    laneTableId?: string
    laneTableName?: string
    suggestedTime?: string
    prefill?: Partial<{ booking_date: string; purpose: 'food' | 'drinks' | 'event'; event_id: string }>
  }) => void
}

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
    lastInteractionAtMsRef,
    onSendFoodOrderAlert,
    onOpenCreateModal,
  } = props

  const isManagerKioskStyle = styleVariant === 'manager_kiosk'
  const viewingToday = date === serviceDateNow
  const openNowCreateModal = (mode: FohCreateMode) => {
    setDate(serviceDateNow)
    lastInteractionAtMsRef.current = Date.now()
    onOpenCreateModal({ mode })
  }

  // One card treatment for both styles; the kiosk only packs it tighter.
  const serviceCardClass = cn('rounded-lg border border-border bg-surface', isManagerKioskStyle ? 'p-2' : 'p-4')
  // Owner decision D6: every control on the bar iPad is at least 44px tall. The screen's
  // data-touch-targets rule only lifts buttons and fields on a touch pointer, and never the
  // Checklists and Vouchers links, so the header sets the floor itself.
  const controlSize = isManagerKioskStyle ? 'sm' : 'md'
  const serviceHeaderClass = cn(
    'flex flex-col sm:flex-row sm:justify-between',
    isManagerKioskStyle ? 'gap-1.5 sm:items-center' : 'gap-3 sm:items-end'
  )
  const serviceDateLabelClass = cn(
    'block text-sm font-medium text-text',
    isManagerKioskStyle && 'sr-only'
  )
  const serviceDateControlsClass = cn(
    // Mobile: wrap onto multiple lines so "Today" is never pushed off-screen.
    // sm+ (incl. the manager kiosk tablet): keep the original single-row scroll behaviour.
    // The scroll clips an outer focus ring, so the buttons in this row draw theirs inset.
    'flex flex-wrap items-center gap-2 sm:flex-nowrap sm:whitespace-nowrap sm:overflow-x-auto',
    isManagerKioskStyle ? 'mt-0' : 'mt-1'
  )
  const totalsBadgeClass = cn(
    'rounded-md border px-2 py-1 text-meta font-medium',
    isManagerKioskStyle
      ? 'border-primary/20 bg-primary-soft text-primary-soft-fg'
      : 'border-border-strong bg-surface-hover text-text'
  )
  const nextEventCalloutClass = cn(
    'mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2',
    'border-warning-border bg-warning-soft text-warning-fg',
    isManagerKioskStyle && 'px-2 py-1.5'
  )
  const nextEventPillClass =
    'inline-flex items-center rounded-pill bg-warning/20 px-2 py-0.5 text-2xs font-extrabold uppercase tracking-wide text-warning-fg'
  const nextEventTitleClass = cn(
    'min-w-0 truncate text-sm font-semibold leading-tight text-warning-fg',
    isManagerKioskStyle && 'text-meta'
  )
  const nextEventMetaClass = cn(
    'text-sm font-medium text-warning-fg',
    isManagerKioskStyle && 'text-meta'
  )
  const dateInputClass =
    'min-h-touch rounded-sm border border-border-strong bg-surface px-3 text-ui text-text outline-hidden focus:border-border-focus focus:shadow-ring'
  const viewToggleGroupClass = cn(
    'inline-flex items-center rounded-md border p-0.5',
    isManagerKioskStyle ? 'border-primary/20 bg-primary-soft' : 'border-border-strong bg-surface-hover'
  )
  const viewToggleSegmentClass = (active: boolean) =>
    cn(
      'min-h-touch rounded-sm font-medium transition focus-visible:outline-hidden focus-visible:shadow-ring',
      isManagerKioskStyle ? 'px-2 py-1 text-meta' : 'px-3 py-1.5 text-sm',
      active
        ? 'bg-surface text-text shadow-sm'
        : 'text-text-muted hover:text-text'
    )

  return (
    <div className={serviceCardClass}>
      <div className={nextEventCalloutClass} role="status" aria-label="Next event reminder">
        {!upcomingEventsLoaded ? (
          <p className={nextEventMetaClass}>Loading next event...</p>
        ) : nextUpcomingEvent ? (
          <>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={nextEventPillClass}>Next event</span>
                <span className={nextEventMetaClass}>{formatNextEventUrgency(nextUpcomingEvent, clockNow)}</span>
                <span className={nextEventTitleClass} title={nextUpcomingEvent.name}>
                  {nextUpcomingEvent.name}
                </span>
              </div>
            </div>

            {canEdit && (
              <Button
                type="button"
                variant="primary"
                size={controlSize}
                onClick={() =>
                  onOpenCreateModal({
                    mode: 'booking',
                    prefill: {
                      booking_date: nextUpcomingEvent.date,
                      purpose: 'event',
                      event_id: nextUpcomingEvent.id
                    }
                  })
                }
                className="min-h-touch"
              >
                Book guests
              </Button>
            )}
          </>
        ) : (
          <p className={nextEventMetaClass}>No upcoming events scheduled.</p>
        )}
      </div>

      <div className={serviceHeaderClass}>
        <div>
          <label htmlFor="foh-date" className={serviceDateLabelClass}>
            Service date
          </label>
          <div className={serviceDateControlsClass}>
            <Button
              type="button"
              variant="secondary"
              size={controlSize}
              onClick={() => {
                setDate((current: string) => shiftIsoDate(current, -1))
                lastInteractionAtMsRef.current = Date.now()
              }}
              className="min-h-touch focus-visible:shadow-ring-inset"
              aria-label="Previous day"
            >
              Previous
            </Button>
            <input
              id="foh-date"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value)
                lastInteractionAtMsRef.current = Date.now()
              }}
              className={dateInputClass}
            />
            <Button
              type="button"
              variant="secondary"
              size={controlSize}
              onClick={() => {
                setDate((current: string) => shiftIsoDate(current, 1))
                lastInteractionAtMsRef.current = Date.now()
              }}
              className="min-h-touch focus-visible:shadow-ring-inset"
              aria-label="Next day"
            >
              Next
            </Button>
            <Button
              type="button"
              variant="secondary"
              size={controlSize}
              onClick={() => {
                setDate(serviceDateNow)
                lastInteractionAtMsRef.current = Date.now()
              }}
              className="min-h-touch focus-visible:shadow-ring-inset"
            >
              Today
            </Button>
            <span className={totalsBadgeClass}>Total bookings: {totals.bookings}</span>
            <span className={totalsBadgeClass}>Total covers: {totals.covers}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            // Deliberately loud: it texts the kitchen, so it stays red and in capitals.
            <Button
              type="button"
              variant="danger"
              size={controlSize}
              onClick={onSendFoodOrderAlert}
              disabled={submittingFoodOrderAlert}
              aria-label="Send food order SMS alert"
              className="min-h-touch font-extrabold uppercase tracking-wide"
              icon={
                <Image
                  src="/logo.png"
                  alt=""
                  width={20}
                  height={20}
                  aria-hidden
                  className={cn('h-4 w-auto rounded-sm bg-surface px-0.5 py-0.5', isManagerKioskStyle && 'h-3.5')}
                />
              }
            >
              {submittingFoodOrderAlert ? 'Sending...' : 'Food Order'}
            </Button>
          )}

          {/* View toggle — always visible (view control, not gated by canEdit). */}
          <div className={viewToggleGroupClass} role="group" aria-label="Seating view">
            <button
              type="button"
              onClick={() => onViewModeChange('inside')}
              aria-pressed={viewMode === 'inside'}
              className={viewToggleSegmentClass(viewMode === 'inside')}
            >
              Inside
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('outside')}
              aria-pressed={viewMode === 'outside'}
              className={viewToggleSegmentClass(viewMode === 'outside')}
            >
              Outside ({outsideCount})
            </button>
          </div>

          {/* Checklists: navigation, visible to all FOH users (not gated by canEdit). */}
          <LinkButton href="/checklists" variant="primary" size={controlSize} className="min-h-touch">
            Checklists
          </LinkButton>

          {/* Vouchers: navigation, visible to all FOH users (not gated by canEdit). */}
          <LinkButton href="/vouchers/foh" variant="primary" size={controlSize} className="min-h-touch">
            Vouchers
          </LinkButton>

          {canEdit && (
            <>
              <Button
                type="button"
                variant="primary"
                size={controlSize}
                onClick={() => openNowCreateModal('walk_in')}
                className="min-h-touch"
              >
                Walk-in
              </Button>
              <Button
                type="button"
                variant="secondary"
                size={controlSize}
                onClick={() => openNowCreateModal('booking')}
                className="min-h-touch"
              >
                Add booking
              </Button>
            </>
          )}
        </div>
      </div>

      {!viewingToday && (
        <div className={cn('rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning-fg', isManagerKioskStyle ? 'mt-2' : 'mt-3')}>
          Viewing <span className="font-semibold">{date}</span>. This screen returns to{' '}
          <span className="font-semibold">{serviceDateNow}</span> after 5 minutes of inactivity.
        </div>
      )}

      {statusMessage && (
        <Alert tone="success" size="sm" className={isManagerKioskStyle ? 'mt-2' : 'mt-3'}>
          {statusMessage}
        </Alert>
      )}

      {errorMessage && (
        <Alert tone="danger" size="sm" className={isManagerKioskStyle ? 'mt-2' : 'mt-3'}>
          {errorMessage}
        </Alert>
      )}
    </div>
  )
})
