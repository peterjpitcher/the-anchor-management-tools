'use client'

import React, { FormEvent, useEffect } from 'react'
import { Alert, Button, Input, Modal, Select, Textarea } from '@/ds'
import { cn } from '@/lib/utils'
import {
  computeDepositAmount,
  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
  LARGE_GROUP_DEPOSIT_THRESHOLD,
} from '@/lib/table-bookings/deposit'
import {
  CHRISTMAS_MAX_PARTY_SIZE,
  CHRISTMAS_MIN_NOTICE_HOURS,
  CHRISTMAS_MIN_PARTY_SIZE,
} from '@/lib/table-bookings/christmas'
import type {
  FohCreateMode,
  FohCustomerSearchResult,
  FohEventOption,
  WalkInTargetTable,
} from '../types'
import type { FohBookingPeriod } from '../hooks/useFohCreateBooking'
import {
  formatEventBookingMode,
  formatEventOptionDateTime,
  formatEventPaymentMode,
  formatGbp,
  getLondonDateIso,
} from '../utils'

export type CreateForm = {
  booking_date: string
  event_id: string
  phone: string
  email: string
  customer_name: string
  first_name: string
  last_name: string
  time: string
  party_size: string
  purpose: 'food' | 'drinks' | 'event' | 'christmas'
  seating_preference: 'seated' | 'standing'
  sunday_deposit_method: 'payment_link' | 'cash'
  notes: string
  waive_deposit: boolean
  is_venue_event: boolean
  bypass_pacing: boolean
}

type FohCreateBookingModalProps = {
  open: boolean
  createMode: FohCreateMode
  createForm: CreateForm
  canWaiveDeposit: boolean
  canEdit?: boolean
  walkInTargetTable: WalkInTargetTable | null
  submittingBooking: boolean
  // Customer search
  customerQuery: string
  completedCustomerSearchQuery: string
  customerResults: FohCustomerSearchResult[]
  selectedCustomer: FohCustomerSearchResult | null
  searchingCustomers: boolean
  // Events
  eventOptions: FohEventOption[]
  loadingEventOptions: boolean
  eventOptionsError: string | null
  selectedEventOption: FohEventOption | null
  overlappingEventForTable: FohEventOption | null
  tableEventPromptAcknowledgedEventId: string | null
  walkInPurposeAutoSelectionEnabled: boolean
  // Deposit
  formRequiresDeposit: boolean
  /** Non-Christmas seasonal period covering the chosen date, if any. */
  seasonalPeriod: FohBookingPeriod | null
  seasonalAnswer: boolean | null
  onSetSeasonalAnswer: (accepted: boolean) => void
  // Messages
  errorMessage: string | null
  // Callbacks
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSetCreateForm: (updater: (current: CreateForm) => CreateForm) => void
  onSetCustomerQuery: (query: string) => void
  onSelectCustomer: (customer: FohCustomerSearchResult) => void
  onClearCustomer: () => void
  onSetTableEventPromptAcknowledgedEventId: (id: string | null) => void
  onSetWalkInPurposeAutoSelectionEnabled: (enabled: boolean) => void
  onSetErrorMessage: (msg: string | null) => void
}

// Owner decision D6: this modal is used on the bar iPad, and Headless UI portals it outside the
// screen's data-touch-targets wrapper, so every control sets the 44px floor itself.
const FIELD_CLASS = 'min-h-touch'
const RADIO_LABEL_CLASS = 'flex min-h-touch items-center gap-2 text-xs text-text'
// The label fills the row, so the whole 44px strip ticks the box, not just the 16px box.
const CHECKBOX_ROW_CLASS = 'flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3'
const CHECKBOX_LABEL_CLASS = 'flex min-h-touch flex-1 cursor-pointer items-center text-xs font-medium text-text'

function isPhoneLikeCustomerQuery(value: string): boolean {
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')

  return digits.length >= 7 && /^[+\d\s().-]+$/.test(trimmed)
}

