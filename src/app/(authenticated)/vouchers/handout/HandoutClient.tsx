'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody, CardHeader, Button, FormFooter, Input, Select, Alert, Badge, toast } from '@/ds'
import { EXPIRY_PRESET_DAYS, LOOKUP_MIN_CHARS } from '@/lib/vouchers/constants'
import { normaliseVoucherNumberInput } from '@/lib/vouchers/numbering'
import {
  getVoucherLedger,
  getVoucherDetail,
  getEventBookers,
  issueVoucher,
  searchCustomersForVoucher,
  quickAddCustomerForVoucher,
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
import { newIdempotencyKey, VoucherStatusBadge } from '../_shared/voucher-ui'

// A caption for a group of toggle buttons, in the DS field-label style. The group points at it
// with aria-labelledby, because a <label> can only name a single control.
const GROUP_CAPTION = 'mb-2 block text-xs font-medium uppercase tracking-wider text-text-muted'

const STORAGE_KEY = 'ams-voucher-handout-v1'
const DEFAULT_EXPIRY_DAYS = EXPIRY_PRESET_DAYS[0]

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
  // Vouchers are normally valid one month from issue, so the +30 day preset is
  // preselected. A stored context only overrides it when it holds a date that is
  // still in the future.
  const [expiryDate, setExpiryDate] = useState(() => getLocalIsoDateDaysAhead(DEFAULT_EXPIRY_DAYS))
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
  // Quick-add for a winner who is not on file yet (spec 5.1).
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddName, setQuickAddName] = useState('')
  const [quickAddMobile, setQuickAddMobile] = useState('')
  const [quickAddEmail, setQuickAddEmail] = useState('')
  const [quickAddBusy, setQuickAddBusy] = useState(false)
  const [quickAddError, setQuickAddError] = useState<string | null>(null)

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
        // A date from an old session would be written on today's cards without
        // anyone noticing, so anything not still in the future is dropped and
        // the +30 day default stands.
        if (stored.expiryDate && stored.expiryDate > getTodayIsoDate()) {
          setExpiryDate(stored.expiryDate)
        }
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

  // -------------------------------------------------------------- quick add
  const handleQuickAdd = async () => {
    if (quickAddBusy) return
    setQuickAddBusy(true)
    setQuickAddError(null)
    const result = await quickAddCustomerForVoucher({
      name: quickAddName,
      mobile: quickAddMobile,
      email: quickAddEmail.trim() || undefined,
    })
    setQuickAddBusy(false)
    if (result.error || !result.data) {
      setQuickAddError(result.error || 'Could not add the customer')
      return
    }
    setCustomer({ id: result.data.id, name: result.data.name })
    setQuickAddOpen(false)
    setQuickAddName('')
    setQuickAddMobile('')
    setQuickAddEmail('')
    setCustomerQuery('')
    setCustomerHits([])
  }

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
    // data-touch-targets lifts every control here to 44px on a touch screen (globals.css,
    // pointer: coarse): this screen is used on an iPad at the bar. The wrapper exists for that
    // scope and spaces its blocks the way PageLayout spaces a page.
    <div data-touch-targets="" className="space-y-6">
      <Card>
        <CardHeader title="Session Context" subtitle="Applies to every card until you change it" />
        <CardBody className="space-y-4">
          <div>
            <span id="handout-won-at" className={GROUP_CAPTION}>
              Won at
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="handout-won-at">
              {context.events.map((event) => (
                <Button
                  key={event.id}
                  type="button"
                  size="sm"
                  variant={eventId === event.id ? 'primary' : 'secondary'}
                  aria-pressed={eventId === event.id}
                  onClick={() => setEventId(eventId === event.id ? null : event.id)}
                >
                  {event.name}
                  {event.time ? ` · ${formatTime12Hour(event.time)}` : ''}
                </Button>
              ))}
              {context.events.length === 0 && (
                <span className="text-sm text-text-muted">
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
            <span id="handout-expiry" className={GROUP_CAPTION}>
              Expiry (required)
            </span>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="handout-expiry">
              {presetDates.map((preset) => (
                <Button
                  key={preset.days}
                  type="button"
                  size="sm"
                  variant={expiryDate === preset.date ? 'primary' : 'secondary'}
                  aria-pressed={expiryDate === preset.date}
                  onClick={() => setExpiryDate(preset.date)}
                >
                  +{preset.days} days
                </Button>
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
              <Alert
                tone="success"
                role="status"
                className="mt-3"
                title={`Write this date on every card: ${expiryLong}`}
              />
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Hand Out a Card"
          subtitle={contextReady ? undefined : 'Set staff, expiry and where it was won first'}
        />
        <CardBody className="space-y-4">
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
            <Card padding="none">
              <ul className="divide-y divide-border">
                {matches.map((match) => (
                  <li key={match.voucherNumber}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => pickVoucher(match)}
                      className="h-auto w-full justify-between rounded-none px-4 py-3 text-left font-normal focus-visible:shadow-ring-inset"
                    >
                      <span className="font-mono font-medium text-text">
                        {match.voucherNumber}
                      </span>
                      <span className="text-sm text-text-muted">{match.typeTitle}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {!selected &&
            matches.length === 0 &&
            !searching &&
            normaliseVoucherNumberInput(numberInput).length >= LOOKUP_MIN_CHARS && (
              <p className="text-sm text-text-muted" aria-live="polite">
                No cards in stock match that number. Only printed, un-issued cards can be handed
                out.
              </p>
            )}

          {selected && (
            <div className="space-y-4">
              <Card variant="secondary" padding="sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-lg font-semibold text-text">
                      {selected.voucherNumber}
                    </div>
                    <div className="text-sm text-text-muted">{selected.typeTitle}</div>
                  </div>
                  {/* Only printed, un-issued cards can be picked here. */}
                  <VoucherStatusBadge status="generated" />
                </div>
              </Card>

              <div>
                <span id="handout-customer" className={GROUP_CAPTION}>
                  Customer (optional, for SMS reminders)
                </span>
                {customer ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="primary">{customer.name}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2" role="group" aria-labelledby="handout-customer">
                    {bookers.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {bookers.map((booker) => (
                          <Button
                            key={booker.customerId}
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setCustomer({ id: booker.customerId, name: booker.name })
                            }
                            className="font-normal"
                          >
                            {booker.name} · booked · {booker.seats}{' '}
                            {booker.seats === 1 ? 'seat' : 'seats'}
                          </Button>
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
                      <Card padding="none">
                        <ul className="divide-y divide-border">
                          {customerHits.map((hit) => (
                            <li key={hit.id}>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                  setCustomer({ id: hit.id, name: hit.name })
                                  setCustomerQuery('')
                                  setCustomerHits([])
                                }}
                                className="h-auto w-full justify-between rounded-none px-4 py-2.5 text-left font-normal focus-visible:shadow-ring-inset"
                              >
                                <span className="text-text">{hit.name}</span>
                                <span className="text-sm text-text-muted">{hit.mobile ?? ''}</span>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    )}
                    {!quickAddOpen && (
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => setQuickAddOpen(true)}
                        className="text-sm"
                      >
                        Not on File? Add Them
                      </Button>
                    )}
                    {quickAddOpen && (
                      <Card variant="secondary" padding="sm">
                        <div className="space-y-2">
                          <p className="text-sm text-text-muted">
                            Adding someone here signs them up for updates from The Anchor, so please say so.
                          </p>
                          <Input
                            aria-label="New customer name"
                            placeholder="Name"
                            value={quickAddName}
                            onChange={(event) => setQuickAddName(event.target.value)}
                            autoComplete="off"
                          />
                          <Input
                            aria-label="New customer mobile"
                            placeholder="Mobile number"
                            value={quickAddMobile}
                            onChange={(event) => setQuickAddMobile(event.target.value)}
                            autoComplete="off"
                          />
                          <Input
                            aria-label="New customer email (optional)"
                            placeholder="Email (optional, used for reminders)"
                            value={quickAddEmail}
                            onChange={(event) => setQuickAddEmail(event.target.value)}
                            autoComplete="off"
                          />
                          {quickAddError && <p className="text-sm text-danger-fg">{quickAddError}</p>}
                          <FormFooter>
                            <Button variant="ghost" size="sm" onClick={() => setQuickAddOpen(false)}>
                              Cancel
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={quickAddBusy}
                              disabled={quickAddBusy || !quickAddName.trim() || !quickAddMobile.trim()}
                              onClick={() => void handleQuickAdd()}
                            >
                              Add and Attach
                            </Button>
                          </FormFooter>
                        </div>
                      </Card>
                    )}
                  </div>
                )}
              </div>

              {errorMessage && (
                <Alert tone="danger" title="Not recorded">
                  {errorMessage}
                </Alert>
              )}

              {/* The hand-out form ends here, so its one action sits in the form footer. */}
              <FormFooter
                start={
                  !contextReady ? (
                    <span className="text-warning-fg">
                      Set the staff member, expiry date and where it was won before confirming.
                    </span>
                  ) : undefined
                }
              >
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => void handleConfirm()}
                  disabled={!contextReady || submitting}
                  loading={submitting}
                >
                  Confirm Hand-Out
                </Button>
              </FormFooter>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between text-sm text-text-muted">
        <span aria-live="polite">
          Handed out this session: <span className="font-semibold text-text">{counter}</span>
        </span>
        <Link href="/vouchers/all" className="underline underline-offset-2">
          View the ledger
        </Link>
      </div>
    </div>
  )
}
