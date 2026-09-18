'use client'

import React from 'react'
import { Badge, Button, Modal } from '@/ds'
import { cn } from '@/lib/utils'
import {
  formatGbp,
  getTableBookingDepositBadgeClasses,
  getTableBookingDepositState,
} from '@/lib/table-bookings/ui'
import type {
  FohBooking,
  FohMoveTableOption,
  SelectedBookingContext,
} from '../types'
import {
  formatBookingWindow,
  formatLifecycleTime,
  getBookingVisualLabel,
  getBookingVisualState,
  statusBadgeClass,
  postBookingAction,
  getFohTimeChangeBlocker,
} from '../utils'

type FohBookingDetailModalProps = {
  selectedBookingContext: SelectedBookingContext | null
  canEdit: boolean
  bookingActionInFlight: string | null
  showCancelBookingConfirmation: boolean
  showNoShowConfirmation: boolean
  selectedMoveTarget: string
  selectedMoveOptions: FohMoveTableOption[]
  loadingSelectedMoveOptions: boolean
  onClose: () => void
  onRunAction: (
    action: () => Promise<unknown>,
    successMessage: string,
    inFlightLabel?: string
  ) => Promise<boolean>
  onMoveTargetChange: (bookingId: string, tableId: string) => void
  onSetShowCancelBookingConfirmation: (value: boolean) => void
  onSetShowNoShowConfirmation: (value: boolean) => void
  onOpenPartySizeEdit: (bookingId: string, currentSize: number) => void
  onOpenWalkoutModal: (bookingId: string) => void
  onOpenChangeTime: (bookingId: string) => void
}