export const FohCreateBookingModal = React.memo(function FohCreateBookingModal(props: FohCreateBookingModalProps) {
  const {
    open,
    createMode,
    createForm,
    canWaiveDeposit,
    canEdit = false,
    walkInTargetTable,
    submittingBooking,
    customerQuery,
    completedCustomerSearchQuery,
    customerResults,
    selectedCustomer,
    searchingCustomers,
    eventOptions,
    loadingEventOptions,
    eventOptionsError,
    selectedEventOption,
    overlappingEventForTable,
    tableEventPromptAcknowledgedEventId,
    walkInPurposeAutoSelectionEnabled,
    formRequiresDeposit,
    seasonalPeriod,
    seasonalAnswer,
    onSetSeasonalAnswer,
    errorMessage,
    onClose,
    onSubmit,
    onSetCreateForm,
    onSetCustomerQuery,
    onSelectCustomer,
    onClearCustomer,
    onSetTableEventPromptAcknowledgedEventId,
    onSetWalkInPurposeAutoSelectionEnabled,
    onSetErrorMessage,
  } = props

  const partySizeNumber = Number.parseInt(createForm.party_size, 10)
  const formDepositAmount = formRequiresDeposit
    ? computeDepositAmount(Number.isFinite(partySizeNumber) ? partySizeNumber : 0, {
        depositWaived: createForm.waive_deposit === true,
        // Christmas takes a deposit at any party size, so a party of 6 shows £60.
        isChristmas: createForm.purpose === 'christmas',
      })
    : 0
  const selectedCustomerNeedsPhone = Boolean(
    selectedCustomer && !selectedCustomer.mobile_e164 && !selectedCustomer.mobile_number
  )

  useEffect(() => {
    const completedQuery = completedCustomerSearchQuery.trim()
    if (!open || !completedQuery) return
    if (selectedCustomer || searchingCustomers || customerResults.length > 0) return
    if (completedQuery !== customerQuery.trim()) return
    if (!isPhoneLikeCustomerQuery(completedQuery)) return

    onSetCreateForm((current) => {
      if (current.phone.trim()) return current
      return { ...current, phone: completedQuery }
    })
  }, [
    completedCustomerSearchQuery,
    customerQuery,
    customerResults.length,
    onSetCreateForm,
    open,
    searchingCustomers,
    selectedCustomer,
  ])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={createMode === 'walk_in' ? 'Add walk-in' : 'Add booking'}
      description="Search existing customer by name or phone first. If not found, enter phone details to create a new customer."
      size="lg"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <Input
            label="Find existing customer"
            type="text"
            value={customerQuery}
            onChange={(event) => {
              onSetCustomerQuery(event.target.value)
              if (selectedCustomer) {
                onClearCustomer()
              }
            }}
            placeholder="Search by name or phone"
            className={FIELD_CLASS}
          />

          <p className="mt-2 text-xs text-text-muted">
            Accepts international +... numbers; local numbers default to +44.
          </p>

          {searchingCustomers && <p className="mt-2 text-xs text-text-muted">Searching customers...</p>}

          {!selectedCustomer && !searchingCustomers && customerQuery.trim().length >= 2 && customerResults.length === 0 && (
            <div className="mt-2 px-4 py-2 text-sm text-text-muted">No customers found</div>
          )}

          {!selectedCustomer && customerResults.length > 0 && (
            <div className="mt-2 max-h-56 overflow-auto rounded-md border border-border bg-surface">
              {customerResults.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => onSelectCustomer(customer)}
                  className="flex min-h-touch w-full items-start justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm hover:bg-surface-hover last:border-b-0 focus-visible:outline-hidden focus-visible:shadow-ring-inset"
                >
                  <span className="font-medium text-text">{customer.full_name}</span>
                  <span className="text-xs text-text-muted">{customer.display_phone || 'No phone'}</span>
                </button>
              ))}
            </div>
          )}

          {selectedCustomer && (
            <div className="mt-2 rounded-md border border-success-border bg-success-soft px-3 py-2 text-sm text-success-fg">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">Using customer: {selectedCustomer.full_name}</p>
                  <p className="text-xs text-success-fg">{selectedCustomer.display_phone || 'No stored phone'}</p>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={onClearCustomer} className="min-h-touch">
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Booking date"
            type="date"
            required
            min={createMode === 'walk_in' ? getLondonDateIso() : undefined}
            max={createMode === 'walk_in' ? getLondonDateIso() : undefined}
            value={createForm.booking_date}
            onChange={(event) => onSetCreateForm((current) => ({ ...current, booking_date: event.target.value }))}
            className={FIELD_CLASS}
          />

          {createForm.purpose !== 'event' && (
            <Input
              label="Time"
              type="time"
              required
              value={createForm.time}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, time: event.target.value }))}
              className={FIELD_CLASS}
            />
          )}

          <Input
            label={createForm.purpose === 'event' ? 'Seats' : 'Party size'}
            type="number"
            min={1}
            max={20}
            required
            value={createForm.party_size}
            onChange={(event) => onSetCreateForm((current) => ({ ...current, party_size: event.target.value }))}
            className={FIELD_CLASS}
          />

          {!selectedCustomer && createMode !== 'walk_in' && (
            <Input
              label="First name"
              type="text"
              required={createMode !== 'management'}
              value={createForm.first_name}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, first_name: event.target.value }))}
              className={FIELD_CLASS}
            />
          )}

          {!selectedCustomer && createMode !== 'walk_in' && (
            <Input
              label="Last name (optional)"
              type="text"
              value={createForm.last_name}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, last_name: event.target.value }))}
              className={FIELD_CLASS}
            />
          )}

          {(!selectedCustomer || selectedCustomerNeedsPhone) && (
            <Input
              label={selectedCustomerNeedsPhone ? 'Phone for selected customer' : 'Phone'}
              type="tel"
              required={selectedCustomerNeedsPhone || (createMode !== 'walk_in' && createMode !== 'management')}
              value={createForm.phone}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="+1 415 555 2671 or local format"
              className={FIELD_CLASS}
            />
          )}

          {(!selectedCustomer || selectedCustomerNeedsPhone) && (
            <Input
              label="Email (optional)"
              type="email"
              value={createForm.email}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="name@example.com"
              className={FIELD_CLASS}
            />
          )}

          <div>
            <Select
              label="Purpose"
              value={createForm.purpose}
              onChange={(event) => {
                const nextPurpose = event.target.value as 'food' | 'drinks' | 'event' | 'christmas'
                onSetTableEventPromptAcknowledgedEventId(null)
                if (createMode === 'walk_in') {
                  onSetWalkInPurposeAutoSelectionEnabled(false)
                }
                onSetCreateForm((current) => ({
                  ...current,
                  purpose: nextPurpose,
                  sunday_deposit_method: nextPurpose === 'event' ? 'payment_link' : current.sunday_deposit_method,
                  seating_preference: 'seated',
                  event_id:
                    nextPurpose === 'event'
                      ? current.event_id || eventOptions.find((item) => !item.is_full)?.id || eventOptions[0]?.id || ''
                      : ''
                }))
              }}
              className={FIELD_CLASS}
            >
              <option value="food">Food</option>
              <option value="drinks">Drinks</option>
              <option value="christmas">Christmas</option>
              {eventOptions.length > 0 && <option value="event">Event</option>}
            </Select>
            {createForm.purpose === 'christmas' && (
              <p className="mt-1 text-xs text-text-muted">
                Christmas bookings need {CHRISTMAS_MIN_PARTY_SIZE} guests or more,
                at least {CHRISTMAS_MIN_NOTICE_HOURS} hours notice, and always take a
                deposit of {formatGbp(LARGE_GROUP_DEPOSIT_PER_PERSON_GBP)} per person.
                Over {CHRISTMAS_MAX_PARTY_SIZE} guests is private hire. Booked after noon
                7 days before the date, it&apos;s the 1 course menu for everyone, with no pre-order.
              </p>
            )}
          </div>

          {createForm.purpose === 'event' && (
            <>
              <div className="md:col-span-2">
                <Select
                  label="Event"
                  required
                  value={createForm.event_id}
                  onChange={(event) => {
                    if (createMode === 'walk_in') {
                      onSetWalkInPurposeAutoSelectionEnabled(false)
                    }
                    onSetCreateForm((current) => ({ ...current, event_id: event.target.value, seating_preference: 'seated' }))
                  }}
                  className={FIELD_CLASS}
                >
                  <option value="">
                    {loadingEventOptions ? 'Loading events...' : eventOptions.length === 0 ? 'No events found' : 'Select an event'}
                  </option>
                  {eventOptions.map((eventOption) => (
                    <option
                      key={eventOption.id}
                      value={eventOption.id}
                      disabled={eventOption.is_full}
                    >
                      {eventOption.name} · {formatEventOptionDateTime(eventOption)} · {formatEventBookingMode(eventOption.booking_mode)} · {eventOption.is_full ? 'Full' : `${eventOption.total_remaining ?? eventOption.seats_remaining ?? '-'} left`}
                    </option>
                  ))}
                </Select>
              </div>

              {selectedEventOption && (
                <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text md:col-span-2">
                  <p className="font-medium text-text">{selectedEventOption.name}</p>
                  <p className="mt-1">
                    {formatEventOptionDateTime(selectedEventOption)} · {formatEventPaymentMode(selectedEventOption.payment_mode)}
                    {selectedEventOption.price_per_seat != null ? ` · ${formatGbp(selectedEventOption.price_per_seat)} per seat` : ''}
                    {selectedEventOption.booking_mode ? ` · ${formatEventBookingMode(selectedEventOption.booking_mode)}` : ''}
                  </p>
                  <p className="mt-1">
                    {selectedEventOption.is_full
                      ? 'This event is currently full.'
                      : selectedEventOption.booking_mode === 'communal'
                        ? `${selectedEventOption.seated_remaining ?? '-'} seated · ${selectedEventOption.standing_remaining ?? '-'} standing · ${selectedEventOption.total_remaining ?? selectedEventOption.seats_remaining ?? '-'} total`
                        : `${selectedEventOption.seats_remaining ?? '-'} seats remaining`}
                  </p>
                </div>
              )}

              {selectedEventOption?.booking_mode === 'communal' && (
                <div className="rounded-md border border-border bg-surface px-3 py-2 md:col-span-2">
                  <p className="text-xs font-medium text-text">Ticket type</p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <label className={RADIO_LABEL_CLASS}>
                      <input
                        type="radio"
                        name="foh-event-seating-preference"
                        value="seated"
                        checked={createForm.seating_preference === 'seated'}
                        onChange={() => onSetCreateForm((current) => ({ ...current, seating_preference: 'seated' }))}
                        disabled={(selectedEventOption.seated_remaining ?? 0) <= 0}
                      />
                      <span>Seated</span>
                    </label>
                    <label className={RADIO_LABEL_CLASS}>
                      <input
                        type="radio"
                        name="foh-event-seating-preference"
                        value="standing"
                        checked={createForm.seating_preference === 'standing'}
                        onChange={() => onSetCreateForm((current) => ({ ...current, seating_preference: 'standing' }))}
                        disabled={(selectedEventOption.standing_remaining ?? 0) <= 0}
                      />
                      <span>Standing</span>
                    </label>
                  </div>
                </div>
              )}

              {eventOptionsError && (
                <p className="text-xs text-danger md:col-span-2">{eventOptionsError}</p>
              )}
            </>
          )}

          {!selectedCustomer && createMode === 'walk_in' && (
            <Input
              label="Guest name"
              type="text"
              value={createForm.customer_name}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, customer_name: event.target.value }))}
              placeholder="Jane Smith"
              className={FIELD_CLASS}
            />
          )}

          {createMode !== 'walk_in' && createMode !== 'management' && createForm.purpose !== 'event' && (
            <div className="space-y-2 md:col-span-2">
              <div className={CHECKBOX_ROW_CLASS}>
                <input
                  id="is-venue-event"
                  type="checkbox"
                  checked={createForm.is_venue_event}
                  onChange={(e) =>
                    onSetCreateForm((prev) => ({
                      ...prev,
                      is_venue_event: e.target.checked,
                      waive_deposit: e.target.checked ? false : prev.waive_deposit
                    }))
                  }
                  className="h-4 w-4"
                />
                <label htmlFor="is-venue-event" className={CHECKBOX_LABEL_CLASS}>
                  Pub Event (remove deposit for {LARGE_GROUP_DEPOSIT_THRESHOLD}+ group)
                </label>
              </div>

              {/* The seasonal question, for periods that are not Christmas.
                  Christmas travels as a purpose and already works; asking twice
                  would give staff two controls for one decision. */}
              {seasonalPeriod && (
                <div className="rounded-md border border-warning-border bg-warning-soft p-3">
                  <p className="text-xs font-semibold text-text">{seasonalPeriod.name}</p>
                  {seasonalPeriod.bookable ? (
                    <>
                      <p className="mt-1 text-xs text-text">{seasonalPeriod.guest_question}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={seasonalAnswer === true ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => onSetSeasonalAnswer(true)}
                          aria-pressed={seasonalAnswer === true}
                          className="min-h-touch flex-1"
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          variant={seasonalAnswer === false ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => onSetSeasonalAnswer(false)}
                          aria-pressed={seasonalAnswer === false}
                          className="min-h-touch flex-1"
                        >
                          No
                        </Button>
                      </div>
                      {seasonalAnswer === null && (
                        <p className="mt-2 text-xs text-text-muted">
                          Please answer before creating the booking.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-text">
                      {seasonalPeriod.not_bookable_message ||
                        'This period cannot be booked yet.'}
                    </p>
                  )}
                </div>
              )}

              {formRequiresDeposit && canWaiveDeposit && (
                <div className={CHECKBOX_ROW_CLASS}>
                  <input
                    id="waive-deposit"
                    type="checkbox"
                    checked={createForm.waive_deposit}
                    onChange={(e) =>
                      onSetCreateForm((prev) => ({
                        ...prev,
                        waive_deposit: e.target.checked
                      }))
                    }
                    className="h-4 w-4"
                  />
                  <label htmlFor="waive-deposit" className={CHECKBOX_LABEL_CLASS}>
                    Waive deposit for this booking
                  </label>
                </div>
              )}

              {formRequiresDeposit && !createForm.waive_deposit && (
                <div className="rounded-md border border-border bg-surface-2 p-3">
                  <p className="text-xs font-medium text-text">Table deposit</p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <label className={RADIO_LABEL_CLASS}>
                      <input
                        type="radio"
                        name="foh-sunday-deposit-method"
                        value="payment_link"
                        checked={createForm.sunday_deposit_method === 'payment_link'}
                        onChange={() =>
                          onSetCreateForm((current) => ({ ...current, sunday_deposit_method: 'payment_link' }))
                        }
                      />
                      <span>Send payment link by text</span>
                    </label>
                    <label className={RADIO_LABEL_CLASS}>
                      <input
                        type="radio"
                        name="foh-sunday-deposit-method"
                        value="cash"
                        checked={createForm.sunday_deposit_method === 'cash'}
                        onChange={() =>
                          onSetCreateForm((current) => ({ ...current, sunday_deposit_method: 'cash' }))
                        }
                      />
                      <span>Cash taken and put in till</span>
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-text-muted">
                    Deposit amount: {formatGbp(formDepositAmount)} ({formatGbp(LARGE_GROUP_DEPOSIT_PER_PERSON_GBP)} per person).
                  </p>
                </div>
              )}

            </div>
          )}

          {canEdit && createMode === 'booking' && createForm.purpose !== 'event' && (
            <div className="md:col-span-2">
              <div className={CHECKBOX_ROW_CLASS}>
                <input
                  id="bypass-kitchen-pacing"
                  type="checkbox"
                  checked={createForm.bypass_pacing}
                  onChange={(e) =>
                    onSetCreateForm((prev) => ({
                      ...prev,
                      bypass_pacing: e.target.checked
                    }))
                  }
                  className="h-4 w-4"
                />
                <label htmlFor="bypass-kitchen-pacing" className={CHECKBOX_LABEL_CLASS}>
                  Override kitchen pacing (this window is at capacity)
                </label>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Only tick this to force a booking into a 30-minute window the kitchen has already filled.
              </p>
            </div>
          )}
        </div>

        {createMode === 'walk_in' && walkInTargetTable && (
          <div className="rounded-md border border-success-border bg-success-soft px-3 py-2 text-xs text-success-fg">
            Walk-in will be moved to <span className="font-semibold">{walkInTargetTable.name}</span> after creation.
          </div>
        )}

        {eventOptions.length > 0 && createForm.purpose !== 'event' && (
          <div className="flex flex-wrap items-center gap-x-1 rounded-md border border-info-border bg-info-soft px-3 text-xs text-info-fg">
            Booking for an upcoming event?
            <button
              type="button"
              onClick={() => {
                onSetCreateForm((current) => ({
                  ...current,
                  purpose: 'event',
                  sunday_deposit_method: 'payment_link',
                  seating_preference: 'seated',
                  event_id: eventOptions.find((item) => !item.is_full)?.id || eventOptions[0]?.id || ''
                }))
                onSetTableEventPromptAcknowledgedEventId(null)
              }}
              className="inline-flex min-h-touch items-center rounded-sm font-semibold underline hover:no-underline focus-visible:outline-hidden focus-visible:shadow-ring"
            >
              Select event
            </button>
          </div>
        )}

        {createForm.purpose !== 'event' && (
          <Textarea
            label="Notes (optional)"
            value={createForm.notes}
            onChange={(event) => onSetCreateForm((current) => ({ ...current, notes: event.target.value }))}
            rows={2}
            maxLength={500}
          />
        )}

        {createMode !== 'walk_in' && createForm.purpose !== 'event' && overlappingEventForTable && tableEventPromptAcknowledgedEventId !== overlappingEventForTable.id && (
          <div className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning-fg">
            <p className="font-semibold">Confirm: this booking overlaps {overlappingEventForTable.name}.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  onSetCreateForm((current) => ({
                    ...current,
                    purpose: 'event',
                    event_id: overlappingEventForTable.id,
                    seating_preference: 'seated'
                  }))
                  onSetTableEventPromptAcknowledgedEventId(null)
                  onSetErrorMessage(null)
                }}
                className="min-h-touch"
              >
                Yes, book for event
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onSetTableEventPromptAcknowledgedEventId(overlappingEventForTable.id)
                  onSetErrorMessage(null)
                }}
                className="min-h-touch"
              >
                No, keep table booking
              </Button>
            </div>
          </div>
        )}

        {errorMessage && open && (
          <Alert tone="danger" size="sm">
            {errorMessage}
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-text-muted">
            {createMode === 'walk_in'
              ? 'Walk-ins require covers. Guest name and phone are optional.'
              : createForm.purpose === 'christmas'
              ? `Christmas bookings always require a ${formatGbp(LARGE_GROUP_DEPOSIT_PER_PERSON_GBP)} per person deposit, whatever the party size.`
              : createForm.purpose !== 'event'
              ? `Bookings of ${LARGE_GROUP_DEPOSIT_THRESHOLD} or more people require a ${formatGbp(LARGE_GROUP_DEPOSIT_PER_PERSON_GBP)} per person deposit.`
              : 'Event booking status depends on event payment mode and capacity.'}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="lg" onClick={onClose} className="min-h-touch">
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={submittingBooking} className="min-h-touch">
              {submittingBooking ? 'Creating...' : createMode === 'walk_in' ? 'Create walk-in' : 'Create booking'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
})
