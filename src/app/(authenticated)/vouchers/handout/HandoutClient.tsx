'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Card, Button, Input, Select, Alert, Badge, toast } from '@/ds'
import { EXPIRY_PRESET_DAYS, LOOKUP_MIN_CHARS } from '@/lib/vouchers/constants'
import { normaliseVoucherNumberInput } from '@/lib/vouchers/numbering'
import {
  getVoucherLedger,
  getVoucherDetail,
  getEventBookers,
  issueVoucher,
  searchCustomersForVoucher,
} from '@/app/actions/vouchers'
import type {
  HandoutContextData,
  EventBookerChip,
  VoucherCustomerHit,
} from '@/app/actions/vouchers'
import {
  getTodayIsoDate,
  getLocalIsoDateDaysAhead,
  formatDateFull,
  formatTime12Hour,
} from '@/lib/dateUtils'
import { newIdempotencyKey } from '../_shared/voucher-ui'

const STORAGE_KEY = 'ams-voucher-handout-v1'

interface StoredHandoutState {
  eventId: string | null
  freeTextLabel: string
  staffId: string
  expiryDate: string
  counterDate: string
  counter: number
}

interface StockPick {
  voucherNumber: string
  typeTitle: string
}

interface HandoutClientProps {
  context: HandoutContextData
  prefillNumber: string | null
}