export const FohBookingDetailModal = React.memo(function FohBookingDetailModal(props: FohBookingDetailModalProps) {
  const {
    selectedBookingContext,
    canEdit,
    bookingActionInFlight,
    showCancelBookingConfirmation,
    showNoShowConfirmation,
    selectedMoveTarget,
    selectedMoveOptions,
    loadingSelectedMoveOptions,
    onClose,
    onRunAction,
    onMoveTargetChange,
    onSetShowCancelBookingConfirmation,
    onSetShowNoShowConfirmation,
    onOpenPartySizeEdit,
    onOpenWalkoutModal,
    onOpenChangeTime,
  } = props

  const selectedBooking = selectedBookingContext?.booking ?? null
  if (!selectedBooking) {
    return (
      <Modal
        open={false}
        onClose={onClose}
        title="Booking details"
        size="md"
      >
        {null}
      </Modal>
    )
  }

  const selectedBookingVisualState = getBookingVisualState(selectedBooking)
  const selectedBookingVisualLabel = getBookingVisualLabel(selectedBooking)
  const selectedBookingDeposit = getTableBookingDepositState(selectedBooking)
  const selectedBookingIsEventOnly =
    selectedBooking.is_communal_event_block ||
    selectedBooking.id.startsWith('communal-') ||
    selectedBooking.id.startsWith('standing-')
  const selectedBookingIsOutside = selectedBooking.is_outside_seating === true
  const selectedBookingHighChairs = selectedBooking.high_chair_count ?? 0
  const selectedBookingNeedsStepFree = selectedBooking.requires_accessible_table === true
  const selectedBookingSeatedTime = formatLifecycleTime(selectedBooking.seated_at)
  const selectedBookingLeftTime = formatLifecycleTime(selectedBooking.left_at)
  const selectedBookingNoShowTime = formatLifecycleTime(selectedBooking.no_show_at)
  const selectedBookingCanBeCancelled = Boolean(
    selectedBooking &&
      !selectedBooking.is_private_block &&
      selectedBookingVisualState !== 'cancelled' &&
      selectedBookingVisualState !== 'no_show'
  )

  return (
    <Modal
      open={Boolean(selectedBookingContext)}
      onClose={onClose}
      title="Booking details"
      description={`${selectedBooking.booking_reference || selectedBooking.id.slice(0, 8)} · ${getBookingVisualLabel(selectedBooking)}`}
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text">
              {selectedBooking.booking_reference || selectedBooking.id.slice(0, 8)}
            </p>
            <Badge className={statusBadgeClass(selectedBookingVisualState)}>
              {selectedBookingVisualLabel}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-text">
            {selectedBooking.guest_name ? `${selectedBooking.guest_name} · ` : ''}
            {selectedBooking.is_private_block
              ? formatBookingWindow(selectedBooking.start_datetime, selectedBooking.end_datetime, selectedBooking.booking_time)
              : `${formatBookingWindow(selectedBooking.start_datetime, selectedBooking.end_datetime, selectedBooking.booking_time)} · ${selectedBooking.party_size || 1} people`}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {selectedBooking.booking_type || 'regular'} · {selectedBooking.booking_purpose || 'food'}
            {selectedBooking.event_seating_type ? ` · ${selectedBooking.event_seating_type}` : ''}
            {selectedBooking.assignment_count && selectedBooking.assignment_count > 1 ? ` · joined ${selectedBooking.assignment_count} tables` : ''}
            {selectedBookingContext?.laneTableName ? ` · table ${selectedBookingContext.laneTableName}` : ''}
          </p>
          {(selectedBookingIsOutside || selectedBookingHighChairs > 0 || selectedBookingNeedsStepFree) && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {selectedBookingIsOutside ? <Badge tone="info">Outside</Badge> : null}
              {selectedBookingNeedsStepFree ? <Badge tone="warning">Step-free table</Badge> : null}
              {selectedBookingHighChairs > 0 ? <Badge tone="neutral">High chair ×{selectedBookingHighChairs}</Badge> : null}
            </div>
          )}
          {(selectedBookingSeatedTime || selectedBookingLeftTime || selectedBookingNoShowTime) && (
            <p className="mt-1 text-xs text-text-muted">
              {selectedBookingSeatedTime ? `Seated ${selectedBookingSeatedTime}` : null}
              {selectedBookingLeftTime ? `${selectedBookingSeatedTime ? ' · ' : ''}Left ${selectedBookingLeftTime}` : null}
              {selectedBookingNoShowTime
                ? `${selectedBookingSeatedTime || selectedBookingLeftTime ? ' · ' : ''}No-show ${selectedBookingNoShowTime}`
                : null}
            </p>
          )}
          {selectedBookingDeposit.kind !== 'none' && (
            <Badge className={cn('mt-2', getTableBookingDepositBadgeClasses(selectedBookingDeposit.kind))}>
              {selectedBookingDeposit.label}
              {selectedBookingDeposit.amount != null ? ` · ${formatGbp(selectedBookingDeposit.amount)}` : ''}
              {selectedBookingDeposit.methodLabel ? ` · ${selectedBookingDeposit.methodLabel}` : ''}
            </Badge>
          )}
        </div>

        <GuestRequirements booking={selectedBooking} />

        {selectedBooking.is_private_block && (
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
            This block is managed by private-booking area mapping. Edit the private booking or area mapping in settings.
          </div>
        )}

        {selectedBookingIsEventOnly && (
          <div className="rounded-md border border-info-border bg-info-soft px-3 py-2 text-xs text-info-fg">
            Manage this event booking from the event attendees list.
          </div>
        )}

        {canEdit && !selectedBooking.is_private_block && !selectedBookingIsEventOnly && (
          <BookingActions
            selectedBooking={selectedBooking}
            selectedBookingIsOutside={selectedBookingIsOutside}
            bookingActionInFlight={bookingActionInFlight}
            showCancelBookingConfirmation={showCancelBookingConfirmation}
            showNoShowConfirmation={showNoShowConfirmation}
            selectedBookingCanBeCancelled={selectedBookingCanBeCancelled}
            selectedMoveTarget={selectedMoveTarget}
            selectedMoveOptions={selectedMoveOptions}
            loadingSelectedMoveOptions={loadingSelectedMoveOptions}
            currentTableName={selectedBookingContext?.laneTableName ?? null}
            onClose={onClose}
            onRunAction={onRunAction}
            onMoveTargetChange={onMoveTargetChange}
            onSetShowCancelBookingConfirmation={onSetShowCancelBookingConfirmation}
            onSetShowNoShowConfirmation={onSetShowNoShowConfirmation}
            onOpenPartySizeEdit={onOpenPartySizeEdit}
            onOpenWalkoutModal={onOpenWalkoutModal}
            onOpenChangeTime={onOpenChangeTime}
            timeChangeBlocker={getFohTimeChangeBlocker(selectedBooking)}
          />
        )}

        <div className="flex justify-end border-t border-border pt-3">
          <Button type="button" variant="secondary" size="lg" onClick={onClose} className="min-h-touch">
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
})

