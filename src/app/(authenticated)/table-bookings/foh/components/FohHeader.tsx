'use client'

import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { FohUpcomingEvent, FohStyleVariant, FohCreateMode, FohViewMode } from '../types'
import { formatNextEventUrgency, getLondonDateIso, shiftIsoDate } from '../utils'

type FohHeaderProps = {
  date: string
  setDate: (date: string | ((current: string) => string)) => void
  canEdit: boolean
  styleVariant: FohStyleVariant
  clockNow: Date
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
  const londonTodayIso = getLondonDateIso(clockNow)
  const viewingToday = date === londonTodayIso
  const openNowCreateModal = (mode: FohCreateMode) => {
    setDate(londonTodayIso)
    lastInteractionAtMsRef.current = Date.now()
    onOpenCreateModal({ mode })
  }

  const panelSurfaceClass = isManagerKioskStyle
    ? 'rounded-xl border border-green-200 bg-white shadow-sm'
    : 'rounded-lg border border-gray-200 bg-white'
  const serviceCardClass = cn(panelSurfaceClass, isManagerKioskStyle ? 'p-2' : 'p-4')
  const serviceHeaderClass = cn(
    'flex flex-col sm:flex-row sm:justify-between',
    isManagerKioskStyle ? 'gap-1.5 sm:items-center' : 'gap-3 sm:items-end'
  )
  const serviceDateLabelClass = cn(
    'block text-sm font-medium text-gray-900',
    isManagerKioskStyle && 'sr-only'
  )
  const serviceDateControlsClass = cn(
    // Mobile: wrap onto multiple lines so "Today" is never pushed off-screen.
    // sm+ (incl. the manager kiosk tablet): keep the original single-row scroll behaviour.
    'flex flex-wrap items-center gap-2 sm:flex-nowrap sm:whitespace-nowrap sm:overflow-x-auto',
    isManagerKioskStyle ? 'mt-0' : 'mt-1'
  )
  const totalsBadgeClass = cn(
    'rounded-md border px-2 py-1 text-[11px] font-medium',
    isManagerKioskStyle
      ? 'border-green-300 bg-green-50 text-green-900'
      : 'border-gray-300 bg-gray-100 text-gray-700'
  )
  const nextEventCalloutClass = cn(
    'mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2',
    'border-amber-300 bg-amber-50 text-amber-950',
    isManagerKioskStyle && 'px-2 py-1.5'
  )
  const nextEventPillClass = cn(
    'inline-flex items-center rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-900',
    isManagerKioskStyle && 'text-[9px]'
  )
  const nextEventTitleClass = cn(
    'min-w-0 truncate text-sm font-semibold leading-tight text-amber-950',
    isManagerKioskStyle && 'text-[11px]'
  )
  const nextEventMetaClass = cn(
    'text-sm font-medium text-amber-800',
    isManagerKioskStyle && 'text-[11px]'
  )
  const nextEventButtonClass = cn(
    'inline-flex items-center justify-center rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-1',
    isManagerKioskStyle && 'px-2.5 py-1 text-[11px]'
  )
  const daySwitchButtonClass = cn(
    'rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50',
    isManagerKioskStyle ? 'px-1.5 py-1 text-xs' : 'px-2.5 py-2'
  )
  const dateInputClass = cn(
    'rounded-md border border-gray-300 text-sm',
    isManagerKioskStyle ? 'px-1.5 py-1 text-xs' : 'px-3 py-2'
  )
  const viewToggleGroupClass = cn(
    'inline-flex items-center rounded-md border border-gray-300 bg-gray-100 p-0.5',
    isManagerKioskStyle && 'border-green-300 bg-green-50'
  )
  const viewToggleSegmentClass = (active: boolean) =>
    cn(
      'rounded-md font-medium transition focus:outline-none focus:ring-2 focus:ring-sidebar/40',
      isManagerKioskStyle ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-sm',
      active
        ? 'bg-white text-gray-900 shadow-sm'
        : 'text-gray-600 hover:text-gray-900'
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
              <button
                type="button"
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
                className={nextEventButtonClass}
              >
                Book guests
              </button>
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
            <button
              type="button"
              onClick={() => {
                setDate((current: string) => shiftIsoDate(current, -1))
                lastInteractionAtMsRef.current = Date.now()
              }}
              className={daySwitchButtonClass}
              aria-label="Previous day"
            >
              Previous
            </button>
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
            <button
              type="button"
              onClick={() => {
                setDate((current: string) => shiftIsoDate(current, 1))
                lastInteractionAtMsRef.current = Date.now()
              }}
              className={daySwitchButtonClass}
              aria-label="Next day"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => {
                setDate(getLondonDateIso())
                lastInteractionAtMsRef.current = Date.now()
              }}
              className={daySwitchButtonClass}
            >
              Today
            </button>
            <span className={totalsBadgeClass}>Total bookings: {totals.bookings}</span>
            <span className={totalsBadgeClass}>Total covers: {totals.covers}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={onSendFoodOrderAlert}
              disabled={submittingFoodOrderAlert}
              aria-label="Send food order SMS alert"
              className={cn(
                'inline-flex items-center gap-2 rounded-md border-2 border-red-900 bg-red-600 px-3.5 py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow-sm ring-1 ring-red-200 transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70',
                isManagerKioskStyle && 'px-2 py-1 text-[10px] font-black'
              )}
            >
              <Image
                src="/logo.png"
                alt=""
                width={20}
                height={20}
                aria-hidden
                className={cn('h-4 w-auto rounded-sm bg-white px-0.5 py-0.5', isManagerKioskStyle && 'h-3.5')}
              />
              <span>{submittingFoodOrderAlert ? 'Sending...' : 'Food Order'}</span>
            </button>
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
          <Link
            href="/checklists"
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white',
              isManagerKioskStyle
                ? 'bg-sidebar px-2.5 py-1 text-[11px] font-semibold hover:bg-green-700'
                : 'bg-sidebar hover:bg-sidebar/90'
            )}
          >
            Checklists
          </Link>

          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => openNowCreateModal('walk_in')}
                className={cn(
                  'rounded-md px-4 py-2 text-sm text-white',
                  isManagerKioskStyle
                    ? 'bg-sidebar px-2.5 py-1 text-[11px] font-semibold hover:bg-green-700'
                    : 'bg-sidebar font-medium hover:bg-sidebar/90'
                )}
              >
                Walk-in
              </button>
              <button
                type="button"
                onClick={() => openNowCreateModal('booking')}
                className={cn(
                  'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50',
                  isManagerKioskStyle
                    ? 'px-2.5 py-1 text-[11px]'
                    : ''
                )}
              >
                Add booking
              </button>
            </>
          )}
        </div>
      </div>

      {!viewingToday && (
        <div className={cn('rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900', isManagerKioskStyle ? 'mt-2' : 'mt-3')}>
          Viewing <span className="font-semibold">{date}</span>. This screen returns to{' '}
          <span className="font-semibold">{londonTodayIso}</span> after 5 minutes of inactivity.
        </div>
      )}

      {statusMessage && (
        <div role="alert" className={cn('rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800', isManagerKioskStyle ? 'mt-2' : 'mt-3')}>
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div role="alert" className={cn('rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800', isManagerKioskStyle ? 'mt-2' : 'mt-3')}>
          {errorMessage}
        </div>
      )}
    </div>
  )
})
