'use client'

import React from 'react'
import { Alert, Badge, Button, Input, LinkButton, Modal, Textarea } from '@/ds'
import { parseAllergyList } from '@/lib/table-bookings/allergy-words'
import { cn } from '@/lib/utils'
import { formatChristmasCourseTally } from '@/lib/table-bookings/christmas'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { FohDepositActions } from './FohDepositActions'
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
  getFohPanelActions,
  isFohEventLinkedBooking,
} from '../utils'
import type { FohPanelNotice, FohRunAction } from '../hooks/useFohBookingActions'
import { staffCancellationBody } from '@/lib/table-bookings/staff-cancellation'
import { FohCancelBookingConfirm } from './FohCancelBookingConfirm'

type FohBookingDetailModalProps = {
  selectedBookingContext: SelectedBookingContext | null
  canEdit: boolean
  /** table_bookings manage: may choose the refund amount when cancelling (BK-046). */
  canChooseRefund?: boolean
  bookingActionInFlight: string | null
  showCancelBookingConfirmation: boolean
  selectedMoveTarget: string
  selectedMoveOptions: FohMoveTableOption[]
  loadingSelectedMoveOptions: boolean
  onClose: () => void
  onRunAction: FohRunAction
  onMoveTargetChange: (bookingId: string, tableId: string) => void
  onSetShowCancelBookingConfirmation: (value: boolean) => void
  onOpenPartySizeEdit: (bookingId: string, currentSize: number) => void
  onOpenWalkoutModal: (bookingId: string) => void
  onOpenChangeTime: (bookingId: string) => void
  /** table_bookings manage: may settle an owed deposit after booking (BK-045, D18). */
  canManageDeposit?: boolean
  /**
   * What the last action said, shown here inside the panel: an error or a success under an open
   * dialog is a message nobody reads (owner decision, 22 November 2026).
   */
  notice?: FohPanelNotice | null
  onDismissNotice?: () => void
  /** The time now, so the panel offers only what fits the booking's state. Defaults to the clock. */
  now?: Date
}

