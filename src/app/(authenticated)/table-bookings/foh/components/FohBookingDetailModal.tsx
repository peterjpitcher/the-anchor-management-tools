'use client'

import React from 'react'
import { Modal } from '@/components/ui-v2/overlay/Modal'
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
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">
              {selectedBooking.booking_reference || selectedBooking.id.slice(0, 8)}
            </p>
            <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(selectedBookingVisualState)}`}>
              {selectedBookingVisualLabel}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-700">
            {selectedBooking.guest_name ? `${selectedBooking.guest_name} · ` : ''}
            {selectedBooking.is_private_block
              ? formatBookingWindow(selectedBooking.start_datetime, selectedBooking.end_datetime, selectedBooking.booking_time)
              : `${formatBookingWindow(selectedBooking.start_datetime, selectedBooking.end_datetime, selectedBooking.booking_time)} · ${selectedBooking.party_size || 1} people`}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {selectedBooking.booking_type || 'regular'} · {selectedBooking.booking_purpose || 'food'}
            {selectedBooking.assignment_count && selectedBooking.assignment_count > 1 ? ` · joined ${selectedBooking.assignment_count} tables` : ''}
            {selectedBookingContext?.laneTableName ? ` · table ${selectedBookingContext.laneTableName}` : ''}
          </p>
          {(selectedBookingSeatedTime || selectedBookingLeftTime || selectedBookingNoShowTime) && (
            <p className="mt-1 text-xs text-gray-500">
              {selectedBookingSeatedTime ? `Seated ${selectedBookingSeatedTime}` : null}
              {selectedBookingLeftTime ? `${selectedBookingSeatedTime ? ' · ' : ''}Left ${selectedBookingLeftTime}` : null}
              {selectedBookingNoShowTime
                ? `${selectedBookingSeatedTime || selectedBookingLeftTime ? ' · ' : ''}No-show ${selectedBookingNoShowTime}`
                : null}
            </p>
          )}
          {selectedBooking.notes && <p className="mt-1 text-xs text-gray-600">Note: {selectedBooking.notes}</p>}
          {selectedBookingDeposit.kind !== 'none' && (
            <span
              className={`mt-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getTableBookingDepositBadgeClasses(selectedBookingDeposit.kind)}`}
            >
              {selectedBookingDeposit.label}
              {selectedBookingDeposit.amount != null ? ` · ${formatGbp(selectedBookingDeposit.amount)}` : ''}
              {selectedBookingDeposit.methodLabel ? ` · ${selectedBookingDeposit.methodLabel}` : ''}
            </span>
          )}
        </div>

        {selectedBooking.is_private_block && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            This block is managed by private-booking area mapping. Edit the private booking or area mapping in settings.
          </div>
        )}

        {canEdit && !selectedBooking.is_private_block && (
          <BookingActions
            selectedBooking={selectedBooking}
            bookingActionInFlight={bookingActionInFlight}
            showCancelBookingConfirmation={showCancelBookingConfirmation}
            showNoShowConfirmation={showNoShowConfirmation}
            selectedBookingCanBeCancelled={selectedBookingCanBeCancelled}
            selectedMoveTarget={selectedMoveTarget}
            selectedMoveOptions={selectedMoveOptions}
            loadingSelectedMoveOptions={loadingSelectedMoveOptions}
            onClose={onClose}
            onRunAction={onRunAction}
            onMoveTargetChange={onMoveTargetChange}
            onSetShowCancelBookingConfirmation={onSetShowCancelBookingConfirmation}
            onSetShowNoShowConfirmation={onSetShowNoShowConfirmation}
            onOpenPartySizeEdit={onOpenPartySizeEdit}
            onOpenWalkoutModal={onOpenWalkoutModal}
          />
        )}

        <div className="flex justify-end border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
})

// Inner component for the action buttons section
function BookingActions(props: {
  selectedBooking: FohBooking
  bookingActionInFlight: string | null
  showCancelBookingConfirmation: boolean
  showNoShowConfirmation: boolean
  selectedBookingCanBeCancelled: boolean
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
}) {
  const {
    selectedBooking,
    bookingActionInFlight,
    showCancelBookingConfirmation,
    showNoShowConfirmation,
    selectedBookingCanBeCancelled,
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
  } = props

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
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
          className="rounded-md border border-gray-300 px-2 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {bookingActionInFlight === 'seated' ? 'Marking...' : 'Mark seated'}
        </button>
        <button
          type="button"
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
          className="rounded-md border border-gray-300 px-2 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {bookingActionInFlight === 'left' ? 'Marking...' : 'Mark left'}
        </button>
        <button
          type="button"
          disabled={Boolean(bookingActionInFlight)}
          onClick={() => {
            onSetShowNoShowConfirmation(!showNoShowConfirmation)
          }}
          className={cn(
            'rounded-md border px-2 py-2.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-60',
            showNoShowConfirmation
              ? 'border-red-400 bg-red-100 text-red-800'
              : 'border-red-300 text-red-700 hover:bg-red-50'
          )}
        >
          {bookingActionInFlight === 'no_show' ? 'Saving...' : showNoShowConfirmation ? 'No-show selected' : 'Mark no-show'}
        </button>
        <button
          type="button"
          disabled={Boolean(bookingActionInFlight)}
          onClick={() => {
            const currentSize = Math.max(1, Number(selectedBooking.party_size || 1))
            onOpenPartySizeEdit(selectedBooking.id, currentSize)
          }}
          className="rounded-md border border-gray-300 px-2 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {bookingActionInFlight === 'party_size' ? 'Saving...' : 'Edit party size'}
        </button>
        <button
          type="button"
          disabled={Boolean(bookingActionInFlight) || !selectedBookingCanBeCancelled}
          onClick={() => {
            if (!selectedBookingCanBeCancelled) return
            onSetShowCancelBookingConfirmation(!showCancelBookingConfirmation)
          }}
          className={cn(
            'rounded-md border px-2 py-2.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-60',
            showCancelBookingConfirmation
              ? 'border-red-400 bg-red-100 text-red-800'
              : 'border-red-300 text-red-700 hover:bg-red-50'
          )}
        >
          {showCancelBookingConfirmation ? 'Cancel selected' : 'Cancel booking'}
        </button>
        <button
          type="button"
          disabled={Boolean(bookingActionInFlight)}
          onClick={() => {
            onOpenWalkoutModal(selectedBooking.id)
          }}
          className="rounded-md border border-red-300 px-2 py-2.5 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {bookingActionInFlight === 'walkout' ? 'Saving...' : 'Flag walkout'}
        </button>
      </div>

      {showNoShowConfirmation && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2">
          <p className="text-xs font-semibold text-red-900">Confirm no-show</p>
          <p className="mt-1 text-xs text-red-800">
            This will mark the booking as no-show and remove it from active covers.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={Boolean(bookingActionInFlight)}
              onClick={() => onSetShowNoShowConfirmation(false)}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Go back
            </button>
            <button
              type="button"
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
              className="rounded-md border border-red-400 bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bookingActionInFlight === 'no_show' ? 'Saving...' : 'Confirm no-show'}
            </button>
          </div>
        </div>
      )}

      {showCancelBookingConfirmation && selectedBookingCanBeCancelled && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2">
          <p className="text-xs font-semibold text-red-900">Confirm cancellation</p>
          <p className="mt-1 text-xs text-red-800">
            This will mark the booking as cancelled and remove it from active covers.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={Boolean(bookingActionInFlight)}
              onClick={() => onSetShowCancelBookingConfirmation(false)}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Keep booking
            </button>
            <button
              type="button"
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
              className="rounded-md border border-red-400 bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bookingActionInFlight === 'cancel' ? 'Cancelling...' : 'Confirm cancel'}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <select
          value={selectedMoveTarget}
          disabled={Boolean(bookingActionInFlight) || loadingSelectedMoveOptions || selectedMoveOptions.length === 0}
          onChange={(event) => onMoveTargetChange(selectedBooking.id, event.target.value)}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
        >
          <option value="">
            {loadingSelectedMoveOptions
              ? 'Loading available tables...'
              : selectedMoveOptions.length === 0
                ? 'No available tables'
                : 'Move to table...'}
          </option>
          {selectedMoveOptions.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
              {table.table_number ? ` (${table.table_number})` : ''}
              {table.capacity ? ` · cap ${table.capacity}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedMoveTarget || Boolean(bookingActionInFlight) || loadingSelectedMoveOptions}
          onClick={() => {
            if (!selectedMoveTarget) return
            void (async () => {
              const ok = await onRunAction(
                () =>
                  postBookingAction(`/api/foh/bookings/${selectedBooking.id}/move-table`, {
                    table_id: selectedMoveTarget
                  }),
                'Table assignment moved',
                'move'
              )
              if (ok) onClose()
            })()
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {bookingActionInFlight === 'move' ? 'Moving...' : 'Move'}
        </button>
      </div>
    </div>
  )
}
