'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  FohCreateMode,
  FohCustomerSearchResult,
  FohEventOption,
  FohScheduleResponse,
  TimelineRange,
  WalkInTargetTable,
} from '../types'
import type { CreateForm } from '../components/FohCreateBookingModal'
import {
  DEFAULT_COUNTRY_CODE,
  getLondonDateKey,
  getTableWindowMs,
  mapFohBlockedReason,
  mapFohEventBlockedReason,
  postBookingAction,
  resolveWalkInDefaults,
  splitName,
  suggestWalkInTime,
} from '../utils'
import type { FohCreateBookingResponse, FohCreateEventBookingResponse } from '../types'
import { requiresDeposit as requiresDepositForParty } from '@/lib/table-bookings/deposit'
import { isChristmasPurpose } from '@/lib/table-bookings/christmas'
import {
  FOH_CLIENT_OUTDATED_CODE,
  getFohBookingClientHeaders,
  type FohBookingCustomerMode,
} from '@/lib/foh/booking-client-contract'
import { WALK_IN_TODAY_ONLY_MESSAGE } from '@/lib/foh/walk-in'

/**
 * The seasonal period covering the chosen booking date, as the staff route
 * reports it. No deposit block: staff price the deposit through the existing
 * FOH controls, and a second quote here would be a second opinion about money.
 */
export type FohBookingPeriod = {
  id: string
  code: string
  period_kind: string
  name: string
  guest_question: string
  guest_blurb: string | null
  requires_preorder: boolean
  min_party_size: number | null
  max_party_size: number | null
  bookable: boolean
  not_bookable_reason: string | null
  not_bookable_message: string | null
}

/**
 * Keyed to the period AND the date it was given for, so changing either forgets
 * it rather than carrying an answer staff gave about a different occasion.
 */
type FohPeriodAnswer = { periodId: string; date: string; accepted: boolean }

export type UseFohCreateBookingReturn = {
  isCreateModalOpen: boolean
  createMode: FohCreateMode
  createForm: CreateForm
  walkInTargetTable: WalkInTargetTable | null
  submittingBooking: boolean
  searchingCustomers: boolean
  customerQuery: string
  completedCustomerSearchQuery: string
  customerResults: FohCustomerSearchResult[]
  selectedCustomer: FohCustomerSearchResult | null
  eventOptions: FohEventOption[]
  loadingEventOptions: boolean
  eventOptionsError: string | null
  walkInPurposeAutoSelectionEnabled: boolean
  tableEventPromptAcknowledgedEventId: string | null
  // Computed
  selectedEventOption: FohEventOption | null
  overlappingEventForTable: FohEventOption | null
  formRequiresDeposit: boolean
  /** The non-Christmas seasonal period covering the chosen date, if any. */
  seasonalPeriod: FohBookingPeriod | null
  /** Null until staff answer, and again whenever the period or date changes. */
  seasonalAnswer: boolean | null
  setSeasonalAnswer: (accepted: boolean) => void
  // Actions
  setCreateForm: (updater: (current: CreateForm) => CreateForm) => void
  setCustomerQuery: (query: string) => void
  setSelectedCustomer: (customer: FohCustomerSearchResult | null) => void
  setCustomerResults: (results: FohCustomerSearchResult[]) => void
  setTableEventPromptAcknowledgedEventId: (id: string | null) => void
  setWalkInPurposeAutoSelectionEnabled: (enabled: boolean) => void
  openCreateModal: (options?: {
    mode?: FohCreateMode; laneTableId?: string; laneTableName?: string; suggestedTime?: string
    prefill?: Partial<Pick<CreateForm, 'booking_date' | 'purpose' | 'event_id'>>
  }) => void
  closeCreateModal: () => void
  handleCreateBooking: (event: FormEvent<HTMLFormElement>) => void
}

