'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type DragStartEvent, type DragEndEvent } from '@dnd-kit/core'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { Alert } from '@/ds'
import { PrivateHireTodayStrip } from '@/components/day-load/PrivateHireTodayStrip'
import { cn } from '@/lib/utils'
import { formatTime12Hour } from '@/lib/dateUtils'

import type {
  FohBooking,
  FohMoveTableAvailabilityResponse,
  FohMoveTableOption,
  FohStyleVariant,
  FohTimelineZoom,
  FohViewMode,
  SelectedBookingContext,
} from './types'
import {
  FOH_AUTO_RETURN_IDLE_MS,
  FOH_AUTO_RETURN_POLL_MS,
  buildTimelineRange,
  getLondonDateIso,
  minutesFromServiceDate,
  postBookingAction,
  buildTimeChangeOptions,
  formatFohClock,
  isFohScheduleStale,
  resolveFohServiceDateNow,
  statusBlockClass,
  type FohSearchResult,
} from './utils'
import { useFohBookings } from './hooks/useFohBookings'
import { useFohRealtime } from './hooks/useFohRealtime'
import { useFohCreateBooking } from './hooks/useFohCreateBooking'
import { useFohDeploymentRefresh } from './hooks/useFohDeploymentRefresh'
import { useFohBookingActions } from './hooks/useFohBookingActions'
import { FohLoadWarningsBanner } from './components/FohLoadWarningsBanner'
import { useFohDrag } from './useFohDrag'

import { FohHeader } from './components/FohHeader'
import { FohTimeline } from './components/FohTimeline'
import { FohUnassignedBookings } from './components/FohUnassignedBookings'
import { FohOutsideBookings } from './components/FohOutsideBookings'
import { FohBookingDetailModal } from './components/FohBookingDetailModal'
import { FohCreateBookingModal } from './components/FohCreateBookingModal'
import { FohPartySizeModal, FohWalkoutModal } from './components/FohMiniModals'
import type { ChristmasPartyChange } from '@/components/features/table-bookings/ChristmasCourseFields'
import { FohChangeTimeModal } from './components/FohChangeTimeModal'
import { FohBookingSearch } from './components/FohBookingSearch'
import { FohFreshness } from './components/FohFreshness'
import { FohNoShowList } from './components/FohNoShowList'
import { OpenEarlierBookingsStrip } from '@/components/features/table-bookings/OpenEarlierBookingsStrip'
import { UndoBar } from '@/components/features/table-bookings/UndoBar'
import { GuestNotToldPanel } from '@/components/features/table-bookings/GuestNotToldPanel'
import { AwaitingConfirmationPanel } from '@/components/features/table-bookings/AwaitingConfirmationPanel'

const FOH_ZOOM_STORAGE_KEY = 'foh-timeline-zoom'

// How often the 'still open from earlier' strip looks again while the schedule keeps refreshing.
const FOH_STRIP_REFRESH_MS = 5 * 60 * 1000