/**
 * Everything the guest asked for, in one block the floor cannot miss.
 *
 * These details were previously either invisible (allergies, dietary
 * requirements and the celebration were never even fetched by the FOH API) or
 * buried as 11px grey text under the booking reference. On an iPad carried
 * across a busy room, an allergy set in that style is a note nobody reads.
 * Allergies lead, and are styled as a warning, because they are the only entry
 * here where missing it can hurt somebody.
 */
function GuestRequirements({ booking }: { booking: FohBooking }) {
  const allergies = (booking.allergies ?? []).filter((entry) => entry && entry.trim().length > 0)
  const dietary = (booking.dietary_requirements ?? []).filter(
    (entry) => entry && entry.trim().length > 0,
  )
  const highChairs = booking.high_chair_count ?? 0
  const rows: Array<{ label: string; value: string }> = []

  if (dietary.length > 0) rows.push({ label: 'Dietary', value: dietary.join(', ') })
  if (booking.requires_accessible_table === true) {
    rows.push({ label: 'Access', value: 'Step-free table required' })
  }
  if (highChairs > 0) {
    rows.push({ label: 'High chairs', value: String(highChairs) })
  }
  if (booking.celebration_type) rows.push({ label: 'Occasion', value: booking.celebration_type })
  if (booking.notes) rows.push({ label: 'Guest note', value: booking.notes })
  if (booking.internal_notes) rows.push({ label: 'Staff note', value: booking.internal_notes })

  if (allergies.length === 0 && rows.length === 0) return null

  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-semibold text-text">Guest requirements</p>

      {allergies.length > 0 && (
        <div className="mt-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-danger-fg">Allergies</p>
          <p className="mt-0.5 text-sm font-semibold text-danger-fg">{allergies.join(', ')}</p>
        </div>
      )}

      {rows.length > 0 && (
        <dl className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-2 text-sm">
              <dt className="w-24 shrink-0 text-text-muted">{row.label}</dt>
              <dd className="min-w-0 flex-1 text-text">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

// The action grid: full-width tiles at the 44px touch floor (owner decision D6). The
// destructive two-step actions keep a red outline so they read differently from the rest,
// and turn solid pale red while their confirm step is open.
const ACTION_BUTTON_CLASS = 'min-h-touch w-full'
const DANGER_OUTLINE_CLASS = 'border-danger-border text-danger-fg hover:bg-danger-soft'
const DANGER_OUTLINE_SELECTED_CLASS = 'border-danger bg-danger-soft'

// Inner component for the action buttons section
function BookingActions(props: {
  selectedBooking: FohBooking
  selectedBookingIsOutside: boolean
  bookingActionInFlight: string | null
  showCancelBookingConfirmation: boolean
  showNoShowConfirmation: boolean
  selectedBookingCanBeCancelled: boolean
  selectedMoveTarget: string
  selectedMoveOptions: FohMoveTableOption[]
  loadingSelectedMoveOptions: boolean
  currentTableName: string | null
  onClose: () => void
  onRunAction: (
    action: () => Promise<unknown>,
    successMessage: string,
    inFlightLabel?: string
  ) => Promise<boolean>
  onMoveTargetChange: (bookingId: string, tableId: string) => void
  onSetShowCancelBookingConfirmation: (value: boolean) => void
  onSetShowNoShowConfirmation: (value: boolean) => void
  onOpenPartySizeEdit: (bookingId: string, currentSize: number) => void
  onOpenWalkoutModal: (bookingId: string) => void
  onOpenChangeTime: (bookingId: string) => void
  timeChangeBlocker: string | null
}) {
  const {
    selectedBooking,
    selectedBookingIsOutside,
    bookingActionInFlight,
    showCancelBookingConfirmation,
    showNoShowConfirmation,
    selectedBookingCanBeCancelled,
    selectedMoveTarget,
    selectedMoveOptions,
    loadingSelectedMoveOptions,
    currentTableName,
    onClose,
    onRunAction,
    onMoveTargetChange,
    onSetShowCancelBookingConfirmation,
    onSetShowNoShowConfirmation,
    onOpenPartySizeEdit,
    onOpenWalkoutModal,
    onOpenChangeTime,
    timeChangeBlocker,
  } = props

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={Boolean(bookingActionInFlight)}
          onClick={() => {
            void (async () => {
              const ok = await onRunAction(
                () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/seated`),
                'Marked as seated',
                'seated'
              )
              if (ok) onClose()
            })()
          }}
          className={ACTION_BUTTON_CLASS}
        >
          {bookingActionInFlight === 'seated' ? 'Marking...' : 'Mark seated'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={Boolean(bookingActionInFlight)}
          onClick={() => {
            void (async () => {
              const ok = await onRunAction(
                () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/left`),
                'Marked as left',
                'left'
              )
              if (ok) onClose()
            })()
          }}
          className={ACTION_BUTTON_CLASS}
        >
          {bookingActionInFlight === 'left' ? 'Marking...' : 'Mark left'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={Boolean(bookingActionInFlight)}
          onClick={() => {
            onSetShowNoShowConfirmation(!showNoShowConfirmation)
          }}
          className={cn(ACTION_BUTTON_CLASS, DANGER_OUTLINE_CLASS, showNoShowConfirmation && DANGER_OUTLINE_SELECTED_CLASS)}
        >
          {bookingActionInFlight === 'no_show' ? 'Saving...' : showNoShowConfirmation ? 'No-show selected' : 'Mark no-show'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={Boolean(bookingActionInFlight)}
          onClick={() => {
            const currentSize = Math.max(1, Number(selectedBooking.party_size || 1))
            onOpenPartySizeEdit(selectedBooking.id, currentSize)
          }}
          className={ACTION_BUTTON_CLASS}
        >
          {bookingActionInFlight === 'party_size' ? 'Saving...' : 'Edit party size'}
        </Button>
        {/* Until this existed, the only way to re-time a booking was to drag it on the
            timeline, and drag is switched off in kiosk mode, which is what the floor iPad
            runs. There was no route to a time change at all on that screen. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={Boolean(bookingActionInFlight) || Boolean(timeChangeBlocker)}
          title={timeChangeBlocker ?? undefined}
          onClick={() => {
            if (timeChangeBlocker) return
            onOpenChangeTime(selectedBooking.id)
          }}
          className={ACTION_BUTTON_CLASS}
        >
          {bookingActionInFlight === 'change_time' ? 'Changing...' : 'Change time'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={Boolean(bookingActionInFlight) || !selectedBookingCanBeCancelled}
          onClick={() => {
            if (!selectedBookingCanBeCancelled) return
            onSetShowCancelBookingConfirmation(!showCancelBookingConfirmation)
          }}
          className={cn(ACTION_BUTTON_CLASS, DANGER_OUTLINE_CLASS, showCancelBookingConfirmation && DANGER_OUTLINE_SELECTED_CLASS)}
        >
          {showCancelBookingConfirmation ? 'Cancel selected' : 'Cancel booking'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={Boolean(bookingActionInFlight)}
          onClick={() => {
            onOpenWalkoutModal(selectedBooking.id)
          }}
          className={cn(ACTION_BUTTON_CLASS, DANGER_OUTLINE_CLASS)}
        >
          {bookingActionInFlight === 'walkout' ? 'Saving...' : 'Flag walkout'}
        </Button>
      </div>

      {showNoShowConfirmation && (
        <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2">
          <p className="text-xs font-semibold text-danger-fg">Confirm no-show</p>
          <p className="mt-1 text-xs text-danger-fg">
            This will mark the booking as no-show and remove it from active covers.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={Boolean(bookingActionInFlight)}
              onClick={() => onSetShowNoShowConfirmation(false)}
              className="min-h-touch"
            >
              Go back
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={Boolean(bookingActionInFlight)}
              onClick={() => {
                void (async () => {
                  const ok = await onRunAction(
                    () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/no-show`),
                    'No-show recorded',
                    'no_show'
                  )
                  if (ok) onClose()
                })()
              }}
              className="min-h-touch"
            >
              {bookingActionInFlight === 'no_show' ? 'Saving...' : 'Confirm no-show'}
            </Button>
          </div>
        </div>
      )}

      {showCancelBookingConfirmation && selectedBookingCanBeCancelled && (
        <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2">
          <p className="text-xs font-semibold text-danger-fg">Confirm cancellation</p>
          <p className="mt-1 text-xs text-danger-fg">
            This will mark the booking as cancelled and remove it from active covers.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={Boolean(bookingActionInFlight)}
              onClick={() => onSetShowCancelBookingConfirmation(false)}
              className="min-h-touch"
            >
              Keep booking
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={Boolean(bookingActionInFlight)}
              onClick={() => {
                void (async () => {
                  const ok = await onRunAction(
                    () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/cancel`),
                    'Booking cancelled',
                    'cancel'
                  )
                  if (ok) onClose()
                })()
              }}
              className="min-h-touch"
            >
              {bookingActionInFlight === 'cancel' ? 'Cancelling...' : 'Confirm cancel'}
            </Button>
          </div>
        </div>
      )}

      {/* Move table, last.
          Each table is a single large tap target rather than the old 12px dropdown, because this
          screen runs on an iPad on the floor. One tap moves. There is no confirm step: a move is
          not destructive, shows on the timeline immediately, notifies nobody, and is undone by
          tapping the original table.
          It sits below the action buttons because the grid grows with the number of free tables,
          and with a quiet room it ran to twenty-odd tiles that pushed Mark seated, Mark left and
          the rest off the bottom of the screen. The frequent actions stay reachable without
          scrolling; moving a table is worth a scroll. */}
      {selectedBookingIsOutside ? (
        <p className="text-xs text-text-muted">Outside booking, so there is no table to move.</p>
      ) : (
        <div className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-text">Move to another table</p>
            {currentTableName ? (
              <p className="text-xs text-text-muted">Currently on {currentTableName}</p>
            ) : null}
          </div>

          {loadingSelectedMoveOptions ? (
            <p className="mt-2 text-xs text-text-muted">Loading available tables...</p>
          ) : selectedMoveOptions.length === 0 ? (
            <p className="mt-2 text-xs text-text-muted">No other table is free for this time.</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {selectedMoveOptions.map((table) => {
                const moving = bookingActionInFlight === 'move' && selectedMoveTarget === table.id
                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={Boolean(bookingActionInFlight)}
                    onClick={() => {
                      // Recorded so the tapped tile, and only that tile, shows the in-flight state.
                      onMoveTargetChange(selectedBooking.id, table.id)
                      void (async () => {
                        const ok = await onRunAction(
                          () =>
                            postBookingAction(`/api/foh/bookings/${selectedBooking.id}/move-table`, {
                              table_ids: table.table_ids?.length ? table.table_ids : [table.id]
                            }),
                          `Moved to ${table.name}`,
                          'move'
                        )
                        if (ok) onClose()
                      })()
                    }}
                    className={cn(
                      'flex min-h-14 flex-col items-center justify-center rounded-lg border px-2 py-2 text-center',
                      'focus-visible:outline-hidden focus-visible:shadow-ring',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      moving
                        ? 'border-primary bg-primary-soft text-primary-soft-fg'
                        : 'border-border-strong text-text hover:bg-surface-hover'
                    )}
                  >
                    <span className="text-sm font-semibold leading-tight">
                      {moving ? 'Moving...' : table.name}
                    </span>
                    {!moving && table.capacity ? (
                      <span className="mt-0.5 text-xs text-text-muted">Seats {table.capacity}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