export function useFohCreateBooking(input: {
  date: string
  clockNow: Date
  canEdit: boolean
  schedule: FohScheduleResponse['data'] | null
  timeline: TimelineRange
  setErrorMessage: (msg: string | null) => void
  setStatusMessage: (msg: string | null) => void
  reloadSchedule: (opts?: { requestedDate?: string; surfaceError?: boolean }) => Promise<void>
}): UseFohCreateBookingReturn {
  const { date, clockNow, canEdit, schedule, timeline, setErrorMessage, setStatusMessage, reloadSchedule } = input

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [createMode, setCreateMode] = useState<FohCreateMode>('booking')
  const [walkInTargetTable, setWalkInTargetTable] = useState<WalkInTargetTable | null>(null)
  const [submittingBooking, setSubmittingBooking] = useState(false)
  const [searchingCustomers, setSearchingCustomers] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [completedCustomerSearchQuery, setCompletedCustomerSearchQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<FohCustomerSearchResult[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<FohCustomerSearchResult | null>(null)
  const [eventOptions, setEventOptions] = useState<FohEventOption[]>([])
  const [loadingEventOptions, setLoadingEventOptions] = useState(false)
  const [eventOptionsError, setEventOptionsError] = useState<string | null>(null)
  const [walkInPurposeAutoSelectionEnabled, setWalkInPurposeAutoSelectionEnabled] = useState(false)
  const [tableEventPromptAcknowledgedEventId, setTableEventPromptAcknowledgedEventId] = useState<string | null>(null)
  const [bookingPeriod, setBookingPeriod] = useState<FohBookingPeriod | null>(null)
  const [bookingPeriodAnswer, setBookingPeriodAnswer] = useState<FohPeriodAnswer | null>(null)

  const [createForm, setCreateForm] = useState<CreateForm>({
    booking_date: date,
    event_id: '',
    phone: '',
    email: '',
    customer_name: '',
    first_name: '',
    last_name: '',
    time: '19:00',
    party_size: '2',
    // `christmas` posts a Christmas table booking: 6 guests or more, 24 hours
    // notice, and a deposit every time. The rules are enforced in the database.
    purpose: 'food' as 'food' | 'drinks' | 'event' | 'christmas',
    seating_preference: 'seated',
    sunday_deposit_method: 'payment_link' as 'payment_link' | 'cash',
    notes: '',
    waive_deposit: false,
    is_venue_event: false,
    bypass_pacing: false
  })

  // --- Customer search ---
  useEffect(() => {
    setCompletedCustomerSearchQuery('')
    if (selectedCustomer) { setCustomerResults([]); return }
    const query = customerQuery.trim()
    if (query.length < 2) { setCustomerResults([]); return }
    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setSearchingCustomers(true)
      try {
        const params = new URLSearchParams({ q: query, default_country_code: DEFAULT_COUNTRY_CODE })
        const response = await fetch(`/api/foh/customers/search?${params.toString()}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error((payload && payload.error) || 'Customer search failed')
        if (!cancelled) {
          setCustomerResults(Array.isArray(payload?.data) ? payload.data as FohCustomerSearchResult[] : [])
          setCompletedCustomerSearchQuery(query)
        }
      } catch {
        if (!cancelled) {
          setCustomerResults([])
          setCompletedCustomerSearchQuery('')
        }
      } finally {
        if (!cancelled) setSearchingCustomers(false)
      }
    }, 280)
    return () => { cancelled = true; window.clearTimeout(timeoutId) }
  }, [customerQuery, selectedCustomer])

  // --- Event options loader ---
  useEffect(() => {
    if (!isCreateModalOpen) return
    const bookingDate = createForm.booking_date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) { setEventOptions([]); setEventOptionsError('Please choose a valid event date'); return }
    let cancelled = false
    const controller = new AbortController()
    const loadEvents = async () => {
      setLoadingEventOptions(true)
      setEventOptionsError(null)
      try {
        const params = new URLSearchParams({ date: bookingDate })
        const response = await fetch(`/api/foh/events?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load events')
        if (cancelled) return
        const rows = Array.isArray(payload?.data) ? (payload.data as FohEventOption[]) : []
        setEventOptions(rows)
        setCreateForm((current) => {
          if (current.purpose !== 'event') return current
          if (rows.some((item) => item.id === current.event_id)) return current
          return { ...current, event_id: rows.find((item) => !item.is_full)?.id || rows[0]?.id || '' }
        })
      } catch (error) {
        if (cancelled) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setEventOptions([])
        setEventOptionsError(error instanceof Error ? error.message : 'Failed to load events')
      } finally {
        if (!cancelled) setLoadingEventOptions(false)
      }
    }
    void loadEvents()
    return () => { cancelled = true; controller.abort() }
  }, [createForm.booking_date, createForm.purpose, isCreateModalOpen])

  // --- Seasonal period loader ---
  //
  // Staff could only ever create a seasonal booking through the `christmas`
  // purpose, so Mother's Day, Easter and Father's Day were unusable by staff
  // even once configured: the API accepted the period fields but no screen sent
  // them. This asks which period covers the chosen date so the modal can put the
  // same question to staff that the website puts to a guest.
  useEffect(() => {
    if (!isCreateModalOpen) {
      setBookingPeriod(null)
      return
    }
    const bookingDate = createForm.booking_date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
      setBookingPeriod(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    void (async () => {
      try {
        const params = new URLSearchParams({ date: bookingDate })
        const response = await fetch(`/api/foh/periods?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => null)
        if (cancelled) return
        // A lookup we could not make reads as "no period". A seasonal question
        // is worth money, but never at the price of blocking a booking staff are
        // taking with a guest stood in front of them.
        setBookingPeriod(response.ok && payload?.success ? payload.data?.period ?? null : null)
      } catch {
        if (!cancelled) setBookingPeriod(null)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [createForm.booking_date, isCreateModalOpen])

  // --- Sync create form date with service date ---
  useEffect(() => {
    if (isCreateModalOpen) return
    setCreateForm((current) => ({ ...current, booking_date: date }))
  }, [date, isCreateModalOpen])

  // --- Overlapping event prompt acknowledgement guard ---
  const isChristmasBooking = isChristmasPurpose(createForm.purpose)

  /*
   * Which periods the modal asks about.
   *
   * Christmas already has a working path: the `christmas` purpose posts a
   * Christmas booking and the API treats that purpose as a yes to a
   * Christmas-kind period. Asking again would give staff two controls for one
   * decision and two ways to disagree, so Christmas is deliberately excluded
   * here and its existing path is left untouched.
   */
  const seasonalPeriod =
    bookingPeriod && bookingPeriod.period_kind !== 'christmas' && createForm.purpose !== 'event'
      ? bookingPeriod
      : null

  // Read back only while it still belongs to the period and date on screen.
  const seasonalAnswer =
    bookingPeriodAnswer &&
    seasonalPeriod &&
    bookingPeriodAnswer.periodId === seasonalPeriod.id &&
    bookingPeriodAnswer.date === createForm.booking_date
      ? bookingPeriodAnswer.accepted
      : null

  const setSeasonalAnswer = useCallback(
    (accepted: boolean) => {
      if (!seasonalPeriod) return
      setBookingPeriodAnswer({
        periodId: seasonalPeriod.id,
        date: createForm.booking_date,
        accepted,
      })
    },
    [seasonalPeriod, createForm.booking_date]
  )
  const formRequiresDeposit =
    createMode !== 'management' && !createForm.is_venue_event && createMode !== 'walk_in' &&
    requiresDepositForParty(Number(createForm.party_size) || 0, {
      depositWaived: createForm.waive_deposit === true,
      isChristmas: isChristmasBooking,
    })

  const selectedEventOption = useMemo(
    () => eventOptions.find((eo) => eo.id === createForm.event_id) || null,
    [createForm.event_id, eventOptions]
  )

  const overlappingEventForTable = useMemo(() => {
    if (createForm.purpose === 'event') return null
    const tablePurpose = createForm.purpose === 'drinks' ? 'drinks' : 'food'
    const tableWindow = getTableWindowMs({
      bookingDate: createForm.booking_date, bookingTime: createForm.time,
      purpose: tablePurpose, sundayLunch: false
    })
    if (!tableWindow) return null
    for (const eo of eventOptions) {
      if (eo.booking_mode === 'general') continue
      const eventStartMs = Date.parse(eo.start_datetime || '')
      const eventEndMs = Date.parse(eo.end_datetime || '')
      if (!Number.isFinite(eventStartMs) || !Number.isFinite(eventEndMs)) continue
      const eventPromptStartMs = eventStartMs - 15 * 60 * 1000
      if (tableWindow.startMs < eventEndMs && tableWindow.endMs > eventPromptStartMs) return eo
    }
    return null
  }, [createForm.booking_date, createForm.purpose, createForm.time, eventOptions])

  useEffect(() => {
    if (createForm.purpose !== 'event' || selectedEventOption?.booking_mode !== 'communal') return
    const seatedRemaining = selectedEventOption.seated_remaining ?? 0
    const standingRemaining = selectedEventOption.standing_remaining ?? 0
    if (createForm.seating_preference === 'seated' && seatedRemaining <= 0 && standingRemaining > 0) {
      setCreateForm((current) => ({ ...current, seating_preference: 'standing' }))
    }
  }, [createForm.purpose, createForm.seating_preference, selectedEventOption])

  useEffect(() => {
    if (!overlappingEventForTable) { setTableEventPromptAcknowledgedEventId(null); return }
    if (tableEventPromptAcknowledgedEventId && tableEventPromptAcknowledgedEventId !== overlappingEventForTable.id) {
      setTableEventPromptAcknowledgedEventId(null)
    }
  }, [overlappingEventForTable, tableEventPromptAcknowledgedEventId])

  // --- Walk-in defaults ---
  const resolveCurrentWalkInDefaults = useCallback(
    (serviceDateIso: string, now: Date) =>
      resolveWalkInDefaults({
        serviceDateIso, now,
        serviceWindow: schedule?.service_window,
        timelineStartMin: timeline.startMin, timelineEndMin: timeline.endMin,
        eventOptions
      }),
    [eventOptions, schedule?.service_window, timeline.endMin, timeline.startMin]
  )

  useEffect(() => {
    if (!isCreateModalOpen || createMode !== 'walk_in' || !walkInPurposeAutoSelectionEnabled) return
    setCreateForm((current) => {
      const defaults = resolveCurrentWalkInDefaults(current.booking_date, clockNow)
      const nextPurpose = defaults.purpose
      const nextEventId = nextPurpose === 'event' ? defaults.eventId : ''
      const nextTime = nextPurpose === 'event' ? current.time : defaults.time
      if (current.purpose === nextPurpose && current.event_id === nextEventId && current.time === nextTime) return current
      return { ...current, purpose: nextPurpose, event_id: nextEventId, time: nextTime, sunday_deposit_method: 'payment_link' }
    })
  }, [clockNow, createMode, isCreateModalOpen, resolveCurrentWalkInDefaults, walkInPurposeAutoSelectionEnabled])

  // --- Modal open/close ---
  function resetCreateModalState() {
    setCreateForm((current) => ({
      booking_date: date, event_id: '', phone: '', email: '', customer_name: '', first_name: '', last_name: '',
      time: current.time || '19:00', party_size: current.party_size || '2', purpose: 'food',
      seating_preference: 'seated',
      sunday_deposit_method: 'payment_link',
      notes: '', waive_deposit: false, is_venue_event: false, bypass_pacing: false
    }))
    setCreateMode('booking'); setWalkInTargetTable(null); setCustomerQuery(''); setCustomerResults([])
    setSelectedCustomer(null); setEventOptions([]); setEventOptionsError(null)
    setWalkInPurposeAutoSelectionEnabled(false); setTableEventPromptAcknowledgedEventId(null)
  }

  function openCreateModal(options?: {
    mode?: FohCreateMode; laneTableId?: string; laneTableName?: string; suggestedTime?: string
    prefill?: Partial<Pick<CreateForm, 'booking_date' | 'purpose' | 'event_id'>>
  }) {
    const requestedMode = options?.mode || 'booking'
    const walkInMode = requestedMode === 'walk_in'
    const bookingDate = options?.prefill?.booking_date || getLondonDateKey(clockNow) || date
    setErrorMessage(null); setStatusMessage(null); setCreateMode(requestedMode)
    setWalkInTargetTable(
      walkInMode && options?.laneTableId ? { id: options.laneTableId, name: options.laneTableName || 'selected table' } : null
    )
    const walkInDefaults = walkInMode ? resolveCurrentWalkInDefaults(bookingDate, clockNow) : null
    setCreateForm((current) => {
      const currentTablePurpose = current.purpose === 'event' ? 'food' : current.purpose
      const nextPurpose = walkInMode
        ? walkInDefaults?.purpose || 'food'
        : options?.prefill?.purpose || currentTablePurpose
      const nextTime = (() => {
        if (walkInMode) {
          return options?.suggestedTime || walkInDefaults?.time || current.time
        }

        if (options?.suggestedTime) {
          return options.suggestedTime
        }

        if (nextPurpose === 'event' || options?.prefill?.booking_date) {
          return current.time
        }

        return suggestWalkInTime({
          serviceDateIso: bookingDate,
          now: clockNow,
          serviceWindow: schedule?.service_window,
          timelineStartMin: timeline.startMin,
          timelineEndMin: timeline.endMin,
          purpose: nextPurpose === 'drinks' ? 'drinks' : 'food'
        })
      })()

      return {
        ...current,
        booking_date: bookingDate,
        time: nextTime,
        purpose: nextPurpose,
        event_id: walkInMode ? options?.prefill?.event_id ?? walkInDefaults?.eventId ?? '' : options?.prefill?.event_id ?? current.event_id,
        seating_preference: 'seated',
        sunday_deposit_method: walkInMode ? 'payment_link' : current.sunday_deposit_method,
        phone: walkInMode ? '' : current.phone, email: walkInMode ? '' : current.email, customer_name: walkInMode ? '' : current.customer_name,
        first_name: walkInMode ? '' : current.first_name, last_name: walkInMode ? '' : current.last_name,
        notes: walkInMode ? '' : current.notes, waive_deposit: false, is_venue_event: false, bypass_pacing: false
      }
    })
    if (walkInMode) {
      setCustomerQuery(''); setCustomerResults([]); setSelectedCustomer(null); setWalkInPurposeAutoSelectionEnabled(true)
    } else {
      setWalkInPurposeAutoSelectionEnabled(false)
    }
    setIsCreateModalOpen(true)
  }

  function closeCreateModal() { setIsCreateModalOpen(false); resetCreateModalState() }

  // --- Submit handler ---
  async function handleCreateBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null); setStatusMessage(null)
    const isWalkIn = createMode === 'walk_in'
    const isManagement = createMode === 'management'
    const bookingDate = createForm.booking_date
    const isSameDayWalkIn = isWalkIn && bookingDate === getLondonDateKey(clockNow)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) { setErrorMessage('Please pick a valid booking date'); return }
    if (isWalkIn && !isSameDayWalkIn) { setErrorMessage(WALK_IN_TODAY_ONLY_MESSAGE); return }

    const effectiveBookingTime = isWalkIn
      ? suggestWalkInTime({ serviceDateIso: bookingDate, now: new Date(), serviceWindow: schedule?.service_window, timelineStartMin: timeline.startMin, timelineEndMin: timeline.endMin, purpose: createForm.purpose === 'drinks' ? 'drinks' : 'food' })
      : createForm.time

    if (isWalkIn && createForm.time !== effectiveBookingTime) {
      setCreateForm((current) => ({ ...current, time: effectiveBookingTime }))
    }
    if (isManagement && !selectedCustomer) { setErrorMessage('Select a customer for management booking'); return }
    if (!isWalkIn && !isManagement && !selectedCustomer && !createForm.phone.trim()) { setErrorMessage('Select a customer or provide a phone number'); return }
    if (!isWalkIn && !isManagement && selectedCustomer && !selectedCustomer.mobile_e164 && !selectedCustomer.mobile_number && !createForm.phone.trim()) {
      setErrorMessage('Enter a phone number for the selected customer'); return
    }

    const walkInNameParts = splitName(createForm.customer_name)
    const firstName = createForm.first_name.trim() || (isWalkIn ? walkInNameParts.firstName : undefined)
    const lastName = createForm.last_name.trim() || (isWalkIn ? walkInNameParts.lastName : undefined)
    const customerMode: FohBookingCustomerMode = selectedCustomer
      ? 'selected'
      : createForm.phone.trim()
        ? 'phone'
        : 'anonymous'
    if (!isWalkIn && !isManagement && !selectedCustomer && !firstName) {
      setErrorMessage('Enter a first name for the new customer'); return
    }

    if (createForm.purpose === 'event') {
      const seats = Number.parseInt(createForm.party_size, 10)
      if (!Number.isFinite(seats) || seats < 1) { setErrorMessage('Please enter a valid number of seats'); return }
      if (!createForm.event_id) { setErrorMessage('Please select an event'); return }
      setSubmittingBooking(true)
      try {
        const response = await fetch('/api/foh/event-bookings', {
          method: 'POST', headers: getFohBookingClientHeaders(),
          body: JSON.stringify({
            customer_mode: customerMode,
            customer_id: selectedCustomer?.id || undefined, phone: createForm.phone.trim() || undefined,
            email: createForm.email.trim() || undefined,
            first_name: firstName, last_name: lastName, walk_in: isWalkIn || undefined,
            walk_in_guest_name: isWalkIn ? createForm.customer_name.trim() || undefined : undefined,
            default_country_code: DEFAULT_COUNTRY_CODE, event_id: createForm.event_id, seats,
            seating_preference:
              selectedEventOption?.booking_mode === 'communal'
                ? createForm.seating_preference
                : undefined
          })
        })
        const payload = (await response.json()) as FohCreateEventBookingResponse
        if (response.status === 409 && payload.code === FOH_CLIENT_OUTDATED_CODE) {
          window.location.reload()
          throw new Error(payload.error || 'The FOH screen was updated. Reloading now.')
        }
        if (!response.ok) throw new Error(payload.error || 'Failed to create event booking')
        if (!payload.success || !payload.data) throw new Error('Failed to create event booking')
        if (payload.data.state === 'blocked') { setErrorMessage(mapFohEventBlockedReason(payload.data.reason)); return }
        if (payload.data.state === 'full_with_waitlist_option') {
          const remainingText = typeof payload.data.seats_remaining === 'number' ? ` (${payload.data.seats_remaining} seats left)` : ''
          setErrorMessage(`This event is full for that seat request${remainingText}.`); return
        }
        // Written for someone standing at the bar with a guest in front of
        // them. The old version led with the raw booking UUID, which is not
        // something anybody reads out or checks, and phrased the outcome as
        // "was created and confirmed" when what the person needs to know is who
        // is in, for what, and where to sit them.
        let tableName = payload.data.table_name
        let walkInTableMoveText = ''
        if (isWalkIn && walkInTargetTable?.id && payload.data.table_booking_id) {
          try {
            await postBookingAction(`/api/foh/bookings/${payload.data.table_booking_id}/move-table`, { table_id: walkInTargetTable.id })
            tableName = walkInTargetTable.name
          } catch (moveError) {
            walkInTableMoveText = ` Could not put them on ${walkInTargetTable.name}: ${moveError instanceof Error ? moveError.message : 'the table assignment did not update'}.`
          }
        }

        const who = (firstName || selectedCustomer?.first_name || '').trim() || 'Guest'
        const seatWord = seats === 1 ? 'seat' : 'seats'
        const eventName = payload.data.event_name
        const forEvent = eventName ? ` for ${eventName}` : ''
        const tableSentence = tableName
          ? isSameDayWalkIn
            ? ` Sat on ${tableName}.`
            : ` They are on ${tableName}.`
          : ''

        const headline =
          payload.data.state === 'pending_payment'
            ? `${who} has ${seats} ${seatWord} held${forEvent}, waiting on payment.`
            : isSameDayWalkIn
              ? `${who} is in${forEvent} with ${seats} ${seatWord}.`
              : `${who} is booked in${forEvent} with ${seats} ${seatWord}.`

        const paymentLinkText = payload.data.next_step_url ? ` Payment link: ${payload.data.next_step_url}` : ''
        const manageLinkText = payload.data.manage_booking_url ? ` Manage link: ${payload.data.manage_booking_url}` : ''
        setStatusMessage(`${headline}${tableSentence}${walkInTableMoveText}${paymentLinkText}${manageLinkText}`)
        closeCreateModal()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to create event booking')
      } finally { setSubmittingBooking(false) }
      return
    }

    const partySize = Number.parseInt(createForm.party_size, 10)
    if (!Number.isFinite(partySize) || partySize < 1) { setErrorMessage('Please enter a valid party size'); return }
    if (!isWalkIn && overlappingEventForTable && tableEventPromptAcknowledgedEventId !== overlappingEventForTable.id) {
      setErrorMessage('Please confirm whether this booking is for the overlapping event.'); return
    }
    // An unanswered live period must not be submitted, because saying nothing
    // would reach the server as though staff had declined it on the guest's
    // behalf, quietly booking the normal menu at normal terms.
    if (seasonalPeriod?.bookable && seasonalAnswer === null) {
      setErrorMessage(`Please answer: ${seasonalPeriod.guest_question}`)
      return
    }

    const requiresDepositValidation =
      (!isWalkIn && !isManagement && !createForm.is_venue_event) &&
      requiresDepositForParty(partySize, {
        depositWaived: createForm.waive_deposit === true,
        isChristmas: isChristmasBooking,
      })
    if (requiresDepositValidation && !createForm.sunday_deposit_method) {
      setErrorMessage('Choose whether the deposit was taken in cash or should be sent by payment link.'); return
    }
    setSubmittingBooking(true)
    try {
      const response = await fetch('/api/foh/bookings', {
        method: 'POST', headers: getFohBookingClientHeaders(),
        body: JSON.stringify({
          customer_mode: customerMode,
          customer_id: selectedCustomer?.id || undefined,
          phone: isManagement ? undefined : createForm.phone.trim() || undefined,
          email: isManagement ? undefined : createForm.email.trim() || undefined,
          first_name: isManagement ? undefined : firstName, last_name: isManagement ? undefined : lastName,
          walk_in: isWalkIn || undefined, walk_in_guest_name: isWalkIn ? createForm.customer_name.trim() || undefined : undefined,
          management_override: isManagement || undefined, default_country_code: DEFAULT_COUNTRY_CODE,
          date: bookingDate, time: effectiveBookingTime, party_size: partySize,
          purpose: isChristmasBooking ? 'christmas' : createForm.purpose === 'drinks' ? 'drinks' : 'food',
          notes: createForm.notes || undefined,
          sunday_deposit_method: (!isWalkIn && !isManagement && !createForm.is_venue_event && requiresDepositForParty(partySize, { depositWaived: createForm.waive_deposit === true, isChristmas: isChristmasBooking })) ? createForm.sunday_deposit_method : undefined,
          waive_deposit: createForm.waive_deposit || undefined, is_venue_event: createForm.is_venue_event || undefined,
          bypass_pacing: createForm.bypass_pacing || undefined,
          // The seasonal answer, as an inseparable pair. `false` is a real
          // answer (the normal menu at normal terms), so this tests the type and
          // never the truthiness. Absent for Christmas, which travels as a
          // purpose, and absent when nobody was asked.
          ...(seasonalPeriod && typeof seasonalAnswer === 'boolean'
            ? { booking_period_id: seasonalPeriod.id, booking_period_answer: seasonalAnswer }
            : {})
        })
      })
      const payload = (await response.json()) as FohCreateBookingResponse
      if (response.status === 409 && payload.code === FOH_CLIENT_OUTDATED_CODE) {
        window.location.reload()
        throw new Error(payload.error || 'The FOH screen was updated. Reloading now.')
      }
      if (!response.ok) throw new Error(payload.error || 'Failed to create booking')
      if (!payload.success || !payload.data) throw new Error('Failed to create booking')
      if (payload.data.state === 'blocked') { setErrorMessage(mapFohBlockedReason(payload.data.blocked_reason, payload.data.reason)); return }
      const bookingRef = payload.data.booking_reference || payload.data.table_booking_id || 'booking'
      const outcome = payload.data.state === 'pending_payment' ? 'reserved and awaiting deposit payment' : isSameDayWalkIn ? 'created, confirmed and seated' : 'created and confirmed'
      let tableText = payload.data.table_name ? ` on ${payload.data.table_name}` : ''
      let walkInTableMoveText = ''
      if (isWalkIn && walkInTargetTable?.id && payload.data.table_booking_id) {
        try {
          await postBookingAction(`/api/foh/bookings/${payload.data.table_booking_id}/move-table`, { table_id: walkInTargetTable.id })
          tableText = ` on ${walkInTargetTable.name}`
        } catch (moveError) {
          walkInTableMoveText = ` (created but not moved to ${walkInTargetTable.name}: ${moveError instanceof Error ? moveError.message : 'table assignment update failed'})`
        }
      }
      const paymentLinkText = payload.data.state === 'pending_payment' && payload.data.next_step_url ? ` Deposit link: ${payload.data.next_step_url}` : ''
      await reloadSchedule()
      const bookingLabel = isManagement ? 'Management booking' : isWalkIn ? 'Walk-in booking' : 'Table booking'
      setStatusMessage(`${bookingLabel} ${bookingRef}${tableText}${walkInTableMoveText} was ${outcome}.${paymentLinkText}`)
      closeCreateModal()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create booking')
    } finally { setSubmittingBooking(false) }
  }

  return {
    isCreateModalOpen, createMode, createForm, walkInTargetTable, submittingBooking,
    searchingCustomers, customerQuery, completedCustomerSearchQuery, customerResults, selectedCustomer,
    eventOptions, loadingEventOptions, eventOptionsError,
    walkInPurposeAutoSelectionEnabled, tableEventPromptAcknowledgedEventId,
    selectedEventOption,
    overlappingEventForTable, formRequiresDeposit,
    seasonalPeriod, seasonalAnswer, setSeasonalAnswer,
    setCreateForm, setCustomerQuery, setSelectedCustomer, setCustomerResults,
    setTableEventPromptAcknowledgedEventId,
    setWalkInPurposeAutoSelectionEnabled,
    openCreateModal, closeCreateModal, handleCreateBooking,
  }
}