export function HandoutClient({ context, prefillNumber }: HandoutClientProps) {
  const [eventId, setEventId] = useState<string | null>(null)
  const [freeTextLabel, setFreeTextLabel] = useState('')
  const [staffId, setStaffId] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [counter, setCounter] = useState(0)
  const [hydrated, setHydrated] = useState(false)

  const [numberInput, setNumberInput] = useState(prefillNumber ?? '')
  const [matches, setMatches] = useState<StockPick[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<StockPick | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState<string>(newIdempotencyKey())

  const [bookers, setBookers] = useState<EventBookerChip[]>([])
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerHits, setCustomerHits] = useState<VoucherCustomerHit[]>([])
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [lastIssued, setLastIssued] = useState<{ number: string; expiry: string } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const customerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---------------------------------------------------------------- storage
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw) as StoredHandoutState
        setEventId(stored.eventId)
        setFreeTextLabel(stored.freeTextLabel ?? '')
        setStaffId(stored.staffId ?? '')
        setExpiryDate(stored.expiryDate ?? '')
        setCounter(stored.counterDate === getTodayIsoDate() ? stored.counter ?? 0 : 0)
      }
    } catch {
      // Ignore corrupted storage; start fresh.
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const stored: StoredHandoutState = {
      eventId,
      freeTextLabel,
      staffId,
      expiryDate,
      counterDate: getTodayIsoDate(),
      counter,
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // Storage full or unavailable; the session still works without persistence.
    }
  }, [hydrated, eventId, freeTextLabel, staffId, expiryDate, counter])

  // The selected event may no longer be running (context lists today only).
  useEffect(() => {
    if (!hydrated) return
    if (eventId && !context.events.some((event) => event.id === eventId)) {
      setEventId(null)
    }
  }, [hydrated, eventId, context.events])

  // ---------------------------------------------------------------- stock search
  const runStockSearch = useCallback(async (raw: string) => {
    const normalised = normaliseVoucherNumberInput(raw)
    if (normalised.length < LOOKUP_MIN_CHARS) {
      setMatches([])
      return
    }
    setSearching(true)
    const result = await getVoucherLedger({
      status: ['generated'],
      batchReady: true,
      q: normalised,
      page: 1,
      pageSize: 10,
    })
    setSearching(false)
    if (result.data) {
      setMatches(
        result.data.rows.map((row) => ({
          voucherNumber: row.voucher.voucherNumber,
          typeTitle: row.typeTitle,
        }))
      )
    }
  }, [])

  useEffect(() => {
    if (selected) return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void runStockSearch(numberInput), 300)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [numberInput, selected, runStockSearch])

  const pickVoucher = (pick: StockPick) => {
    setSelected(pick)
    setMatches([])
    setNumberInput(pick.voucherNumber)
    setIdempotencyKey(newIdempotencyKey())
    setErrorMessage(null)
  }

  const clearSelection = () => {
    setSelected(null)
    setNumberInput('')
    setCustomer(null)
    setCustomerQuery('')
    setCustomerHits([])
    setErrorMessage(null)
  }

  // ---------------------------------------------------------------- customers
  useEffect(() => {
    if (!eventId) {
      setBookers([])
      return
    }
    let live = true
    void getEventBookers(eventId).then((result) => {
      if (live && result.data) setBookers(result.data)
    })
    return () => {
      live = false
    }
  }, [eventId])

  useEffect(() => {
    if (customerTimer.current) clearTimeout(customerTimer.current)
    if (customerQuery.trim().length < 2) {
      setCustomerHits([])
      return
    }
    customerTimer.current = setTimeout(() => {
      void searchCustomersForVoucher(customerQuery).then((result) => {
        if (result.data) setCustomerHits(result.data)
      })
    }, 300)
    return () => {
      if (customerTimer.current) clearTimeout(customerTimer.current)
    }
  }, [customerQuery])

  // ---------------------------------------------------------------- derived
  const selectedEvent = context.events.find((event) => event.id === eventId) ?? null
  const wonAtLabel = freeTextLabel.trim() || selectedEvent?.name || ''
  const contextReady = Boolean(staffId && expiryDate && wonAtLabel)
  const expiryLong = expiryDate ? formatDateFull(expiryDate) : null

  const presetDates = useMemo(
    () =>
      EXPIRY_PRESET_DAYS.map((days) => ({
        days,
        date: getLocalIsoDateDaysAhead(days),
      })),
    []
  )

  // ---------------------------------------------------------------- confirm
  const handleConfirm = async () => {
    if (!selected || !contextReady || submitting) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const result = await issueVoucher({
        voucherNumber: selected.voucherNumber,
        employeeId: staffId,
        eventId: eventId ?? null,
        wonAtLabel,
        expiryDate,
        customerId: customer?.id ?? null,
        idempotencyKey,
      })
      if (result.error || !result.data) {
        setErrorMessage(result.error ?? 'Could not record the hand-out.')
        return
      }
      setCounter((value) => value + 1)
      setLastIssued({ number: result.data.voucher.voucherNumber, expiry: expiryDate })
      toast.success(`${result.data.voucher.voucherNumber} handed out`)
      clearSelection()
    } catch {
      // Network loss mid-confirm: re-fetch and show the confirmed server state
      // instead of a scary error (F33).
      const check = await getVoucherDetail(selected.voucherNumber)
      if (check.data && check.data.voucher.status === 'issued') {
        setCounter((value) => value + 1)
        setLastIssued({ number: selected.voucherNumber, expiry: expiryDate })
        toast.success(`${selected.voucherNumber} was already recorded as handed out`)
        clearSelection()
      } else {
        setErrorMessage(
          'The connection dropped before the hand-out could be confirmed. Check the voucher and try again.'
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card title="Session context" subtitle="Applies to every card until you change it">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">Won at</div>
            <div className="flex flex-wrap gap-2">
              {context.events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setEventId(eventId === event.id ? null : event.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    eventId === event.id
                      ? 'border-green-600 bg-green-50 text-green-800 font-medium'
                      : 'border-gray-300 text-gray-700 hover:border-gray-400'
                  }`}
                >
                  {event.name}
                  {event.time ? ` · ${formatTime12Hour(event.time)}` : ''}
                </button>
              ))}
              {context.events.length === 0 && (
                <span className="text-sm text-gray-500">
                  No events today. Use the free-text label below.
                </span>
              )}
            </div>
            <div className="mt-2">
              <Input
                aria-label="Won at (free text)"
                placeholder={selectedEvent ? `Using event: ${selectedEvent.name}` : 'For example: Sunday quiz raffle'}
                value={freeTextLabel}
                onChange={(event) => setFreeTextLabel(event.target.value)}
                maxLength={200}
              />
            </div>
          </div>

          <Select
            label="Handed out by"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
            placeholder="Choose a staff member"
            options={context.staff.map((member) => ({
              value: member.employeeId,
              label: member.clockedIn ? `${member.name} (clocked in)` : member.name,
            }))}
          />

          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">Expiry (required)</div>
            <div className="flex flex-wrap items-center gap-2">
              {presetDates.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => setExpiryDate(preset.date)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    expiryDate === preset.date
                      ? 'border-green-600 bg-green-50 text-green-800 font-medium'
                      : 'border-gray-300 text-gray-700 hover:border-gray-400'
                  }`}
                >
                  +{preset.days} days
                </button>
              ))}
              <div className="w-44">
                <Input
                  type="date"
                  aria-label="Custom expiry date"
                  min={context.todayIso}
                  value={expiryDate}
                  onChange={(event) => setExpiryDate(event.target.value)}
                />
              </div>
            </div>
            {expiryLong && (
              <div className="mt-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-green-900 font-medium">
                Write this date on every card: {expiryLong}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Hand out a card"
        subtitle={contextReady ? undefined : 'Set staff, expiry and where it was won first'}
      >
        <div className="space-y-4">
          {lastIssued && !selected && (
            <Alert tone="success" title={`${lastIssued.number} recorded`}>
              Write {formatDateFull(lastIssued.expiry)} on the card before handing it over.
            </Alert>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Voucher number"
                placeholder="AN-2607-0148 or last digits"
                value={numberInput}
                onChange={(event) => {
                  setNumberInput(event.target.value)
                  setSelected(null)
                }}
                className="font-mono"
                autoComplete="off"
              />
            </div>
            {selected && (
              <Button variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            )}
          </div>

          {!selected && matches.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {matches.map((match) => (
                <li key={match.voucherNumber}>
                  <button
                    type="button"
                    onClick={() => pickVoucher(match)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                  >
                    <span className="font-mono font-medium text-gray-900">
                      {match.voucherNumber}
                    </span>
                    <span className="text-sm text-gray-600">{match.typeTitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!selected &&
            matches.length === 0 &&
            !searching &&
            normaliseVoucherNumberInput(numberInput).length >= LOOKUP_MIN_CHARS && (
              <p className="text-sm text-gray-500" aria-live="polite">
                No cards in stock match that number. Only printed, un-issued cards can be handed
                out.
              </p>
            )}

          {selected && (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-lg font-semibold text-gray-900">
                      {selected.voucherNumber}
                    </div>
                    <div className="text-sm text-gray-600">{selected.typeTitle}</div>
                  </div>
                  <Badge tone="neutral">In stock</Badge>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">
                  Customer (optional, for SMS reminders)
                </div>
                {customer ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="primary">{customer.name}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {bookers.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {bookers.map((booker) => (
                          <button
                            key={booker.customerId}
                            type="button"
                            onClick={() =>
                              setCustomer({ id: booker.customerId, name: booker.name })
                            }
                            className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400"
                          >
                            {booker.name} · booked · {booker.seats}{' '}
                            {booker.seats === 1 ? 'seat' : 'seats'}
                          </button>
                        ))}
                      </div>
                    )}
                    <Input
                      aria-label="Search customers"
                      placeholder="Search by name or mobile"
                      value={customerQuery}
                      onChange={(event) => setCustomerQuery(event.target.value)}
                      autoComplete="off"
                    />
                    {customerHits.length > 0 && (
                      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                        {customerHits.map((hit) => (
                          <li key={hit.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomer({ id: hit.id, name: hit.name })
                                setCustomerQuery('')
                                setCustomerHits([])
                              }}
                              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50"
                            >
                              <span className="text-gray-900">{hit.name}</span>
                              <span className="text-sm text-gray-500">{hit.mobile ?? ''}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {errorMessage && (
                <Alert tone="danger" title="Not recorded">
                  {errorMessage}
                </Alert>
              )}

              <Button
                variant="primary"
                size="lg"
                onClick={() => void handleConfirm()}
                disabled={!contextReady || submitting}
                loading={submitting}
              >
                Confirm hand-out
              </Button>
              {!contextReady && (
                <p className="text-sm text-amber-700">
                  Set the staff member, expiry date and where it was won before confirming.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span aria-live="polite">
          Handed out this session: <span className="font-semibold text-gray-900">{counter}</span>
        </span>
        <Link href="/vouchers/all" className="underline underline-offset-2">
          View the ledger
        </Link>
      </div>
    </div>
  )
}