export function FohScheduleClient({
  initialDate,
  deploymentVersion,
  canEdit,
  isSuperAdmin = false,
  styleVariant = 'default',
  canWaiveDeposit = false,
  canManageSettings = false
}: {
  initialDate: string
  deploymentVersion: string
  canEdit: boolean
  isSuperAdmin?: boolean
  styleVariant?: FohStyleVariant
  canWaiveDeposit?: boolean
  /** settings manage: Table Setup is offered in the toolbar's More menu. */
  canManageSettings?: boolean
}) {
  const supabase = useMemo(() => createSupabaseClient(), [])
  const isManagerKioskStyle = styleVariant === 'manager_kiosk'
  const [date, setDate] = useState(initialDate)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  // Bumped after each action so the "guest not told" list looks again (BK-177).
  const [guestNotToldRefresh, setGuestNotToldRefresh] = useState(0)
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({})
  const [selectedMoveOptions, setSelectedMoveOptions] = useState<FohMoveTableOption[]>([])
  const [loadingSelectedMoveOptions, setLoadingSelectedMoveOptions] = useState(false)
  const [selectedBookingContext, setSelectedBookingContext] = useState<SelectedBookingContext | null>(null)
  const [showCancelBookingConfirmation, setShowCancelBookingConfirmation] = useState(false)
  // Why a party size or walkout amount was not accepted, shown in that dialog itself.
  const [miniModalError, setMiniModalError] = useState<string | null>(null)
  const [refreshingNow, setRefreshingNow] = useState(false)
  const [partySizeEditOpen, setPartySizeEditOpen] = useState(false)
  const [christmasPartyChange, setChristmasPartyChange] = useState<ChristmasPartyChange | undefined>(undefined)
  const [partySizeEditValue, setPartySizeEditValue] = useState('')
  const [partySizeEditBookingId, setPartySizeEditBookingId] = useState<string | null>(null)
  const [changeTimeOpen, setChangeTimeOpen] = useState(false)
  const [changeTimeBookingId, setChangeTimeBookingId] = useState<string | null>(null)
  // Kept local to the modal rather than pushed to the page banner: a conflict message that
  // renders behind an open dialog is a message nobody reads.
  const [changeTimeError, setChangeTimeError] = useState<string | null>(null)
  const [walkoutModalOpen, setWalkoutModalOpen] = useState(false)
  const [walkoutAmountValue, setWalkoutAmountValue] = useState('')
  const [walkoutBookingId, setWalkoutBookingId] = useState<string | null>(null)
  const [submittingFoodOrderAlert, setSubmittingFoodOrderAlert] = useState(false)
  const [clockNow, setClockNow] = useState(() => new Date())
  const [viewMode, setViewMode] = useState<FohViewMode>('inside')
  // Day (the whole opening window) or Now (about five hours around the present). Remembered per
  // browser; a narrow screen starts on Now. Storage can be blocked, so every touch of it is guarded.
  const [timelineZoom, setTimelineZoom] = useState<FohTimelineZoom>('day')
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FOH_ZOOM_STORAGE_KEY)
      if (stored === 'day' || stored === 'now') { setTimelineZoom(stored); return }
    } catch {
      // No storage: fall through to the default for this screen width.
    }
    if (window.innerWidth < 1024) setTimelineZoom('now')
  }, [])
  const chooseTimelineZoom = useCallback((zoom: FohTimelineZoom) => {
    setTimelineZoom(zoom)
    try {
      window.localStorage.setItem(FOH_ZOOM_STORAGE_KEY, zoom)
    } catch {
      // The choice still holds for this visit.
    }
  }, [])

  const lastInteractionAtMsRef = useRef(Date.now())
  const timelineRef = useRef<HTMLDivElement | null>(null)

  // --- Drag state ---
  const [activeDragData, setActiveDragData] = useState<{
    bookingId: string; bookingLabel: string; widthPx: number; statusClassName: string
  } | null>(null)

  const {
    pendingMove, isDragging, liveSnapTime, isOutOfBounds, isSubmitting, confirmError, pointerPosition,
    sensors, onDragStart: fohDragStart, onDragMove, onDragEnd: fohDragEnd,
    confirm: confirmMove, cancel: cancelMove,
  } = useFohDrag(timelineRef)

  const onDragStart = (event: DragStartEvent) => {
    fohDragStart(event)
    const rect = event.active.rect.current.initial
    const data = event.active.data.current as { bookingId: string; bookingLabel: string; statusClassName?: string } | undefined
    if (data) {
      setActiveDragData({
        bookingId: data.bookingId,
        bookingLabel: data.bookingLabel,
        widthPx: rect?.width ?? 280,
        statusClassName: data.statusClassName ?? statusBlockClass(null),
      })
    }
  }

  const onDragEnd = (event: DragEndEvent) => { fohDragEnd(event); setActiveDragData(null) }

  // --- Data fetching ---
  const {
    schedule, setSchedule, loading, errorMessage, setErrorMessage, reloadSchedule, lastUpdatedAt,
    upcomingEvents, upcomingEventsLoaded,
  } = useFohBookings({ date, clockNow })

  // --- Staying up to date: the one refresh mechanism (realtime, a 60 second safety net, and a
  // refetch when the tab comes back or the network returns) ---
  useFohRealtime({ supabase, date, isDragging, reloadSchedule })

  // --- Booking actions, their messages and their Undo ---
  const closeConfirmSteps = useCallback(() => setShowCancelBookingConfirmation(false), [])
  const bumpSideLists = useCallback(() => setGuestNotToldRefresh((count) => count + 1), [])
  const {
    bookingActionInFlight, setBookingActionInFlight,
    panelNotice, setPanelNotice,
    staffNotice, setStaffNotice,
    undoOffer, undoBusy, runUndo, dismissUndo,
    runAction,
  } = useFohBookingActions({
    setSchedule, setSelectedBookingContext, reloadSchedule, setErrorMessage, setStatusMessage,
    onActionStart: closeConfirmSteps,
    onActionSaved: bumpSideLists,
  })

  // --- Computed from schedule ---
  const timeline = useMemo(() => buildTimelineRange(schedule), [schedule])
  const totals = useMemo(() => {
    if (!schedule) return { bookings: 0, covers: 0 }
    const uniqueBookings = new Map<string, FohBooking>()
    for (const lane of schedule.lanes) for (const b of lane.bookings) if (!uniqueBookings.has(b.id)) uniqueBookings.set(b.id, b)
    for (const b of schedule.unassigned_bookings || []) if (!uniqueBookings.has(b.id)) uniqueBookings.set(b.id, b)
    for (const b of schedule.outside_bookings || []) if (!uniqueBookings.has(b.id)) uniqueBookings.set(b.id, b)
    const active = Array.from(uniqueBookings.values()).filter((b) => {
      if (b.is_private_block) return false
      const s = (b.status || '').toLowerCase()
      return s !== 'cancelled' && s !== 'no_show'
    })
    const counted = active.reduce((sum, b) => { const p = Number(b.party_size || 1); return sum + (Number.isFinite(p) && p > 0 ? p : 1) }, 0)
    // Covers as every other screen counts them (BK-075): diners plus event tickets, with private
    // hire guests as their own figure. The count of what is on screen stays as the fallback when
    // the day load could not be read.
    const dayLoad = schedule.day_load
    return {
      bookings: active.length,
      covers: dayLoad ? dayLoad.covers : counted,
      privateHireGuests: dayLoad ? dayLoad.privateHireGuests : null,
    }
  }, [schedule])
  const nextUpcomingEvent = useMemo(() => upcomingEvents[0] || null, [upcomingEvents])
  const timelineDuration = Math.max(1, timeline.endMin - timeline.startMin)
  // "Today" for the floor: the night before, from midnight until an after-midnight close.
  const tradingDayNow = schedule?.trading_day_now
  const serviceDateNow = useMemo(
    () => resolveFohServiceDateNow(clockNow, tradingDayNow) ?? getLondonDateIso(clockNow),
    [clockNow, tradingDayNow]
  )
  const currentTimelineLeftPct = useMemo(() => {
    const serviceDateIso = schedule?.date || date
    const nowMinute = minutesFromServiceDate(clockNow.toISOString(), serviceDateIso)
    if (nowMinute == null || nowMinute < timeline.startMin || nowMinute > timeline.endMin) return null
    return ((nowMinute - timeline.startMin) / timelineDuration) * 100
  }, [clockNow, date, schedule, timeline.endMin, timeline.startMin, timelineDuration])

  // --- Create booking hook ---
  const createBooking = useFohCreateBooking({
    date, clockNow, serviceDateNow, canEdit, schedule, timeline, setErrorMessage, setStatusMessage, reloadSchedule,
  })

  // --- Clock tick ---
  useEffect(() => {
    let intervalId: number | null = null
    const tick = () => { setClockNow(new Date()) }
    tick()
    const delayToNextMinute = 60_000 - (Date.now() % 60_000)
    const timeoutId = window.setTimeout(() => { tick(); intervalId = window.setInterval(tick, 60_000) }, delayToNextMinute)
    return () => { window.clearTimeout(timeoutId); if (intervalId != null) window.clearInterval(intervalId) }
  }, [])

  // --- Interaction tracking ---
  useEffect(() => {
    const markInteraction = () => { lastInteractionAtMsRef.current = Date.now() }
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible') markInteraction() }
    window.addEventListener('pointerdown', markInteraction, { passive: true })
    window.addEventListener('wheel', markInteraction, { passive: true })
    window.addEventListener('keydown', markInteraction)
    window.addEventListener('touchstart', markInteraction, { passive: true })
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pointerdown', markInteraction)
      window.removeEventListener('wheel', markInteraction)
      window.removeEventListener('keydown', markInteraction)
      window.removeEventListener('touchstart', markInteraction)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // --- Auto-return to today ---
  const hasActiveFohWork = Boolean(
    bookingActionInFlight || createBooking.submittingBooking || submittingFoodOrderAlert
    || createBooking.isCreateModalOpen || selectedBookingContext || showCancelBookingConfirmation
    || partySizeEditOpen || walkoutModalOpen || changeTimeOpen
  )

  // An open booking panel no longer holds a new release off: the screen reloads once it has been
  // idle, and an open form delays that by at most 15 minutes (BK-096).
  useFohDeploymentRefresh({
    currentVersion: deploymentVersion,
    busy: Boolean(bookingActionInFlight || createBooking.submittingBooking || submittingFoodOrderAlert),
    formOpen: Boolean(
      createBooking.isCreateModalOpen || showCancelBookingConfirmation
      || partySizeEditOpen || walkoutModalOpen || changeTimeOpen
    ),
    lastInteractionAtMsRef,
  })

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = new Date()
      const reportedServiceDate = resolveFohServiceDateNow(now, tradingDayNow)
      if (tradingDayNow && reportedServiceDate === null) {
        // The last word on which day is in force has run out (midnight, or a late close). Ask
        // the server again and decide on the next poll: the calendar cannot tell 00:30 after an
        // ordinary night from 00:30 on New Year's Eve, which is still 31 December's service.
        void reloadSchedule({ surfaceError: false }).catch(() => {})
        return
      }
      const todayIso = reportedServiceDate ?? getLondonDateIso(now)
      if (date === todayIso || hasActiveFohWork || document.visibilityState !== 'visible') return
      const ae = document.activeElement
      if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae instanceof HTMLSelectElement || ae?.getAttribute('contenteditable') === 'true') return
      if (Date.now() - lastInteractionAtMsRef.current < FOH_AUTO_RETURN_IDLE_MS) return
      setDate(todayIso)
      setStatusMessage('Returned to today after inactivity.')
      setErrorMessage(null)
      lastInteractionAtMsRef.current = Date.now()
    }, FOH_AUTO_RETURN_POLL_MS)
    return () => { window.clearInterval(intervalId) }
  }, [date, hasActiveFohWork, setErrorMessage, tradingDayNow, reloadSchedule])

  // --- Selected booking move options loader ---
  const selectedBooking = selectedBookingContext?.booking ?? null
  const selectedMoveTarget = selectedBooking ? moveTargets[selectedBooking.id] || '' : ''
  const selectedBookingIsEventOnly = Boolean(
    selectedBooking?.is_communal_event_block ||
      selectedBooking?.id.startsWith('communal-') ||
      selectedBooking?.id.startsWith('standing-')
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!selectedBooking || !canEdit || selectedBooking.is_private_block || selectedBookingIsEventOnly || selectedBooking.is_outside_seating) {
        setSelectedMoveOptions([]); setLoadingSelectedMoveOptions(false); return
      }
      setLoadingSelectedMoveOptions(true)
      try {
        const resp = await fetch(`/api/foh/bookings/${selectedBooking.id}/move-table`, { cache: 'no-store' })
        const payload = (await resp.json()) as FohMoveTableAvailabilityResponse
        if (!resp.ok || !payload.success || !payload.data) throw new Error(payload.error || 'Failed to load available tables')
        if (cancelled) return
        const tables = Array.isArray(payload.data.tables) ? payload.data.tables : []
        setSelectedMoveOptions(tables)
        setMoveTargets((c) => {
          const v = c[selectedBooking.id] || ''
          if (v && tables.some((t) => t.id === v)) return c
          return { ...c, [selectedBooking.id]: '' }
        })
      } catch (error) {
        if (cancelled) return
        setSelectedMoveOptions([])
        // Said in the panel, where the empty table list is.
        setPanelNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'Failed to load available tables' })
      } finally { if (!cancelled) setLoadingSelectedMoveOptions(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [selectedBooking, selectedBookingIsEventOnly, canEdit, setPanelNotice])

  // --- Booking detail panel ---
  function openBookingDetails(booking: FohBooking, ctx: { laneTableId: string | null; laneTableName: string | null }) {
    setSelectedBookingContext({ booking, laneTableId: ctx.laneTableId, laneTableName: ctx.laneTableName })
    setShowCancelBookingConfirmation(false)
    setErrorMessage(null); setStatusMessage(null); setPanelNotice(null)
  }

  function closeBookingDetails() {
    setSelectedBookingContext(null); setBookingActionInFlight(null)
    setShowCancelBookingConfirmation(false)
    setPartySizeEditOpen(false); setWalkoutModalOpen(false)
    setChangeTimeOpen(false); setChangeTimeError(null)
    setPanelNotice(null); setMiniModalError(null)
  }

  async function refreshNow() {
    setRefreshingNow(true)
    try {
      await reloadSchedule({ surfaceError: false })
      bumpSideLists()
    } catch {
      // The warning stays up: that is the message.
    } finally { setRefreshingNow(false) }
  }

  // A no-show put back from today's list: the same checks as any no-show coming back.
  function undoNoShowFromList(booking: FohBooking) {
    void runAction(
      () => postBookingAction(`/api/foh/bookings/${booking.id}/undo`, {
        action: 'no_show',
        ...(booking.no_show_at ? { stamp: booking.no_show_at } : {}),
      }),
      `${booking.guest_name || booking.booking_reference || 'Booking'} is back as booked`,
      `undo_no_show:${booking.id}`
    )
  }

  async function sendFoodOrderAlert() {
    if (!canEdit || submittingFoodOrderAlert) return
    setErrorMessage(null); setStatusMessage(null); setSubmittingFoodOrderAlert(true)
    try {
      const resp = await fetch('/api/foh/food-order-alert', { method: 'POST' })
      const payload = await resp.json().catch(() => null)
      if (!resp.ok || !payload?.success) throw new Error(payload?.error || 'Failed to send food order alert')
      setStatusMessage('Food order alert sent.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send food order alert')
    } finally { setSubmittingFoodOrderAlert(false) }
  }


  // --- Change time ---
  //
  // The booking is looked up fresh from the schedule on every render rather than held from
  // when the modal opened, so a realtime refresh mid-decision re-marks the grid instead of
  // leaving staff choosing against a stale picture.
  const changeTimeBooking = useMemo(() => {
    if (!changeTimeBookingId) return null
    const fromSchedule = schedule
      ? [
          ...schedule.lanes.flatMap((lane) => lane.bookings),
          ...(schedule.unassigned_bookings || []),
          ...(schedule.outside_bookings || []),
        ].find((booking) => booking.id === changeTimeBookingId) ?? null
      : null
    if (fromSchedule) return fromSchedule
    return selectedBookingContext?.booking.id === changeTimeBookingId
      ? selectedBookingContext.booking
      : null
  }, [changeTimeBookingId, schedule, selectedBookingContext])

  const changeTimeOptions = useMemo(() => {
    if (!changeTimeBooking) return []
    return buildTimeChangeOptions({
      schedule,
      booking: changeTimeBooking,
      timeline,
      serviceDateIso: schedule?.date || date,
      referenceNow: clockNow,
    })
  }, [changeTimeBooking, schedule, timeline, date, clockNow])

  async function submitTimeChange(time: string) {
    const bookingId = changeTimeBookingId
    if (!bookingId) return
    setChangeTimeError(null)
    setErrorMessage(null)
    setStatusMessage(null)
    setBookingActionInFlight('change_time')
    try {
      const resp = await fetch(`/api/foh/bookings/${bookingId}/time`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time }),
      })
      const payload = await resp.json().catch(() => null) as
        | { error?: string; data?: { state?: string; high_chairs_lost?: number } }
        | null

      if (resp.status === 409 || resp.status === 422) {
        // Someone else got there first, or the booking moved on. Keep the modal open so the
        // message is visible, and refresh so the grid stops offering the time that failed.
        setChangeTimeError(payload?.error ?? 'That time is no longer available.')
        await reloadSchedule({ surfaceError: false }).catch(() => {})
        return
      }
      if (!resp.ok) {
        throw new Error(payload?.error || 'Failed to change the booking time')
      }

      setChangeTimeOpen(false)
      closeBookingDetails()
      // Saved. A failed refresh must not turn this into an error (the "last updated" warning
      // covers a screen that is behind).
      await reloadSchedule({ surfaceError: false }).catch(() => {})

      const lostChairs = Number(payload?.data?.high_chairs_lost ?? 0)
      setStatusMessage(
        payload?.data?.state === 'unchanged'
          ? 'No change was made.'
          : lostChairs > 0
            ? `Moved to ${formatFohClock(time)}. The guest has been told. ${lostChairs} high chair${lostChairs === 1 ? '' : 's'} could not be held at the new time.`
            : `Moved to ${formatFohClock(time)}. The guest has been told.`
      )
    } catch (error) {
      // A network failure leaves the outcome genuinely unknown, so refresh and say so rather
      // than inviting a retry that could move the booking twice.
      setChangeTimeError(
        error instanceof Error
          ? `${error.message}. Check the timeline before trying again.`
          : 'The time change could not be confirmed. Check the timeline before trying again.'
      )
      await reloadSchedule().catch(() => {})
    } finally {
      setBookingActionInFlight(null)
    }
  }

  // --- Render ---
  // The manager kiosk sits on the same dark green as its PageLayout header (bg-brand-700 is the
  // sidebar green); the sidebar token itself belongs to the app shell.
  // Tight on both layouts: every band above the timeline pushes the tables down the screen.
  const pageWrapperClass = cn(isManagerKioskStyle ? 'space-y-1.5 rounded-xl bg-brand-700 p-1.5' : 'space-y-2')
  const serviceWindow = schedule?.service_window
  const openHoursLabel = !serviceWindow
    ? null
    : serviceWindow.source === 'closed'
      ? 'Closed all day'
      : `Open ${formatTime12Hour(serviceWindow.start_time || '09:00')} to ${formatTime12Hour(serviceWindow.end_time || '23:00')}${serviceWindow.end_next_day ? ' (next day)' : ''}`

  return (
    /*
     * data-touch-targets opts this screen into the `pointer: coarse` rule in globals.css,
     * which lifts every button, select, input and textarea inside it to 44px on a touch
     * device at ANY width. The existing 44px floor is keyed on max-width 820px, so FOH,
     * which runs on an iPad in landscape at 1024px+, was getting 25px desktop controls
     * mid-service. The manager kiosk variant shrinks them further still.
     */
    <div className={pageWrapperClass} data-touch-targets>
      {/* Earlier bookings nobody marked as arrived or no-show (BK-130). Renders nothing when there
          are none, and reads again as the schedule refreshes so it never shows what is closed. */}
      <OpenEarlierBookingsStrip
        canEdit={canEdit}
        refreshKey={`${guestNotToldRefresh}:${lastUpdatedAt ? Math.floor(lastUpdatedAt.getTime() / FOH_STRIP_REFRESH_MS) : 0}`}
      />

      <FohHeader
        date={date}
        setDate={setDate as (date: string | ((current: string) => string)) => void}
        canEdit={canEdit}
        styleVariant={styleVariant}
        clockNow={clockNow}
        serviceDateNow={serviceDateNow}
        totals={totals}
        viewMode={viewMode}
        outsideCount={schedule?.outside_bookings?.length ?? 0}
        onViewModeChange={setViewMode}
        nextUpcomingEvent={nextUpcomingEvent}
        upcomingEventsLoaded={upcomingEventsLoaded}
        submittingFoodOrderAlert={submittingFoodOrderAlert}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        staffNotice={staffNotice}
        onDismissStaffNotice={() => setStaffNotice(null)}
        lastInteractionAtMsRef={lastInteractionAtMsRef}
        timelineZoom={timelineZoom}
        onTimelineZoomChange={chooseTimelineZoom}
        openHoursLabel={openHoursLabel}
        repeatingEventLines={schedule?.repeating_events ?? []}
        canManageSettings={canManageSettings}
        search={
          <FohBookingSearch
            schedule={schedule}
            onOpen={(result: FohSearchResult) => {
              lastInteractionAtMsRef.current = Date.now()
              openBookingDetails(result.booking, { laneTableId: result.laneTableId, laneTableName: result.laneTableName })
            }}
          />
        }
        freshnessWide={isFohScheduleStale(lastUpdatedAt, clockNow)}
        freshness={
          <FohFreshness
            lastUpdatedAt={lastUpdatedAt}
            now={clockNow}
            refreshing={refreshingNow}
            onRefresh={() => void refreshNow()}
          />
        }
        onSendFoodOrderAlert={() => void sendFoodOrderAlert()}
        onOpenCreateModal={createBooking.openCreateModal}
      />

      {schedule && (
        <PrivateHireTodayStrip
          hires={schedule.day_load?.privateHires ?? []}
          loadFailed={schedule.day_load === null}
          withLinks={!isManagerKioskStyle}
        />
      )}

      {schedule?.private_hires_unavailable && (
        <Alert tone="warning" title="Private hires not shown">
          Private hires could not be loaded, so tables they take are not shown as blocked. Refresh before seating anyone
          in a room that may be hired tonight.
        </Alert>
      )}

      <FohLoadWarningsBanner warnings={schedule?.load_warnings} />

      <GuestNotToldPanel refreshKey={guestNotToldRefresh} canEdit={canEdit} />

      {/* Guests asked to confirm the day before who have not answered (BK-094). */}
      <AwaitingConfirmationPanel canEdit={canEdit} />

      {viewMode === 'inside' ? (
        <>
          <FohUnassignedBookings
            bookings={schedule?.unassigned_bookings || []}
            styleVariant={styleVariant}
            onBookingClick={(booking) => openBookingDetails(booking, { laneTableId: null, laneTableName: null })}
          />

          <FohTimeline
            schedule={schedule}
            date={date}
            timeline={timeline}
            canEdit={canEdit}
            loading={loading}
            styleVariant={styleVariant}
            currentTimelineLeftPct={currentTimelineLeftPct}
            zoom={timelineZoom}
            sensors={sensors}
            activeDragData={activeDragData}
            pointerPosition={pointerPosition}
            liveSnapTime={liveSnapTime}
            isOutOfBounds={isOutOfBounds}
            pendingMove={pendingMove}
            isSubmitting={isSubmitting}
            confirmError={confirmError}
            timelineRef={timelineRef}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onConfirmMove={confirmMove}
            onCancelMove={cancelMove}
            onBookingClick={(booking, tid, tname) => openBookingDetails(booking, { laneTableId: tid, laneTableName: tname })}
            onLaneClick={(lane) => {
              if (!canEdit) return
              createBooking.openCreateModal({ mode: 'walk_in', laneTableId: lane.table_id, laneTableName: lane.table_name })
            }}
          />
        </>
      ) : (
        <FohOutsideBookings
          bookings={schedule?.outside_bookings || []}
          canEdit={canEdit}
          loading={loading}
          styleVariant={styleVariant}
          onBookingClick={(booking) => openBookingDetails(booking, { laneTableId: null, laneTableName: null })}
        />
      )}

      <FohNoShowList
        bookings={schedule?.no_show_bookings || []}
        canEdit={canEdit}
        busyBookingId={bookingActionInFlight?.startsWith('undo_no_show:') ? bookingActionInFlight.slice('undo_no_show:'.length) : null}
        styleVariant={styleVariant}
        onUndo={undoNoShowFromList}
      />

      {undoOffer && (
        <UndoBar
          key={undoOffer.id}
          offer={undoOffer}
          busy={undoBusy}
          floating
          onUndo={() => void runUndo()}
          onExpire={dismissUndo}
        />
      )}

      <FohBookingDetailModal
        selectedBookingContext={selectedBookingContext}
        canEdit={canEdit}
        canChooseRefund={canWaiveDeposit}
        bookingActionInFlight={bookingActionInFlight}
        showCancelBookingConfirmation={showCancelBookingConfirmation}
        notice={panelNotice}
        onDismissNotice={() => setPanelNotice(null)}
        now={clockNow}
        selectedMoveTarget={selectedMoveTarget}
        selectedMoveOptions={selectedMoveOptions}
        loadingSelectedMoveOptions={loadingSelectedMoveOptions}
        onClose={closeBookingDetails}
        onRunAction={runAction}
        onMoveTargetChange={(bid, tid) => setMoveTargets((c) => ({ ...c, [bid]: tid }))}
        onSetShowCancelBookingConfirmation={setShowCancelBookingConfirmation}
        onOpenPartySizeEdit={(bid, size) => { setPartySizeEditBookingId(bid); setPartySizeEditValue(String(size)); setMiniModalError(null); setPartySizeEditOpen(true) }}
        onOpenWalkoutModal={(bid) => { setWalkoutBookingId(bid); setWalkoutAmountValue(''); setMiniModalError(null); setWalkoutModalOpen(true) }}
        onOpenChangeTime={(bid) => { setChangeTimeBookingId(bid); setChangeTimeError(null); setChangeTimeOpen(true) }}
        canManageDeposit={canWaiveDeposit}
      />

      <FohCreateBookingModal
        open={createBooking.isCreateModalOpen}
        serviceDateNow={serviceDateNow}
        createMode={createBooking.createMode}
        createForm={createBooking.createForm}
        canWaiveDeposit={canWaiveDeposit}
        canEdit={canEdit}
        walkInTargetTable={createBooking.walkInTargetTable}
        submittingBooking={createBooking.submittingBooking}
        customerQuery={createBooking.customerQuery}
        completedCustomerSearchQuery={createBooking.completedCustomerSearchQuery}
        customerResults={createBooking.customerResults}
        selectedCustomer={createBooking.selectedCustomer}
        searchingCustomers={createBooking.searchingCustomers}
        eventOptions={createBooking.eventOptions}
        loadingEventOptions={createBooking.loadingEventOptions}
        eventOptionsError={createBooking.eventOptionsError}
        selectedEventOption={createBooking.selectedEventOption}
        overlappingEventForTable={createBooking.overlappingEventForTable}
        tableEventPromptAcknowledgedEventId={createBooking.tableEventPromptAcknowledgedEventId}
        walkInPurposeAutoSelectionEnabled={createBooking.walkInPurposeAutoSelectionEnabled}
        formRequiresDeposit={createBooking.formRequiresDeposit}
        seasonalPeriod={createBooking.seasonalPeriod}
        christmasPreorderCutoffDays={createBooking.christmasPreorderCutoffDays}
        seasonalAnswer={createBooking.seasonalAnswer}
        onSetSeasonalAnswer={createBooking.setSeasonalAnswer}
        errorMessage={errorMessage}
        onClose={createBooking.closeCreateModal}
        onSubmit={createBooking.handleCreateBooking}
        onSetCreateForm={createBooking.setCreateForm}
        onSetCustomerQuery={createBooking.setCustomerQuery}
        onSelectCustomer={(customer) => {
          createBooking.setSelectedCustomer(customer)
          createBooking.setCreateForm((c) => ({ ...c, phone: customer.mobile_e164 || customer.mobile_number || '' }))
        }}
        onClearCustomer={() => { createBooking.setSelectedCustomer(null); createBooking.setCustomerQuery(''); createBooking.setCustomerResults([]) }}
        onSetTableEventPromptAcknowledgedEventId={createBooking.setTableEventPromptAcknowledgedEventId}
        onSetWalkInPurposeAutoSelectionEnabled={createBooking.setWalkInPurposeAutoSelectionEnabled}
        onSetErrorMessage={setErrorMessage}
      />

      <FohPartySizeModal
        bookingId={partySizeEditBookingId}
        onCoursesChange={setChristmasPartyChange}
        open={partySizeEditOpen}
        bookingActionInFlight={bookingActionInFlight}
        partySizeEditValue={partySizeEditValue}
        error={partySizeEditOpen ? miniModalError : null}
        onClose={() => setPartySizeEditOpen(false)}
        onPartySizeChange={setPartySizeEditValue}
        onConfirm={(submittedValue) => {
          const nextSize = Number.parseInt(submittedValue, 10)
          if (!Number.isFinite(nextSize) || nextSize < 1 || nextSize > 50) { setMiniModalError('Enter a party size between 1 and 50.'); return }
          const bid = partySizeEditBookingId
          if (!bid) return
          setPartySizeEditOpen(false)
          void (async () => {
            const ok = await runAction(() => postBookingAction(`/api/foh/bookings/${bid}/party-size`, { party_size: nextSize, christmas_course_counts: christmasPartyChange?.courseCounts, removed_seats: christmasPartyChange?.removedSeats, expected_course_counts: christmasPartyChange?.expectedCourseCounts }), 'Party size updated', 'party_size')
            if (ok) closeBookingDetails()
          })()
        }}
      />

      <FohWalkoutModal
        open={walkoutModalOpen}
        bookingActionInFlight={bookingActionInFlight}
        walkoutAmountValue={walkoutAmountValue}
        error={walkoutModalOpen ? miniModalError : null}
        onClose={() => setWalkoutModalOpen(false)}
        onAmountChange={setWalkoutAmountValue}
        onConfirm={() => {
          const amount = Number(walkoutAmountValue)
          if (!Number.isFinite(amount) || amount <= 0) { setMiniModalError('Please enter a valid walkout amount.'); return }
          const bid = walkoutBookingId
          if (!bid) return
          setWalkoutModalOpen(false)
          void (async () => {
            const ok = await runAction(() => postBookingAction(`/api/foh/bookings/${bid}/walkout`, { amount }), 'Walkout charge request created', 'walkout')
            if (ok) closeBookingDetails()
          })()
        }}
      />
      <FohChangeTimeModal
        open={changeTimeOpen && Boolean(changeTimeBooking)}
        bookingLabel={
          changeTimeBooking?.guest_name
          || changeTimeBooking?.booking_reference
          || changeTimeBooking?.id.slice(0, 8)
          || 'Booking'
        }
        currentTime={(changeTimeBooking?.booking_time || '').slice(0, 5)}
        isSeated={Boolean(changeTimeBooking?.seated_at)}
        options={changeTimeOptions}
        submitting={bookingActionInFlight === 'change_time'}
        error={changeTimeError}
        onClose={() => { setChangeTimeOpen(false); setChangeTimeError(null) }}
        onConfirm={(time) => { void submitTimeChange(time) }}
      />
    </div>
  )
}
