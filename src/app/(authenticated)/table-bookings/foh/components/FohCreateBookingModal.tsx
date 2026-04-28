'use client'

import React, { FormEvent } from 'react'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { cn } from '@/lib/utils'
import type {
  FohCreateMode,
  FohCustomerSearchResult,
  FohEventOption,
  SundayMenuItem,
  WalkInTargetTable,
} from '../types'
import {
  formatEventBookingMode,
  formatEventOptionDateTime,
  formatEventPaymentMode,
  formatGbp,
  isSundayDate,
} from '../utils'

export type CreateForm = {
  booking_date: string
  event_id: string
  phone: string
  customer_name: string
  first_name: string
  last_name: string
  time: string
  party_size: string
  purpose: 'food' | 'drinks' | 'event'
  sunday_lunch: boolean
  sunday_deposit_method: 'payment_link' | 'cash'
  sunday_preorder_mode: 'send_link' | 'capture_now'
  notes: string
  waive_deposit: boolean
  is_venue_event: boolean
}

type FohCreateBookingModalProps = {
  open: boolean
  createMode: FohCreateMode
  createForm: CreateForm
  canWaiveDeposit: boolean
  walkInTargetTable: WalkInTargetTable | null
  submittingBooking: boolean
  // Customer search
  customerQuery: string
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
  // Sunday
  sundayMenuItems: SundayMenuItem[]
  loadingSundayMenu: boolean
  sundayMenuError: string | null
  sundayPreorderQuantities: Record<string, string>
  sundayMenuByCategory: Record<string, SundayMenuItem[]>
  sundaySelectedItemCount: number
  // Deposit
  formRequiresDeposit: boolean
  // Messages
  errorMessage: string | null
  // Callbacks
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSetCreateForm: (updater: (current: CreateForm) => CreateForm) => void
  onSetCustomerQuery: (query: string) => void
  onSelectCustomer: (customer: FohCustomerSearchResult) => void
  onClearCustomer: () => void
  onSetSundayPreorderQuantities: (updater: (current: Record<string, string>) => Record<string, string>) => void
  onSetTableEventPromptAcknowledgedEventId: (id: string | null) => void
  onSetWalkInPurposeAutoSelectionEnabled: (enabled: boolean) => void
  onRetrySundayMenu: () => void
  onSetErrorMessage: (msg: string | null) => void
}

