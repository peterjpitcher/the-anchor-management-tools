'use client'

import React, { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { EXPIRY_PRESET_DAYS } from '@/lib/vouchers/constants'
import {
  addDaysToIso,
  fetchTodayEvents,
  formatIsoDateLong,
  newIdempotencyKey,
  postVoucherAction,
  type FohCustomerRef,
  type FohEventOption,
  type FohVoucherLookupItem
} from '../lib'
import { useVoucherLookup } from './useVoucherLookup'
import { NumberSearch } from './NumberSearch'
import { VoucherCard, isActionable } from './VoucherCard'
import { CustomerAttach } from './CustomerAttach'
import { ConfirmDialog } from './ConfirmDialog'

type HandOutPanelProps = {
  canEdit: boolean
  staffId: string | null
  staffName: string | null
  todayIso: string
  onMutated: () => void
}

type ExpiryMode = '30' | '60' | '90' | 'custom' | null

type HandOutSuccess = {
  number: string
  typeTitle: string
  expiryDate: string
  contextLabel: string
}

// Hand-out context persists across refresh/sleep on the kiosk (F33).
const CONTEXT_STORAGE_KEY = 'foh-vouchers-handout-context'

type StoredContext = {
  eventId: string | null
  freeLabel: string
  expiryMode: ExpiryMode
  customExpiry: string
}

export function HandOutPanel({ canEdit, staffId, staffName, todayIso, onMutated }: HandOutPanelProps) {
  const lookup = useVoucherLookup()
  const [events, setEvents] = useState<FohEventOption[]>([])
  const [eventsLoaded, setEventsLoaded] = useState(false)
  const [eventId, setEventId] = useState<string | null>(null)
  const [freeLabel, setFreeLabel] = useState('')
  // Vouchers are normally valid one month from issue, so +30 days is preselected.
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('30')
  const [customExpiry, setCustomExpiry] = useState('')
  const [selected, setSelected] = useState<FohVoucherLookupItem | null>(null)
  const [customer, setCustomer] = useState<FohCustomerRef | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [success, setSuccess] = useState<HandOutSuccess | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchTodayEvents().then((result) => {
      if (!cancelled) {
        setEvents(result)
        setEventsLoaded(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Restore the hand-out context once events are known (an event chip is only
  // restored if that event is still offered today).
  useEffect(() => {
    if (!eventsLoaded) {
      return
    }
    try {
      const raw = window.localStorage.getItem(CONTEXT_STORAGE_KEY)
      if (!raw) {
        return
      }
      const stored = JSON.parse(raw) as StoredContext
      if (stored.eventId && events.some((event) => event.id === stored.eventId)) {
        setEventId(stored.eventId)
      }
      if (typeof stored.freeLabel === 'string') {
        setFreeLabel(stored.freeLabel)
      }
      if (stored.expiryMode === '30' || stored.expiryMode === '60' || stored.expiryMode === '90' || stored.expiryMode === 'custom') {
        setExpiryMode(stored.expiryMode)
      }
      if (typeof stored.customExpiry === 'string') {
        setCustomExpiry(stored.customExpiry)
      }
    } catch {
      // Ignore a corrupt stored context; staff just set it again.
    }
  }, [eventsLoaded, events])

  useEffect(() => {
    try {
      const context: StoredContext = { eventId, freeLabel, expiryMode, customExpiry }
      window.localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(context))
    } catch {
      // Storage full or unavailable; the context simply will not persist.
    }
  }, [eventId, freeLabel, expiryMode, customExpiry])

  const expiryDate =
    expiryMode === 'custom'
      ? customExpiry || null
      : expiryMode
        ? addDaysToIso(todayIso, Number.parseInt(expiryMode, 10))
        : null
  const expiryValid = Boolean(expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) && expiryDate >= todayIso)

  const selectedEvent = eventId ? events.find((event) => event.id === eventId) ?? null : null
  const contextLabel = selectedEvent ? selectedEvent.name : freeLabel.trim()
  const contextValid = Boolean(selectedEvent || freeLabel.trim())

  function selectVoucher(item: FohVoucherLookupItem) {
    setSelected(item)
    setCustomer(null)
    setOutcome(null)
  }

  async function handleSearch(overrideQuery?: string) {
    setSelected(null)
    setSuccess(null)
    setOutcome(null)
    const items = await lookup.search(overrideQuery)
    if (items && items.length === 1) {
      selectVoucher(items[0])
    }
  }

  async function refreshSelected(voucherNumber: string, note?: string) {
    const items = await lookup.search(voucherNumber)
    const match = items?.find((item) => item.number === voucherNumber) ?? null
    if (match) {
      setSelected(match)
    }
    if (note) {
      setOutcome(note)
    }
  }

  async function confirmIssue() {
    if (!selected || !staffId || !expiryDate || submitting) {
      return
    }
    setSubmitting(true)
    const result = await postVoucherAction('/api/foh/vouchers/issue', {
      number: selected.number,
      employeeId: staffId,
      eventId: eventId ?? undefined,
      wonAtLabel: eventId ? undefined : freeLabel.trim(),
      expiryDate,
      customerId: customer?.id,
      idempotencyKey: newIdempotencyKey()
    })
    setSubmitting(false)
    setConfirmOpen(false)

    if (result.ok) {
      setSuccess({
        number: selected.number,
        typeTitle: selected.typeTitle,
        expiryDate,
        contextLabel
      })
      setSelected(null)
      setCustomer(null)
      onMutated()
      return
    }

    if (result.networkError) {
      await refreshSelected(
        selected.number,
        'Connection problem. Showing the voucher as the server sees it - if it now shows as active, the hand-out went through.'
      )
      return
    }

    await refreshSelected(selected.number, result.message ?? 'The hand-out was refused.')
  }

  const canHandOut = Boolean(
    canEdit && staffId && selected && isActionable(selected, 'handout') && expiryValid && contextValid
  )

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-base font-semibold text-gray-900">Where was it won?</h3>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Event won at">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => setEventId(eventId === event.id ? null : event.id)}
              aria-pressed={eventId === event.id}
              className={cn(
                'min-h-[44px] rounded-full border px-4 py-2 text-base font-medium focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-1',
                eventId === event.id
                  ? 'border-sidebar bg-sidebar text-white'
                  : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
              )}
            >
              {event.name}
            </button>
          ))}
          {eventsLoaded && events.length === 0 && (
            <p className="text-base text-gray-600">No events today. Type where it was won below.</p>
          )}
        </div>
        <div className="mt-2">
          <label htmlFor="foh-handout-label" className="block text-sm font-medium text-gray-900">
            Or type it (used when no event is picked)
          </label>
          <input
            id="foh-handout-label"
            type="text"
            autoComplete="off"
            placeholder="e.g. Quiz Night raffle"
            value={freeLabel}
            disabled={Boolean(eventId)}
            onChange={(event) => setFreeLabel(event.target.value)}
            className="mt-1 block h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40 disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>

        <h3 className="mt-4 text-base font-semibold text-gray-900">Expiry date (required)</h3>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Expiry date">
          {EXPIRY_PRESET_DAYS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setExpiryMode(String(days) as ExpiryMode)}
              aria-pressed={expiryMode === String(days)}
              className={cn(
                'min-h-[44px] rounded-full border px-4 py-2 text-base font-medium focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-1',
                expiryMode === String(days)
                  ? 'border-sidebar bg-sidebar text-white'
                  : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
              )}
            >
              +{days} days
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExpiryMode('custom')}
            aria-pressed={expiryMode === 'custom'}
            className={cn(
              'min-h-[44px] rounded-full border px-4 py-2 text-base font-medium focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-1',
              expiryMode === 'custom'
                ? 'border-sidebar bg-sidebar text-white'
                : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
            )}
          >
            Custom
          </button>
          {expiryMode === 'custom' && (
            <div>
              <label htmlFor="foh-handout-custom-expiry" className="sr-only">
                Custom expiry date
              </label>
              <input
                id="foh-handout-custom-expiry"
                type="date"
                min={todayIso}
                value={customExpiry}
                onChange={(event) => setCustomExpiry(event.target.value)}
                className="h-12 rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40"
              />
            </div>
          )}
        </div>
        {expiryDate && expiryValid && (
          <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-base font-semibold text-green-900">
            Write this date on the card: {formatIsoDateLong(expiryDate)}
          </p>
        )}
      </div>

      <NumberSearch
        idPrefix="foh-handout"
        label="Voucher number on the card"
        query={lookup.query}
        onQueryChange={lookup.setQuery}
        onSearch={() => handleSearch()}
        searching={lookup.searching}
        results={lookup.results}
        message={lookup.message}
        onSelect={selectVoucher}
        selectedNumber={selected?.number ?? null}
      />

      <div aria-live="polite">
        {outcome && (
          <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-base text-blue-900">
            {outcome}
          </p>
        )}
      </div>

      {success && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-4">
          <p className="text-xl font-bold text-green-900">Handed out</p>
          <p className="mt-1 text-base text-green-900">
            <span className="font-mono font-semibold">{success.number}</span> - {success.typeTitle}
            {success.contextLabel ? ` (${success.contextLabel})` : ''}, expires{' '}
            {formatIsoDateLong(success.expiryDate)}.
          </p>
          <p className="mt-2 rounded-md border border-green-400 bg-white px-3 py-2 text-base font-semibold text-green-900">
            Write the expiry date, the event and your name on the card before you hand it over.
          </p>
          <button
            type="button"
            onClick={() => {
              setSuccess(null)
              setOutcome(null)
              lookup.reset()
            }}
            className="mt-3 min-h-[56px] w-full rounded-lg bg-sidebar px-4 py-3 text-lg font-semibold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-2"
          >
            Hand out another
          </button>
        </div>
      )}

      {selected && !success && (
        <VoucherCard
          item={selected}
          mode="handout"
          onViewReplacement={(replacementNumber) => {
            lookup.setQuery(replacementNumber)
            handleSearch(replacementNumber)
          }}
        >
          {isActionable(selected, 'handout') && (
            <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
              <CustomerAttach
                idPrefix="foh-handout"
                value={customer}
                onChange={setCustomer}
                eventId={eventId}
              />

              {!canEdit && (
                <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-700">
                  You have view-only access. Ask a manager to hand out vouchers.
                </p>
              )}
              {canEdit && !staffId && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-900">
                  Choose your name at the top before handing out.
                </p>
              )}
              {canEdit && staffId && !contextValid && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-900">
                  Pick an event or type where the voucher was won.
                </p>
              )}
              {canEdit && staffId && contextValid && !expiryValid && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-900">
                  Pick an expiry date (today or later) before handing out.
                </p>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canHandOut}
                  className="min-h-[56px] w-full rounded-lg bg-sidebar px-4 py-3 text-xl font-bold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Hand out this voucher
                </button>
              )}
            </div>
          )}
        </VoucherCard>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Hand out this voucher?"
        confirmLabel="Yes, hand it out"
        busy={submitting}
        onConfirm={confirmIssue}
        onCancel={() => setConfirmOpen(false)}
      >
        {selected && expiryDate && (
          <div className="space-y-1">
            <p>
              <span className="font-mono font-semibold">{selected.number}</span> - {selected.typeTitle}
            </p>
            <p>Won at: {contextLabel || 'not set'}</p>
            <p>Expires: {formatIsoDateLong(expiryDate)}</p>
            <p>Handed out by: {staffName ?? 'not set'}</p>
            {customer && <p>Customer: {customer.name}</p>}
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
