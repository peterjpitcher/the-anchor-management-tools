'use client'

import React, { useEffect, useState } from 'react'
import { Alert, Button, Card, CardBody, CardHeader, ConfirmDialog, Input } from '@/ds'
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
        'Connection problem. Showing the voucher as the server sees it - if it now shows as Issued, the hand-out went through.'
      )
      return
    }

    await refreshSelected(selected.number, result.message ?? 'The hand-out was refused.')
  }

  const canHandOut = Boolean(
    canEdit && staffId && selected && isActionable(selected, 'handout') && expiryValid && contextValid
  )

  // Blocks flow straight into the screen's own stack (VouchersFohClient).
  return (
    <>
      {/* Choices are toggle buttons: the pressed one is filled. */}
      <Card>
        <CardHeader title="Where Was It Won?" />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Event won at">
            {events.map((event) => (
              <Button
                key={event.id}
                type="button"
                size="lg"
                variant={eventId === event.id ? 'primary' : 'secondary'}
                onClick={() => setEventId(eventId === event.id ? null : event.id)}
                aria-pressed={eventId === event.id}
                className="min-h-touch text-base"
              >
                {event.name}
              </Button>
            ))}
            {eventsLoaded && events.length === 0 && (
              <p className="text-base text-text-muted">No events today. Type where it was won below.</p>
            )}
          </div>
          <Input
            id="foh-handout-label"
            label="Or type it (used when no event is picked)"
            type="text"
            autoComplete="off"
            placeholder="e.g. Quiz Night raffle"
            value={freeLabel}
            disabled={Boolean(eventId)}
            onChange={(event) => setFreeLabel(event.target.value)}
            className="h-12 text-base"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Expiry Date (Required)" />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Expiry date">
            {EXPIRY_PRESET_DAYS.map((days) => (
              <Button
                key={days}
                type="button"
                size="lg"
                variant={expiryMode === String(days) ? 'primary' : 'secondary'}
                onClick={() => setExpiryMode(String(days) as ExpiryMode)}
                aria-pressed={expiryMode === String(days)}
                className="min-h-touch text-base"
              >
                +{days} days
              </Button>
            ))}
            <Button
              type="button"
              size="lg"
              variant={expiryMode === 'custom' ? 'primary' : 'secondary'}
              onClick={() => setExpiryMode('custom')}
              aria-pressed={expiryMode === 'custom'}
              className="min-h-touch text-base"
            >
              Custom
            </Button>
            {expiryMode === 'custom' && (
              <Input
                id="foh-handout-custom-expiry"
                aria-label="Custom expiry date"
                type="date"
                min={todayIso}
                value={customExpiry}
                onChange={(event) => setCustomExpiry(event.target.value)}
                className="h-12 w-auto text-base"
              />
            )}
          </div>
          {expiryDate && expiryValid && (
            <Alert
              tone="success"
              role="status"
              title={`Write this date on the card: ${formatIsoDateLong(expiryDate)}`}
            />
          )}
        </CardBody>
      </Card>

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
          <Alert tone="info" role="status">
            {outcome}
          </Alert>
        )}
      </div>

      {success && (
        <Alert
          tone="success"
          role="status"
          title="Handed out"
          actions={
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => {
                setSuccess(null)
                setOutcome(null)
                lookup.reset()
              }}
              className="h-14 w-full text-lg"
            >
              Hand Out Another
            </Button>
          }
        >
          <p>
            <span className="font-mono font-semibold">{success.number}</span> - {success.typeTitle}
            {success.contextLabel ? ` (${success.contextLabel})` : ''}, expires{' '}
            {formatIsoDateLong(success.expiryDate)}.
          </p>
          <p className="mt-2 font-semibold">
            Write the expiry date, the event and your name on the card before you hand it over.
          </p>
        </Alert>
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
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <CustomerAttach
                idPrefix="foh-handout"
                value={customer}
                onChange={setCustomer}
                eventId={eventId}
              />

              {!canEdit && (
                <Alert tone="info" role="status">
                  You have view-only access. Ask a manager to hand out vouchers.
                </Alert>
              )}
              {canEdit && !staffId && (
                <Alert tone="warning" role="status">
                  Choose your name at the top before handing out.
                </Alert>
              )}
              {canEdit && staffId && !contextValid && (
                <Alert tone="warning" role="status">
                  Pick an event or type where the voucher was won.
                </Alert>
              )}
              {canEdit && staffId && contextValid && !expiryValid && (
                <Alert tone="warning" role="status">
                  Pick an expiry date (today or later) before handing out.
                </Alert>
              )}

              {canEdit && (
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canHandOut}
                  className="h-14 w-full text-xl font-bold"
                >
                  Hand Out This Voucher
                </Button>
              )}
            </div>
          )}
        </VoucherCard>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmIssue}
        title="Hand Out This Voucher?"
        confirmLabel="Yes, Hand It Out"
        tone="primary"
        message={
          selected && expiryDate ? (
            <>
              <span className="block">
                <span className="font-mono font-semibold">{selected.number}</span> - {selected.typeTitle}
              </span>
              <span className="block">Won at: {contextLabel || 'not set'}</span>
              <span className="block">Expires: {formatIsoDateLong(expiryDate)}</span>
              <span className="block">Handed out by: {staffName ?? 'not set'}</span>
              {customer && <span className="block">Customer: {customer.name}</span>}
            </>
          ) : undefined
        }
      />
    </>
  )
}