export const FohCreateBookingModal = React.memo(function FohCreateBookingModal(props: FohCreateBookingModalProps) {
  const {
    open,
    createMode,
    createForm,
    canWaiveDeposit,
    walkInTargetTable,
    submittingBooking,
    customerQuery,
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
    sundayMenuItems,
    loadingSundayMenu,
    sundayMenuError,
    sundayPreorderQuantities,
    sundayMenuByCategory,
    sundaySelectedItemCount,
    formRequiresDeposit,
    errorMessage,
    onClose,
    onSubmit,
    onSetCreateForm,
    onSetCustomerQuery,
    onSelectCustomer,
    onClearCustomer,
    onSetSundayPreorderQuantities,
    onSetTableEventPromptAcknowledgedEventId,
    onSetWalkInPurposeAutoSelectionEnabled,
    onRetrySundayMenu,
    onSetErrorMessage,
  } = props

  const sundaySelected = isSundayDate(createForm.booking_date)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={createMode === 'walk_in' ? 'Add walk-in' : 'Add booking'}
      description="Search existing customer by name or phone first. If not found, enter phone details to create a new customer."
      size="lg"
    >
      <form onSubmit={onSubmit} className="space-y-4">

        {/* Customer search section */}
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <label className="block text-xs font-medium text-gray-700">
            Find existing customer
            <input
              type="text"
              value={customerQuery}
              onChange={(event) => {
                onSetCustomerQuery(event.target.value)
                if (selectedCustomer) {
                  onClearCustomer()
                }
              }}
              placeholder="Search by name or phone"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <p className="mt-2 text-xs text-gray-500">
            Accepts international +... numbers; local numbers default to +44.
          </p>

          {searchingCustomers && <p className="mt-2 text-xs text-gray-500">Searching customers...</p>}

          {!selectedCustomer && !searchingCustomers && customerQuery.trim().length >= 2 && customerResults.length === 0 && (
            <div className="mt-2 px-4 py-2 text-sm text-gray-500">No customers found</div>
          )}

          {!selectedCustomer && customerResults.length > 0 && (
            <div className="mt-2 max-h-56 overflow-auto rounded-md border border-gray-200 bg-white">
              {customerResults.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => onSelectCustomer(customer)}
                  className="flex w-full items-start justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 last:border-b-0"
                >
                  <span className="font-medium text-gray-900">{customer.full_name}</span>
                  <span className="text-xs text-gray-500">{customer.display_phone || 'No phone'}</span>
                </button>
              ))}
            </div>
          )}

          {selectedCustomer && (
            <div className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">Using customer: {selectedCustomer.full_name}</p>
                  <p className="text-xs text-green-700">{selectedCustomer.display_phone || 'No stored phone'}</p>
                </div>
                <button
                  type="button"
                  onClick={onClearCustomer}
                  className="rounded border border-green-300 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-100"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        {createMode === 'walk_in' && walkInTargetTable && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
            Walk-in will be moved to <span className="font-semibold">{walkInTargetTable.name}</span> after creation.
          </div>
        )}

        {eventOptions.length > 0 && createForm.purpose !== 'event' && (
          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Booking for an upcoming event?{' '}
            <button
              type="button"
              onClick={() => {
                onSetCreateForm((current) => ({
                  ...current,
                  purpose: 'event',
                  sunday_lunch: false,
                  sunday_deposit_method: 'payment_link',
                  event_id: eventOptions.find((item) => !item.is_full)?.id || eventOptions[0]?.id || ''
                }))
                onSetTableEventPromptAcknowledgedEventId(null)
              }}
              className="font-semibold underline hover:text-blue-900"
            >
              Select event
            </button>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-gray-700">
            Booking date
            <input
              type="date"
              required
              value={createForm.booking_date}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, booking_date: event.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          {createForm.purpose !== 'event' && (
            <label className="text-xs font-medium text-gray-700">
              Time
              <input
                type="time"
                required
                value={createForm.time}
                onChange={(event) => onSetCreateForm((current) => ({ ...current, time: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          {!selectedCustomer && (
            <label className="text-xs font-medium text-gray-700">
              Phone
              <input
                type="tel"
                value={createForm.phone}
                onChange={(event) => onSetCreateForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="+1 415 555 2671 or local format"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="text-xs font-medium text-gray-700">
            {createForm.purpose === 'event' ? 'Seats' : 'Party size'}
            <input
              type="number"
              min={1}
              max={20}
              required
              value={createForm.party_size}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, party_size: event.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-gray-700">
            Purpose
            <select
              value={createForm.purpose}
              onChange={(event) => {
                const nextPurpose = event.target.value as 'food' | 'drinks' | 'event'
                onSetTableEventPromptAcknowledgedEventId(null)
                if (createMode === 'walk_in') {
                  onSetWalkInPurposeAutoSelectionEnabled(false)
                }
                onSetCreateForm((current) => ({
                  ...current,
                  purpose: nextPurpose,
                  sunday_lunch: nextPurpose === 'event' ? false : current.sunday_lunch,
                  sunday_deposit_method: nextPurpose === 'event' ? 'payment_link' : current.sunday_deposit_method,
                  event_id:
                    nextPurpose === 'event'
                      ? current.event_id || eventOptions.find((item) => !item.is_full)?.id || eventOptions[0]?.id || ''
                      : ''
                }))
              }}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="food">Food</option>
              <option value="drinks">Drinks</option>
              {eventOptions.length > 0 && <option value="event">Event</option>}
            </select>
          </label>

          {createForm.purpose === 'event' && (
            <>
              <label className="text-xs font-medium text-gray-700 md:col-span-2">
                Event
                <select
                  required
                  value={createForm.event_id}
                  onChange={(event) => {
                    if (createMode === 'walk_in') {
                      onSetWalkInPurposeAutoSelectionEnabled(false)
                    }
                    onSetCreateForm((current) => ({ ...current, event_id: event.target.value }))
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                      {eventOption.name} · {formatEventOptionDateTime(eventOption)} · {formatEventBookingMode(eventOption.booking_mode)} · {eventOption.is_full ? 'Full' : `${eventOption.seats_remaining ?? '-'} seats left`}
                    </option>
                  ))}
                </select>
              </label>

              {selectedEventOption && (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 md:col-span-2">
                  <p className="font-medium text-gray-900">{selectedEventOption.name}</p>
                  <p className="mt-1">
                    {formatEventOptionDateTime(selectedEventOption)} · {formatEventPaymentMode(selectedEventOption.payment_mode)}
                    {selectedEventOption.price_per_seat != null ? ` · ${formatGbp(selectedEventOption.price_per_seat)} per seat` : ''}
                    {selectedEventOption.booking_mode ? ` · ${formatEventBookingMode(selectedEventOption.booking_mode)}` : ''}
                  </p>
                  <p className="mt-1">
                    {selectedEventOption.is_full
                      ? 'This event is currently full.'
                      : `${selectedEventOption.seats_remaining ?? '-'} seats remaining`}
                  </p>
                </div>
              )}

              {eventOptionsError && (
                <p className="text-xs text-red-700 md:col-span-2">{eventOptionsError}</p>
              )}
            </>
          )}

          {!selectedCustomer && (
            <label className="text-xs font-medium text-gray-700">
              Customer name (for new customer)
              <input
                type="text"
                value={createForm.customer_name}
                onChange={(event) => onSetCreateForm((current) => ({ ...current, customer_name: event.target.value }))}
                placeholder="Jane Smith"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          {!selectedCustomer && (
            <label className="text-xs font-medium text-gray-700">
              First name (optional)
              <input
                type="text"
                value={createForm.first_name}
                onChange={(event) => onSetCreateForm((current) => ({ ...current, first_name: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          {!selectedCustomer && (
            <label className="text-xs font-medium text-gray-700">
              Last name (optional)
              <input
                type="text"
                value={createForm.last_name}
                onChange={(event) => onSetCreateForm((current) => ({ ...current, last_name: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          {createMode !== 'walk_in' && createMode !== 'management' && createForm.purpose !== 'event' && (
            <div className="space-y-2 md:col-span-2">
              {/*
                Legacy Sunday-lunch toggle (Spec §8.3): kept for staff-explicit
                legacy data entry only. New public bookings never set this. The
                deposit-required decision is now driven by the centralised 10+
                rule and is independent of this toggle. Disabled by default;
                staff who genuinely need to back-fill a legacy Sunday-lunch
                booking can enable it via the input itself if required.
              */}
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={createForm.sunday_lunch}
                  onChange={(event) =>
                    onSetCreateForm((current) => ({
                      ...current,
                      sunday_lunch: event.target.checked,
                      sunday_deposit_method: event.target.checked ? current.sunday_deposit_method : 'payment_link',
                      sunday_preorder_mode: event.target.checked ? current.sunday_preorder_mode : 'send_link'
                    }))
                  }
                  disabled
                  title="Legacy admin-only — new public bookings never use this. Deposit decision is independent of this toggle."
                />
                <span>Legacy Sunday lunch (admin)</span>
              </label>

              <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
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
                  className="h-4 w-4 rounded border-gray-300 text-sidebar focus:ring-sidebar"
                />
                <label htmlFor="is-venue-event" className="cursor-pointer text-xs font-medium text-gray-700">
                  Venue event (waives deposit)
                </label>
              </div>

              {formRequiresDeposit && canWaiveDeposit && (
                <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
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
                    className="h-4 w-4 rounded border-gray-300 text-sidebar focus:ring-sidebar"
                  />
                  <label htmlFor="waive-deposit" className="cursor-pointer text-xs font-medium text-gray-700">
                    Waive deposit for this booking
                  </label>
                </div>
              )}

              {formRequiresDeposit && !createForm.waive_deposit && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-800">
                    {createForm.sunday_lunch ? 'Sunday lunch deposit' : 'Table deposit'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-xs text-gray-700">
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
                    <label className="flex items-center gap-2 text-xs text-gray-700">
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
                  <p className="mt-2 text-xs text-gray-600">Deposit amount: GBP 10 per person.</p>
                </div>
              )}

              {createForm.sunday_lunch && sundaySelected && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-800">Sunday pre-order</p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="radio"
                        name="foh-sunday-preorder-mode"
                        value="send_link"
                        checked={createForm.sunday_preorder_mode === 'send_link'}
                        onChange={() =>
                          onSetCreateForm((current) => ({ ...current, sunday_preorder_mode: 'send_link' }))
                        }
                      />
                      <span>Send link by text</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="radio"
                        name="foh-sunday-preorder-mode"
                        value="capture_now"
                        checked={createForm.sunday_preorder_mode === 'capture_now'}
                        onChange={() =>
                          onSetCreateForm((current) => ({ ...current, sunday_preorder_mode: 'capture_now' }))
                        }
                      />
                      <span>Capture now</span>
                    </label>
                  </div>

                  {createForm.sunday_preorder_mode === 'capture_now' && (
                    <div className="mt-3 space-y-3">
                      {loadingSundayMenu && (
                        <p className="text-xs text-gray-500">Loading Sunday lunch menu...</p>
                      )}

                      {sundayMenuError && (
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-red-700">{sundayMenuError}</p>
                          <button
                            type="button"
                            onClick={onRetrySundayMenu}
                            className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                          >
                            Retry
                          </button>
                        </div>
                      )}

                      {!loadingSundayMenu && !sundayMenuError && sundayMenuItems.length === 0 && (
                        <p className="text-xs text-gray-500">
                          Sunday lunch menu is not available. Choose &quot;Send link by text&quot;.
                        </p>
                      )}

                      {!loadingSundayMenu && !sundayMenuError && sundayMenuItems.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-xs text-gray-600">
                            Selected items: {sundaySelectedItemCount}
                          </p>
                          {Object.entries(sundayMenuByCategory).map(([category, items]) => (
                            <div key={category} className="rounded-md border border-gray-200 bg-white p-2.5">
                              <p className="text-xs font-semibold text-gray-900">{category}</p>
                              <div className="mt-2 space-y-2">
                                {items.map((item) => (
                                  <div key={item.menu_dish_id} className="grid grid-cols-[1fr_78px] items-center gap-2">
                                    <div>
                                      <p className="text-xs font-medium text-gray-900">{item.name}</p>
                                      <p className="text-[11px] text-gray-500">{formatGbp(item.price)}</p>
                                    </div>
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={sundayPreorderQuantities[item.menu_dish_id] || ''}
                                      onChange={(event) => {
                                        const cleaned = event.target.value.replace(/[^\d]/g, '')
                                        onSetSundayPreorderQuantities((current) => ({
                                          ...current,
                                          [item.menu_dish_id]: cleaned
                                        }))
                                      }}
                                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                                      placeholder="0"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {createForm.purpose !== 'event' && (
          <label className="block text-xs font-medium text-gray-700">
            Notes (optional)
            <textarea
              value={createForm.notes}
              onChange={(event) => onSetCreateForm((current) => ({ ...current, notes: event.target.value }))}
              rows={2}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        )}

        {createMode !== 'walk_in' && createForm.purpose !== 'event' && overlappingEventForTable && tableEventPromptAcknowledgedEventId !== overlappingEventForTable.id && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">Confirm: this booking overlaps {overlappingEventForTable.name}.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  onSetCreateForm((current) => ({
                    ...current,
                    purpose: 'event',
                    event_id: overlappingEventForTable.id,
                    sunday_lunch: false
                  }))
                  onSetTableEventPromptAcknowledgedEventId(null)
                  onSetErrorMessage(null)
                }}
                className="rounded border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                Yes, book for event
              </button>
              <button
                type="button"
                onClick={() => {
                  onSetTableEventPromptAcknowledgedEventId(overlappingEventForTable.id)
                  onSetErrorMessage(null)
                }}
                className="rounded border border-amber-300 bg-transparent px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100/60"
              >
                No, keep table booking
              </button>
            </div>
          </div>
        )}

        {errorMessage && open && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
          <p className="text-xs text-gray-500">
            {createMode === 'walk_in'
              ? 'Walk-ins require covers. Guest name and phone are optional.'
              : createForm.purpose !== 'event'
              ? 'Bookings of 10 or more people require a GBP 10 per person deposit.'
              : 'Event booking status depends on event payment mode and capacity.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingBooking}
              className="rounded-md bg-sidebar px-4 py-2 text-sm font-medium text-white hover:bg-sidebar/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submittingBooking ? 'Creating...' : createMode === 'walk_in' ? 'Create walk-in' : 'Create booking'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
})
