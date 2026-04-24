'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { type DragStartEvent, type DragEndEvent } from '@dnd-kit/core'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

import type {
  FohBooking,
  FohMoveTableAvailabilityResponse,
  FohMoveTableOption,
  FohStyleVariant,
  SelectedBookingContext,
} from './types'
import {
  BookingActionError,
  FOH_AUTO_RETURN_IDLE_MS,
  FOH_AUTO_RETURN_POLL_MS,
  buildTimelineRange,
  getLondonDateIso,
  minutesFromServiceDate,
  postBookingAction,
} from './utils'
import { useFohBookings } from './hooks/useFohBookings'
import { useFohRealtime } from './hooks/useFohRealtime'
import { useFohCreateBooking } from './hooks/useFohCreateBooking'
import { useFohDrag } from './useFohDrag'

import { FohHeader } from './components/FohHeader'
import { FohTimeline } from './components/FohTimeline'
import { FohUnassignedBookings } from './components/FohUnassignedBookings'
import { FohBookingDetailModal } from './components/FohBookingDetailModal'
import { FohCreateBookingModal } from './components/FohCreateBookingModal'
import { FohPartySizeModal, FohWalkoutModal } from './components/FohMiniModals'

export function FohScheduleClient({
  initialDate,
  canEdit,
  isSuperAdmin = false,
  styleVariant = 'default',
  canWaiveDeposit = false
}: {
  initialDate: string
  canEdit: boolean
  isSuperAdmin?: boolean
  styleVariant?: FohStyleVariant
  canWaiveDeposit?: boolean
}) {
  const supabase = useMemo(() => createSupabaseClient(), [])
  const isManagerKioskStyle = styleVariant === 'manager_kiosk'
  const [date, setDate] = useState(initialDate)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [bookingActionInFlight, setBookingActionInFlight] = useState<string | null>(null)
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({})
  const [selectedMoveOptions, setSelectedMoveOptions] = useState<FohMoveTableOption[]>([])
  const [loadingSelectedMoveOptions, setLoadingSelectedMoveOptions] = useState(false)
  const [selectedBookingContext, setSelectedBookingContext] = useState<SelectedBookingContext | null>(null)
  const [showCancelBookingConfirmation, setShowCancelBookingConfirmation] = useState(false)
  const [showNoShowConfirmation, setShowNoShowConfirmation] = useState(false)
  const [partySizeEditOpen, setPartySizeEditOpen] = useState(false)
  const [partySizeEditValue, setPartySizeEditValue] = useState('')
  const [partySizeEditBookingId, setPartySizeEditBookingId] = useState<string | null>(null)
  const [walkoutModalOpen, setWalkoutModalOpen] = useState(false)
  const [walkoutAmountValue, setWalkoutAmountValue] = useState('')
  const [walkoutBookingId, setWalkoutBookingId] = useState<string | null>(null)
  const [submittingFoodOrderAlert, setSubmittingFoodOrderAlert] = useState(false)
  const [clockNow, setClockNow] = useState(() => new Date())

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
        statusClassName: data.statusClassName ?? 'border-gray-300 bg-gray-200/90 text-gray-800',
      })
    }
  }

  const onDragEnd = (event: DragEndEvent) => { fohDragEnd(event); setActiveDragData(null) }

  // --- Data fetching ---
  const {
    schedule, setSchedule, loading, errorMessage, setErrorMessage, reloadSchedule,
    upcomingEvents, upcomingEventsLoaded,
  } = useFohBookings({ date, clockNow })

  // --- Realtime subscriptions ---
  useFohRealtime({ supabase, date, isDragging, reloadSchedule })

  // --- Computed from schedule ---
  const timeline = useMemo(() => buildTimelineRange(schedule), [schedule])
  const totals = useMemo(() => {
    if (!schedule) return { bookings: 0, covers: 0 }
    const uniqueBookings = new Map<string, FohBooking>()
    for (const lane of schedule.lanes) for (const b of lane.bookings) if (!uniqueBookings.has(b.id)) uniqueBookings.set(b.id, b)
    for (const b of schedule.unassigned_bookings || []) if (!uniqueBookings.has(b.id)) uniqueBookings.set(b.id, b)
    const active = Array.from(uniqueBookings.values()).filter((b) => {
      if (b.is_private_block) return false
      const s = (b.status || '').toLowerCase()
      return s !== 'cancelled' && s !== 'no_show'
    })
    return {
      bookings: active.length,
      covers: active.reduce((sum, b) => { const p = Number(b.party_size || 1); return sum + (Number.isFinite(p) && p > 0 ? p : 1) }, 0)
    }
  }, [schedule])
  const nextUpcomingEvent = useMemo(() => upcomingEvents[0] || null, [upcomingEvents])
  const timelineDuration = Math.max(1, timeline.endMin - timeline.startMin)
  const londonTodayIso = useMemo(() => getLondonDateIso(clockNow), [clockNow])
  const currentTimelineLeftPct = useMemo(() => {
    const serviceDateIso = schedule?.date || date
    const nowMinute = minutesFromServiceDate(clockNow.toISOString(), serviceDateIso)
    if (nowMinute == null || nowMinute < timeline.startMin || nowMinute > timeline.endMin) return null
    return ((nowMinute - timeline.startMin) / timelineDuration) * 100
  }, [clockNow, date, schedule, timeline.endMin, timeline.startMin, timelineDuration])

  // --- Create booking hook ---
  const createBooking = useFohCreateBooking({
    date, clockNow, canEdit, schedule, timeline, setErrorMessage, setStatusMessage, reloadSchedule,
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
    || partySizeEditOpen || walkoutModalOpen
  )

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const todayIso = getLondonDateIso()
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
  }, [date, hasActiveFohWork, setErrorMessage])

  // --- Selected booking move options loader ---
  const selectedBooking = selectedBookingContext?.booking ?? null
  const selectedMoveTarget = selectedBooking ? moveTargets[selectedBooking.id] || '' : ''

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!selectedBooking || !canEdit || selectedBooking.is_private_block) {
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
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load available tables')
      } finally { if (!cancelled) setLoadingSelectedMoveOptions(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [selectedBooking, canEdit, setErrorMessage])

  // --- Booking detail actions ---
  function applyBookingPatch(patch: { id: string; status?: string | null; seated_at?: string | null; left_at?: string | null; no_show_at?: string | null; cancelled_at?: string | null; updated_at?: string | null }) {
    setSchedule((cur) => {
      if (!cur) return cur
      const p = (bs: FohBooking[]) => bs.map((b) => b.id === patch.id ? { ...b, ...patch } : b)
      return { ...cur, lanes: cur.lanes.map((l) => ({ ...l, bookings: p(l.bookings) })), unassigned_bookings: p(cur.unassigned_bookings) }
    })
    setSelectedBookingContext((cur) => {
      if (!cur || cur.booking.id !== patch.id) return cur
      return { ...cur, booking: { ...cur.booking, ...patch } }
    })
  }

  async function runAction(action: () => Promise<unknown>, successMessage: string, inFlightLabel?: string): Promise<boolean> {
    setShowCancelBookingConfirmation(false); setShowNoShowConfirmation(false)
    setErrorMessage(null); setStatusMessage(null)
    setBookingActionInFlight(inFlightLabel || successMessage)
    try {
      const result = await action()
      const rp = result as Record<string, unknown> | null
      const snap = rp && typeof rp.booking === 'object' && rp.booking !== null && typeof (rp.booking as any).id === 'string'
        ? (rp.booking as Parameters<typeof applyBookingPatch>[0]) : null
      if (snap) applyBookingPatch(snap)
      await reloadSchedule()
      setStatusMessage(successMessage)
      return true
    } catch (error) {
      if (error instanceof BookingActionError && error.payload) {
        const ep = error.payload
        if (typeof ep.booking === 'object' && ep.booking !== null && typeof (ep.booking as any).id === 'string') {
          applyBookingPatch(ep.booking as Parameters<typeof applyBookingPatch>[0])
        }
      }
      setErrorMessage(error instanceof Error ? error.message : 'Action failed')
      return false
    } finally { setBookingActionInFlight(null) }
  }

  function openBookingDetails(booking: FohBooking, ctx: { laneTableId: string | null; laneTableName: string | null }) {
    setSelectedBookingContext({ booking, laneTableId: ctx.laneTableId, laneTableName: ctx.laneTableName })
    setShowCancelBookingConfirmation(false); setShowNoShowConfirmation(false)
    setErrorMessage(null); setStatusMessage(null)
  }

  function closeBookingDetails() {
    setSelectedBookingContext(null); setBookingActionInFlight(null)
    setShowCancelBookingConfirmation(false); setShowNoShowConfirmation(false)
    setPartySizeEditOpen(false); setWalkoutModalOpen(false)
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

  // --- Render ---
  const pageWrapperClass = cn(isManagerKioskStyle ? 'space-y-2 rounded-xl bg-sidebar p-2 sm:p-3' : 'space-y-6')

  return (
    <div className={pageWrapperClass}>
      <FohHeader
        date={date}
        setDate={setDate as (date: string | ((current: string) => string)) => void}
        canEdit={canEdit}
        styleVariant={styleVariant}
        clockNow={clockNow}
        totals={totals}
        nextUpcomingEvent={nextUpcomingEvent}
        upcomingEventsLoaded={upcomingEventsLoaded}
        submittingFoodOrderAlert={submittingFoodOrderAlert}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        lastInteractionAtMsRef={lastInteractionAtMsRef}
        onSendFoodOrderAlert={() => void sendFoodOrderAlert()}
        onOpenCreateModal={createBooking.openCreateModal}
      />

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

      <FohBookingDetailModal
        selectedBookingContext={selectedBookingContext}
        canEdit={canEdit}
        bookingActionInFlight={bookingActionInFlight}
        showCancelBookingConfirmation={showCancelBookingConfirmation}
        showNoShowConfirmation={showNoShowConfirmation}
        selectedMoveTarget={selectedMoveTarget}
        selectedMoveOptions={selectedMoveOptions}
        loadingSelectedMoveOptions={loadingSelectedMoveOptions}
        onClose={closeBookingDetails}
        onRunAction={runAction}
        onMoveTargetChange={(bid, tid) => setMoveTargets((c) => ({ ...c, [bid]: tid }))}
        onSetShowCancelBookingConfirmation={setShowCancelBookingConfirmation}
        onSetShowNoShowConfirmation={setShowNoShowConfirmation}
        onOpenPartySizeEdit={(bid, size) => { setPartySizeEditBookingId(bid); setPartySizeEditValue(String(size)); setPartySizeEditOpen(true) }}
        onOpenWalkoutModal={(bid) => { setWalkoutBookingId(bid); setWalkoutAmountValue(''); setWalkoutModalOpen(true) }}
      />

      <FohCreateBookingModal
        open={createBooking.isCreateModalOpen}
        createMode={createBooking.createMode}
        createForm={createBooking.createForm}
        canWaiveDeposit={canWaiveDeposit}
        walkInTargetTable={createBooking.walkInTargetTable}
        submittingBooking={createBooking.submittingBooking}
        customerQuery={createBooking.customerQuery}
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
        sundayMenuItems={createBooking.sundayMenuItems}
        loadingSundayMenu={createBooking.loadingSundayMenu}
        sundayMenuError={createBooking.sundayMenuError}
        sundayPreorderQuantities={createBooking.sundayPreorderQuantities}
        sundayMenuByCategory={createBooking.sundayMenuByCategory}
        sundaySelectedItemCount={createBooking.sundaySelectedItemCount}
        formRequiresDeposit={createBooking.formRequiresDeposit}
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
        onSetSundayPreorderQuantities={createBooking.setSundayPreorderQuantities}
        onSetTableEventPromptAcknowledgedEventId={createBooking.setTableEventPromptAcknowledgedEventId}
        onSetWalkInPurposeAutoSelectionEnabled={createBooking.setWalkInPurposeAutoSelectionEnabled}
        onRetrySundayMenu={createBooking.retrySundayMenu}
        onSetErrorMessage={setErrorMessage}
      />

      <FohPartySizeModal
        open={partySizeEditOpen}
        bookingActionInFlight={bookingActionInFlight}
        partySizeEditValue={partySizeEditValue}
        onClose={() => setPartySizeEditOpen(false)}
        onPartySizeChange={setPartySizeEditValue}
        onConfirm={() => {
          const nextSize = Number.parseInt(partySizeEditValue, 10)
          if (!Number.isFinite(nextSize) || nextSize < 1 || nextSize > 50) { setErrorMessage('Enter a party size between 1 and 50.'); return }
          const bid = partySizeEditBookingId
          if (!bid) return
          setPartySizeEditOpen(false)
          void (async () => {
            const ok = await runAction(() => postBookingAction(`/api/foh/bookings/${bid}/party-size`, { party_size: nextSize, send_sms: true }), 'Party size updated', 'party_size')
            if (ok) closeBookingDetails()
          })()
        }}
      />

      <FohWalkoutModal
        open={walkoutModalOpen}
        bookingActionInFlight={bookingActionInFlight}
        walkoutAmountValue={walkoutAmountValue}
        onClose={() => setWalkoutModalOpen(false)}
        onAmountChange={setWalkoutAmountValue}
        onConfirm={() => {
          const amount = Number(walkoutAmountValue)
          if (!Number.isFinite(amount) || amount <= 0) { setErrorMessage('Please enter a valid walkout amount.'); return }
          const bid = walkoutBookingId
          if (!bid) return
          setWalkoutModalOpen(false)
          void (async () => {
            const ok = await runAction(() => postBookingAction(`/api/foh/bookings/${bid}/walkout`, { amount }), 'Walkout charge request created', 'walkout')
            if (ok) closeBookingDetails()
          })()
        }}
      />
    </div>
  )
}