export const FohBookingDetailModal = React.memo(function FohBookingDetailModal(props: FohBookingDetailModalProps) {
  const {
    selectedBookingContext,
    canEdit,
    canChooseRefund = false,
    bookingActionInFlight,
    showCancelBookingConfirmation,
    selectedMoveTarget,
    selectedMoveOptions,
    loadingSelectedMoveOptions,
    onClose,
    onRunAction,
    onMoveTargetChange,
    onSetShowCancelBookingConfirmation,
    onOpenPartySizeEdit,
    onOpenWalkoutModal,
    onOpenChangeTime,
    canManageDeposit = false,
    notice = null,
    onDismissNotice,
    now,
  } = props

  // A new message is brought into view: the panel scrolls, and the action that caused it may
  // sit below the fold (the move-table grid).
  const noticeRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [notice])

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
  // The table half of an event booking is cancelled or no-showed from the event (BK-074).
  const selectedBookingIsEventLinked = isFohEventLinkedBooking(selectedBooking)
  const selectedBookingCanBeCancelled = Boolean(
    selectedBooking &&
      !selectedBookingIsEventLinked &&
      !selectedBooking.is_private_block &&
      selectedBookingVisualState !== 'cancelled' &&
      selectedBookingVisualState !== 'no_show'
  )

  return (
    <Modal
      open={Boolean(selectedBookingContext)}
      onClose={onClose}
      title="Booking details"
      size="md"
    >
      <div className="space-y-4">
        {notice && (
          <div ref={noticeRef}>
            <Alert
              tone={notice.tone}
              size="sm"
              role={notice.tone === 'success' ? 'status' : 'alert'}
              closable={Boolean(onDismissNotice)}
              onClose={onDismissNotice}
            >
              {notice.text}
            </Alert>
          </div>
        )}
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
          {selectedBooking.guest_phone && (
            // Staff ring a party that is late. A real link, so the iPad or a paired phone can dial.
            <p className="mt-1 text-sm text-text">
              Phone:{' '}
              <a
                href={`tel:${selectedBooking.guest_phone}`}
                className="inline-flex min-h-touch items-center font-semibold text-primary underline"
              >
                {selectedBooking.guest_phone}
              </a>
            </p>
          )}
          <p className="mt-1 text-xs text-text-muted">
            {selectedBooking.booking_type || 'regular'} · {selectedBooking.booking_purpose || 'food'}
            {selectedBooking.event_seating_type ? ` · ${selectedBooking.event_seating_type}` : ''}
            {selectedBooking.assignment_count && selectedBooking.assignment_count > 1 ? ` · joined ${selectedBooking.assignment_count} tables` : ''}
            {selectedBookingContext?.laneTableName ? ` · table ${selectedBookingContext.laneTableName}` : ''}
          </p>
          {selectedBookingIsEventLinked && (
            <p className="mt-1 text-xs text-text">
              <Badge tone="info">Event booking</Badge>{' '}
              Linked to event booking for {selectedBooking.event_name || 'an event'}. Change or cancel it from the event.
            </p>
          )}
          {selectedBooking.booking_type === 'christmas' && (
            // BK-057: who is on 1, 2 or 3 courses, so the floor can price the bill.
            <p className="mt-1 text-xs text-text">
              Christmas courses:{' '}
              {formatChristmasCourseTally(selectedBooking.christmas_course_counts) || 'not recorded yet'}
            </p>
          )}
          {selectedBooking.guest_confirmed_at && Number.isFinite(Date.parse(selectedBooking.guest_confirmed_at)) && (
            // BK-094: the guest answered the day-before 'please confirm' text.
            <p className="mt-1 text-xs text-text">
              <Badge tone="success">Confirmed by guest</Badge>{' '}
              {formatDateTime12Hour(selectedBooking.guest_confirmed_at)}
            </p>
          )}
          {selectedBooking.guest_party_size_change && (
            // BK-091: the guest changed the party size themselves, so staff know who did it.
            <p className="mt-1 text-xs text-text">
              <Badge tone="info">Changed by guest</Badge>{' '}
              {selectedBooking.guest_party_size_change.from != null && selectedBooking.guest_party_size_change.to != null
                ? `Party size ${selectedBooking.guest_party_size_change.from} to ${selectedBooking.guest_party_size_change.to}`
                : 'Party size changed'}
              {Number.isFinite(Date.parse(selectedBooking.guest_party_size_change.at))
                ? `, ${formatDateTime12Hour(selectedBooking.guest_party_size_change.at)}`
                : ''}
            </p>
          )}
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

        {!selectedBooking.is_private_block && !selectedBookingIsEventOnly && (
          // The booking's one-pager: who is eating what and every guest's allergy (D14). View only on
          // this login; the sheet page decides who may download it.
          <LinkButton
            href={`/table-bookings/${selectedBooking.id}/sheet`}
            variant="secondary"
            size="lg"
            className="min-h-touch w-full"
          >
            Open the booking sheet
          </LinkButton>
        )}

        {canManageDeposit && selectedBookingDeposit.kind === 'pending' && !selectedBookingIsEventOnly && !selectedBooking.is_private_block && (
          <FohDepositActions
            bookingId={selectedBooking.id}
            bookingStartIso={selectedBooking.start_datetime ?? null}
            bookingActionInFlight={bookingActionInFlight}
            onRunAction={onRunAction}
          />
        )}

        {canEdit && !selectedBooking.is_private_block && !selectedBookingIsEventOnly && (
          // Keyed on the booking so a different booking never inherits half-typed notes.
          <GuestNotesEditor
            key={selectedBooking.id}
            booking={selectedBooking}
            busy={Boolean(bookingActionInFlight)}
            onRunAction={onRunAction}
          />
        )}

        {selectedBooking.is_private_block && (
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text">
            This table is held for a private hire, so it cannot be booked or changed from here. To free it, change the
            private booking.
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
            canChooseRefund={canChooseRefund}
            selectedBookingIsOutside={selectedBookingIsOutside}
            bookingActionInFlight={bookingActionInFlight}
            showCancelBookingConfirmation={showCancelBookingConfirmation}
            now={now}
            selectedBookingCanBeCancelled={selectedBookingCanBeCancelled}
            selectedMoveTarget={selectedMoveTarget}
            selectedMoveOptions={selectedMoveOptions}
            loadingSelectedMoveOptions={loadingSelectedMoveOptions}
            currentTableName={selectedBookingContext?.laneTableName ?? null}
            onClose={onClose}
            onRunAction={onRunAction}
            onMoveTargetChange={onMoveTargetChange}
            onSetShowCancelBookingConfirmation={onSetShowCancelBookingConfirmation}
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

  const guestAllergies = booking.guest_allergies === true

  if (allergies.length === 0 && rows.length === 0 && !guestAllergies) return null

  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-semibold text-text">Guest requirements</p>

      {(allergies.length > 0 || guestAllergies) && (
        <div className="mt-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-danger-fg">Allergies</p>
          {allergies.length > 0 && (
            <p className="mt-0.5 text-sm font-semibold text-danger-fg">{allergies.join(', ')}</p>
          )}
          {guestAllergies && (
            <p className="mt-0.5 text-sm font-semibold text-danger-fg">
              A guest has an allergy. Open the booking sheet to see who.
            </p>
          )}
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

/**
 * Notes and allergies, changed from the floor (BK-052). A guest often mentions an allergy on
 * arrival, and FOH-only staff cannot open the back-office booking page where these used to be
 * the only fields. Allergies go in their own field, so the red flag, the kitchen sheet and the
 * timeline marker all see them.
 */
function GuestNotesEditor({
  booking,
  busy,
  onRunAction,
}: {
  booking: FohBooking
  busy: boolean
  onRunAction: FohRunAction
}) {
  const [open, setOpen] = React.useState(false)
  const [notes, setNotes] = React.useState(booking.special_requirements ?? '')
  const [allergies, setAllergies] = React.useState((booking.allergies ?? []).join(', '))

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="min-h-touch w-full" onClick={() => setOpen(true)}>
        Edit Notes and Allergies
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <Input
        label="Allergies"
        hint="Separate each one with a comma, for example: peanuts, shellfish."
        value={allergies}
        maxLength={600}
        onChange={(event) => setAllergies(event.target.value)}
      />
      <Textarea
        label="Notes"
        rows={3}
        maxLength={2000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" className="min-h-touch" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          className="min-h-touch"
          disabled={busy}
          onClick={async () => {
            const saved = await onRunAction(
              () =>
                postBookingAction(`/api/foh/bookings/${booking.id}/notes`, {
                  notes: notes.trim() || null,
                  allergies: parseAllergyList(allergies),
                }),
              'Notes and allergies saved',
              'notes',
            )
            if (saved) setOpen(false)
          }}
        >
          Save Notes
        </Button>
      </div>
    </div>
  )
}

// The action grid: full-width tiles at the 44px touch floor (owner decision D6). The
// destructive two-step actions keep a red outline so they read differently from the rest,
// and turn solid pale red while their confirm step is open.
const ACTION_BUTTON_CLASS = 'min-h-touch w-full'
const DANGER_OUTLINE_CLASS = 'border-danger-border text-danger-fg hover:bg-danger-soft'
const DANGER_OUTLINE_SELECTED_CLASS = 'border-danger bg-danger-soft'

// The one large button for the booking's state. Deliberately bigger than everything else in the
// panel: on a busy bar it is the tap staff make a hundred times a shift.
const PRIMARY_ACTION_CLASS = 'min-h-14 w-full text-base font-semibold'

// Inner component for the action buttons section
function BookingActions(props: {
  selectedBooking: FohBooking
  canChooseRefund: boolean
  selectedBookingIsOutside: boolean
  bookingActionInFlight: string | null
  showCancelBookingConfirmation: boolean
  now?: Date
  selectedBookingCanBeCancelled: boolean
  selectedMoveTarget: string
  selectedMoveOptions: FohMoveTableOption[]
  loadingSelectedMoveOptions: boolean
  currentTableName: string | null
  onClose: () => void
  onRunAction: FohRunAction
  onMoveTargetChange: (bookingId: string, tableId: string) => void
  onSetShowCancelBookingConfirmation: (value: boolean) => void
  onOpenPartySizeEdit: (bookingId: string, currentSize: number) => void
  onOpenWalkoutModal: (bookingId: string) => void
  onOpenChangeTime: (bookingId: string) => void
  timeChangeBlocker: string | null
}) {
  const {
    selectedBooking,
    canChooseRefund,
    selectedBookingIsOutside,
    bookingActionInFlight,
    showCancelBookingConfirmation,
    now,
    selectedBookingCanBeCancelled,
    selectedMoveTarget,
    selectedMoveOptions,
    loadingSelectedMoveOptions,
    currentTableName,
    onClose,
    onRunAction,
    onMoveTargetChange,
    onSetShowCancelBookingConfirmation,
    onOpenPartySizeEdit,
    onOpenWalkoutModal,
    onOpenChangeTime,
    timeChangeBlocker,
  } = props

  const busy = Boolean(bookingActionInFlight)
  const actions = getFohPanelActions(selectedBooking, now ?? new Date())
  const guestLabel = selectedBooking.guest_name || selectedBooking.booking_reference || 'Booking'
  const bookingPath = `/api/foh/bookings/${selectedBooking.id}`
  const status = (selectedBooking.status || '').toLowerCase()
  const isOpen = !['cancelled', 'completed', 'no_show'].includes(status)

  // Why a button is missing, as words on the screen. A tooltip does not exist on an iPad.
  const reasons = [...actions.notes]
  if (isOpen && timeChangeBlocker && !reasons.some((reason) => reason.includes('event'))) {
    reasons.push(`The time cannot be changed here. ${timeChangeBlocker}`)
  }

  // One tap, then a 10 second Undo on the screen behind. No confirm box.
  const tap = (path: string, saved: string, inFlight: string, undoLabel?: string, body?: Record<string, unknown>) => {
    void (async () => {
      const ok = await onRunAction(() => postBookingAction(path, body), saved, inFlight, undoLabel ? { undoLabel } : undefined)
      if (ok) onClose()
    })()
  }

  return (
    <div className="space-y-3">
      {actions.primary === 'seated' && (
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={busy}
          onClick={() => tap(`${bookingPath}/seated`, 'Marked as seated', 'seated', `${guestLabel} marked as seated`)}
          className={PRIMARY_ACTION_CLASS}
        >
          {bookingActionInFlight === 'seated' ? 'Marking...' : 'Seated'}
        </Button>
      )}
      {actions.primary === 'left' && (
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={busy}
          onClick={() => tap(`${bookingPath}/left`, 'Marked as left', 'left', `${guestLabel} marked as left`)}
          className={PRIMARY_ACTION_CLASS}
        >
          {bookingActionInFlight === 'left' ? 'Marking...' : 'Left'}
        </Button>
      )}
      {actions.primary === 'undo_no_show' && (
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={busy}
          onClick={() =>
            tap(`${bookingPath}/undo`, 'No-show undone. The booking is back as booked', 'undo_no_show', undefined, {
              action: 'no_show',
              ...(selectedBooking.no_show_at ? { stamp: selectedBooking.no_show_at } : {}),
            })
          }
          className={PRIMARY_ACTION_CLASS}
        >
          {bookingActionInFlight === 'undo_no_show' ? 'Putting back...' : 'Undo no-show'}
        </Button>
      )}
      {actions.canReseat && (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={() => tap(`${bookingPath}/seated`, 'Back at the table', 'seated')}
          className="min-h-touch w-full"
        >
          {bookingActionInFlight === 'seated' ? 'Marking...' : 'Back at the table'}
        </Button>
      )}

      {isOpen && (
        <div className="grid grid-cols-2 gap-2">
          {actions.canNoShow && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => tap(`${bookingPath}/no-show`, 'No-show recorded', 'no_show', `${guestLabel} marked as a no-show`)}
              className={cn(ACTION_BUTTON_CLASS, DANGER_OUTLINE_CLASS)}
            >
              {bookingActionInFlight === 'no_show' ? 'Saving...' : 'No-show'}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
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
          {!timeChangeBlocker && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onOpenChangeTime(selectedBooking.id)}
              className={ACTION_BUTTON_CLASS}
            >
              {bookingActionInFlight === 'change_time' ? 'Changing...' : 'Change time'}
            </Button>
          )}
          {selectedBookingCanBeCancelled && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onSetShowCancelBookingConfirmation(!showCancelBookingConfirmation)}
              className={cn(ACTION_BUTTON_CLASS, DANGER_OUTLINE_CLASS, showCancelBookingConfirmation && DANGER_OUTLINE_SELECTED_CLASS)}
            >
              {showCancelBookingConfirmation ? 'Cancel selected' : 'Cancel booking'}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              onOpenWalkoutModal(selectedBooking.id)
            }}
            className={cn(ACTION_BUTTON_CLASS, DANGER_OUTLINE_CLASS)}
          >
            {bookingActionInFlight === 'walkout' ? 'Saving...' : 'Flag walkout'}
          </Button>
        </div>
      )}

      {reasons.length > 0 && (
        <ul className="space-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {showCancelBookingConfirmation && selectedBookingCanBeCancelled && (
        <FohCancelBookingConfirm
          key={selectedBooking.id}
          booking={selectedBooking}
          canChooseRefund={canChooseRefund}
          busy={Boolean(bookingActionInFlight)}
          cancelling={bookingActionInFlight === 'cancel'}
          onKeep={() => onSetShowCancelBookingConfirmation(false)}
          onConfirm={(choice) => {
            void (async () => {
              const ok = await onRunAction(
                () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/cancel`, staffCancellationBody(choice)),
                'Booking cancelled',
                'cancel'
              )
              if (ok) onClose()
            })()
          }}
        />
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
      {!isOpen ? null : selectedBookingIsOutside ? (
        <p className="text-sm text-text-muted">Outside booking, so there is no table to move.</p>
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
