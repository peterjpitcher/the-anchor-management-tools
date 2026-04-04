'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  FohCreateMode,
  FohCustomerSearchResult,
  FohEventOption,
  FohScheduleResponse,
  SundayMenuItem,
  TimelineRange,
  WalkInTargetTable,
} from '../types'
import type { CreateForm } from '../components/FohCreateBookingModal'
import {
  DEFAULT_COUNTRY_CODE,
  getTableWindowMs,
  isSundayDate,
  mapFohBlockedReason,
  mapFohEventBlockedReason,
  postBookingAction,
  resolveWalkInDefaults,
  splitName,
  suggestWalkInTime,
} from '../utils'
import type { FohCreateBookingResponse, FohCreateEventBookingResponse } from '../types'

export type UseFohCreateBookingReturn = {
  isCreateModalOpen: boolean
  createMode: FohCreateMode
  createForm: CreateForm
  walkInTargetTable: WalkInTargetTable | null
  submittingBooking: boolean
  searchingCustomers: boolean
  customerQuery: string
  customerResults: FohCustomerSearchResult[]
  selectedCustomer: FohCustomerSearchResult | null
  sundayMenuItems: SundayMenuItem[]
  loadingSundayMenu: boolean
  sundayMenuError: string | null
  sundayPreorderQuantities: Record<string, string>
  eventOptions: FohEventOption[]
  loadingEventOptions: boolean
  eventOptionsError: string | null
  walkInPurposeAutoSelectionEnabled: boolean
  tableEventPromptAcknowledgedEventId: string | null
  hasLoadedSundayMenu: boolean
  // Computed
  sundayMenuByCategory: Record<string, SundayMenuItem[]>
  sundaySelectedItemCount: number
  selectedEventOption: FohEventOption | null
  overlappingEventForTable: FohEventOption | null
  formRequiresDeposit: boolean
  // Actions
  setCreateForm: (updater: (current: CreateForm) => CreateForm) => void
  setCustomerQuery: (query: string) => void
  setSelectedCustomer: (customer: FohCustomerSearchResult | null) => void
  setCustomerResults: (results: FohCustomerSearchResult[]) => void
  setSundayPreorderQuantities: (updater: (current: Record<string, string>) => Record<string, string>) => void
  setTableEventPromptAcknowledgedEventId: (id: string | null) => void
  setWalkInPurposeAutoSelectionEnabled: (enabled: boolean) => void
  openCreateModal: (options?: {
    mode?: FohCreateMode; laneTableId?: string; laneTableName?: string; suggestedTime?: string
    prefill?: Partial<Pick<CreateForm, 'booking_date' | 'purpose' | 'event_id'>>
  }) => void
  closeCreateModal: () => void
  handleCreateBooking: (event: FormEvent<HTMLFormElement>) => void
  retrySundayMenu: () => void
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
  const [customerResults, setCustomerResults] = useState<FohCustomerSearchResult[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<FohCustomerSearchResult | null>(null)
  const [sundayMenuItems, setSundayMenuItems] = useState<SundayMenuItem[]>([])
  const [loadingSundayMenu, setLoadingSundayMenu] = useState(false)
  const [hasLoadedSundayMenu, setHasLoadedSundayMenu] = useState(false)
  const [sundayMenuError, setSundayMenuError] = useState<string | null>(null)
  const [sundayPreorderQuantities, setSundayPreorderQuantities] = useState<Record<string, string>>({})
  const [eventOptions, setEventOptions] = useState<FohEventOption[]>([])
  const [loadingEventOptions, setLoadingEventOptions] = useState(false)
  const [eventOptionsError, setEventOptionsError] = useState<string | null>(null)
  const [walkInPurposeAutoSelectionEnabled, setWalkInPurposeAutoSelectionEnabled] = useState(false)
  const [tableEventPromptAcknowledgedEventId, setTableEventPromptAcknowledgedEventId] = useState<string | null>(null)

  const [createForm, setCreateForm] = useState<CreateForm>({
    booking_date: date,
    event_id: '',
    phone: '',
    customer_name: '',
    first_name: '',
    last_name: '',
    time: '19:00',
    party_size: '2',
    purpose: 'food' as 'food' | 'drinks' | 'event',
    sunday_lunch: false,
    sunday_deposit_method: 'payment_link' as 'payment_link' | 'cash',
    sunday_preorder_mode: 'send_link' as 'send_link' | 'capture_now',
    notes: '',
    waive_deposit: false,
    is_venue_event: false
  })

  // --- Customer search ---
  useEffect(() => {
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
        }
      } catch {
        if (!cancelled) setCustomerResults([])
      } finally {
        if (!cancelled) setSearchingCustomers(false)
      }
    }, 280)
    return () => { cancelled = true; window.clearTimeout(timeoutId) }
  }, [customerQuery, selectedCustomer])

  // --- Sunday date guard ---
  useEffect(() => {
    if (isSundayDate(createForm.booking_date)) return
    setCreateForm((current) => ({
      ...current, sunday_lunch: false, sunday_deposit_method: 'payment_link', sunday_preorder_mode: 'send_link'
    }))
    setSundayPreorderQuantities({})
  }, [createForm.booking_date])

  // --- Sunday menu loader ---
  useEffect(() => {
    if (!isCreateModalOpen || !createForm.sunday_lunch || !isSundayDate(createForm.booking_date)) return
    if (hasLoadedSundayMenu || loadingSundayMenu) return
    let cancelled = false
    const controller = new AbortController()
    let timeoutId: number | null = null
    const loadSundayMenu = async () => {
      setLoadingSundayMenu(true)
      setSundayMenuError(null)
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => { controller.abort(); reject(new Error('Loading Sunday lunch menu timed out. Please retry.')) }, 12_000)
        })
        const response = (await Promise.race([
          fetch('/api/foh/sunday-preorder/menu', { cache: 'no-store', signal: controller.signal }),
          timeoutPromise
        ])) as Response
        if (timeoutId != null) { window.clearTimeout(timeoutId); timeoutId = null }
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load Sunday lunch menu')
        if (!cancelled) setSundayMenuItems(Array.isArray(payload?.data) ? payload.data as SundayMenuItem[] : [])
      } catch (error) {
        if (!cancelled) setSundayMenuError(error instanceof Error ? error.message : 'Failed to load Sunday lunch menu')
      } finally {
        if (timeoutId != null) { window.clearTimeout(timeoutId); timeoutId = null }
        if (!cancelled) { setLoadingSundayMenu(false); setHasLoadedSundayMenu(true) }
      }
    }
    void loadSundayMenu()
    return () => { cancelled = true; if (timeoutId != null) window.clearTimeout(timeoutId); controller.abort() }
  }, [createForm.booking_date, createForm.sunday_lunch, hasLoadedSundayMenu, isCreateModalOpen, loadingSundayMenu])

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

  // --- Sync create form date with service date ---
  useEffect(() => {
    if (isCreateModalOpen) return
    setCreateForm((current) => ({ ...current, booking_date: date }))
  }, [date, isCreateModalOpen])

  // --- Overlapping event prompt acknowledgement guard ---
  const sundaySelected = isSundayDate(createForm.booking_date)
  const formRequiresDeposit =
    createMode !== 'management' && !createForm.is_venue_event &&
    ((createForm.sunday_lunch && sundaySelected) || (createMode !== 'walk_in' && Number(createForm.party_size) >= 7))

  const sundayMenuByCategory = useMemo(() => {
    return sundayMenuItems.reduce<Record<string, SundayMenuItem[]>>((acc, item) => {
      const category = item.category_name || 'Other'
      if (!acc[category]) acc[category] = []
      acc[category].push(item)
      return acc
    }, {})
  }, [sundayMenuItems])

  const sundaySelectedItemCount = useMemo(() => {
    return sundayMenuItems.reduce((count, item) => {
      const quantity = Number.parseInt(sundayPreorderQuantities[item.menu_dish_id] || '0', 10)
      return count + (Number.isFinite(quantity) && quantity > 0 ? 1 : 0)
    }, 0)
  }, [sundayMenuItems, sundayPreorderQuantities])

  const selectedEventOption = useMemo(
    () => eventOptions.find((eo) => eo.id === createForm.event_id) || null,
    [createForm.event_id, eventOptions]
  )

  const overlappingEventForTable = useMemo(() => {
    if (createForm.purpose === 'event') return null
    const tablePurpose = createForm.purpose === 'drinks' ? 'drinks' : 'food'
    const tableWindow = getTableWindowMs({
      bookingDate: createForm.booking_date, bookingTime: createForm.time,
      purpose: tablePurpose, sundayLunch: createForm.sunday_lunch
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
  }, [createForm.booking_date, createForm.purpose, createForm.sunday_lunch, createForm.time, eventOptions])

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
      return { ...current, purpose: nextPurpose, event_id: nextEventId, time: nextTime, sunday_lunch: false, sunday_deposit_method: 'payment_link' }
    })
  }, [clockNow, createMode, isCreateModalOpen, resolveCurrentWalkInDefaults, walkInPurposeAutoSelectionEnabled])

  // --- Modal open/close ---
  function resetCreateModalState() {
    setCreateForm((current) => ({
      booking_date: date, event_id: '', phone: '', customer_name: '', first_name: '', last_name: '',
      time: current.time || '19:00', party_size: current.party_size || '2', purpose: 'food',
      sunday_lunch: false, sunday_deposit_method: 'payment_link', sunday_preorder_mode: 'send_link',
      notes: '', waive_deposit: false, is_venue_event: false
    }))
    setCreateMode('booking'); setWalkInTargetTable(null); setCustomerQuery(''); setCustomerResults([])
    setSelectedCustomer(null); setHasLoadedSundayMenu(false); setSundayMenuItems([]); setSundayPreorderQuantities({})
    setSundayMenuError(null); setEventOptions([]); setEventOptionsError(null)
    setWalkInPurposeAutoSelectionEnabled(false); setTableEventPromptAcknowledgedEventId(null)
  }

  function openCreateModal(options?: {
    mode?: FohCreateMode; laneTableId?: string; laneTableName?: string; suggestedTime?: string
    prefill?: Partial<Pick<CreateForm, 'booking_date' | 'purpose' | 'event_id'>>
  }) {
    const requestedMode = options?.mode || 'booking'
    const walkInMode = requestedMode === 'walk_in'
    const bookingDate = options?.prefill?.booking_date || date
    setErrorMessage(null); setStatusMessage(null); setCreateMode(requestedMode)
    setWalkInTargetTable(
      walkInMode && options?.laneTableId ? { id: options.laneTableId, name: options.laneTableName || 'selected table' } : null
    )
    const walkInDefaults = walkInMode ? resolveCurrentWalkInDefaults(date, clockNow) : null
    setCreateForm((current) => ({
      ...current, booking_date: bookingDate,
      time: walkInMode ? options?.suggestedTime || walkInDefaults?.time || current.time : options?.suggestedTime || current.time,
      purpose: walkInMode ? walkInDefaults?.purpose || 'food' : options?.prefill?.purpose || current.purpose,
      event_id: walkInMode ? options?.prefill?.event_id ?? walkInDefaults?.eventId ?? '' : options?.prefill?.event_id ?? current.event_id,
      sunday_lunch: walkInMode ? false : current.sunday_lunch,
      sunday_deposit_method: walkInMode ? 'payment_link' : current.sunday_deposit_method,
      phone: walkInMode ? '' : current.phone, customer_name: walkInMode ? '' : current.customer_name,
      first_name: walkInMode ? '' : current.first_name, last_name: walkInMode ? '' : current.last_name,
      notes: walkInMode ? '' : current.notes, waive_deposit: false, is_venue_event: false
    }))
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) { setErrorMessage('Please pick a valid booking date'); return }

    const effectiveBookingTime = isWalkIn
      ? suggestWalkInTime({ serviceDateIso: bookingDate, now: new Date(), serviceWindow: schedule?.service_window, timelineStartMin: timeline.startMin, timelineEndMin: timeline.endMin, purpose: createForm.purpose === 'drinks' ? 'drinks' : 'food' })
      : createForm.time

    if (isWalkIn && createForm.time !== effectiveBookingTime) {
      setCreateForm((current) => ({ ...current, time: effectiveBookingTime }))
    }
    if (isManagement && !selectedCustomer) { setErrorMessage('Select a customer for management booking'); return }
    if (!isWalkIn && !isManagement && !selectedCustomer && !createForm.phone.trim()) { setErrorMessage('Select a customer or provide a phone number'); return }

    const nameParts = splitName(createForm.customer_name)
    const firstName = createForm.first_name.trim() || nameParts.firstName || undefined
    const lastName = createForm.last_name.trim() || nameParts.lastName || undefined

    if (createForm.purpose === 'event') {
      const seats = Number.parseInt(createForm.party_size, 10)
      if (!Number.isFinite(seats) || seats < 1) { setErrorMessage('Please enter a valid number of seats'); return }
      if (!createForm.event_id) { setErrorMessage('Please select an event'); return }
      setSubmittingBooking(true)
      try {
        const response = await fetch('/api/foh/event-bookings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: selectedCustomer?.id || undefined, phone: createForm.phone.trim() || undefined,
            first_name: firstName, last_name: lastName, walk_in: isWalkIn || undefined,
            walk_in_guest_name: isWalkIn ? createForm.customer_name.trim() || undefined : undefined,
            default_country_code: DEFAULT_COUNTRY_CODE, event_id: createForm.event_id, seats
          })
        })
        const payload = (await response.json()) as FohCreateEventBookingResponse
        if (!response.ok) throw new Error(payload.error || 'Failed to create event booking')
        if (!payload.success || !payload.data) throw new Error('Failed to create event booking')
        if (payload.data.state === 'blocked') { setErrorMessage(mapFohEventBlockedReason(payload.data.reason)); return }
        if (payload.data.state === 'full_with_waitlist_option') {
          const remainingText = typeof payload.data.seats_remaining === 'number' ? ` (${payload.data.seats_remaining} seats left)` : ''
          setErrorMessage(`This event is full for that seat request${remainingText}.`); return
        }
        const bookingRef = payload.data.booking_id || 'booking'
        const eventNameText = payload.data.event_name ? ` for ${payload.data.event_name}` : ''
        const outcome = payload.data.state === 'pending_payment' ? 'reserved and awaiting payment' : isWalkIn ? 'created, confirmed and seated' : 'created and confirmed'
        let tableText = payload.data.table_name ? ` Table: ${payload.data.table_name}.` : ''
        let walkInTableMoveText = ''
        if (isWalkIn && walkInTargetTable?.id && payload.data.table_booking_id) {
          try {
            await postBookingAction(`/api/foh/bookings/${payload.data.table_booking_id}/move-table`, { table_id: walkInTargetTable.id })
            tableText = ` Table: ${walkInTargetTable.name}.`
          } catch (moveError) {
            walkInTableMoveText = ` (booking created but not moved to ${walkInTargetTable.name}: ${moveError instanceof Error ? moveError.message : 'table assignment update failed'})`
          }
        }
        const paymentLinkText = payload.data.next_step_url ? ` Payment link: ${payload.data.next_step_url}` : ''
        const manageLinkText = payload.data.manage_booking_url ? ` Manage link: ${payload.data.manage_booking_url}` : ''
        const bookingLabel = isWalkIn ? 'Walk-in event booking' : 'Event booking'
        setStatusMessage(`${bookingLabel} ${bookingRef}${eventNameText} was ${outcome}.${tableText}${walkInTableMoveText}${paymentLinkText}${manageLinkText}`)
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
    const requiresDepositValidation =
      (!isWalkIn && !isManagement && !createForm.waive_deposit && !createForm.is_venue_event) &&
      ((createForm.sunday_lunch && sundaySelected) || partySize >= 7)
    if (requiresDepositValidation && !createForm.sunday_deposit_method) {
      setErrorMessage('Choose whether the deposit was taken in cash or should be sent by payment link.'); return
    }
    let sundayPreorderItems: Array<{ menu_dish_id: string; quantity: number }> = []
    if (createForm.sunday_lunch && createForm.sunday_preorder_mode === 'capture_now') {
      if (sundayMenuItems.length === 0) { setErrorMessage('Sunday lunch menu is unavailable right now. Choose "Send link by text" instead.'); return }
      sundayPreorderItems = sundayMenuItems.map((item) => {
        const quantity = Number.parseInt(sundayPreorderQuantities[item.menu_dish_id] || '0', 10)
        if (!Number.isFinite(quantity) || quantity <= 0) return null
        return { menu_dish_id: item.menu_dish_id, quantity }
      }).filter((item): item is { menu_dish_id: string; quantity: number } => Boolean(item))
      if (sundayPreorderItems.length === 0) { setErrorMessage('Add at least one Sunday lunch item or choose "Send link by text".'); return }
    }
    setSubmittingBooking(true)
    try {
      const response = await fetch('/api/foh/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomer?.id || undefined,
          phone: isManagement ? undefined : createForm.phone.trim() || undefined,
          first_name: isManagement ? undefined : firstName, last_name: isManagement ? undefined : lastName,
          walk_in: isWalkIn || undefined, walk_in_guest_name: isWalkIn ? createForm.customer_name.trim() || undefined : undefined,
          management_override: isManagement || undefined, default_country_code: DEFAULT_COUNTRY_CODE,
          date: bookingDate, time: effectiveBookingTime, party_size: partySize,
          purpose: createForm.purpose === 'drinks' ? 'drinks' : 'food', notes: createForm.notes || undefined,
          sunday_lunch: isManagement ? undefined : createForm.sunday_lunch,
          sunday_deposit_method: (!isWalkIn && !isManagement && !createForm.waive_deposit && !createForm.is_venue_event && (createForm.sunday_lunch || partySize >= 7)) ? createForm.sunday_deposit_method : undefined,
          sunday_preorder_mode: (!isManagement && createForm.sunday_lunch) ? createForm.sunday_preorder_mode : undefined,
          sunday_preorder_items: (!isManagement && sundayPreorderItems.length > 0) ? sundayPreorderItems : undefined,
          waive_deposit: createForm.waive_deposit || undefined, is_venue_event: createForm.is_venue_event || undefined
        })
      })
      const payload = (await response.json()) as FohCreateBookingResponse
      if (!response.ok) throw new Error(payload.error || 'Failed to create booking')
      if (!payload.success || !payload.data) throw new Error('Failed to create booking')
      if (payload.data.state === 'blocked') { setErrorMessage(mapFohBlockedReason(payload.data.blocked_reason, payload.data.reason)); return }
      const bookingRef = payload.data.booking_reference || payload.data.table_booking_id || 'booking'
      const outcome = payload.data.state === 'pending_payment' ? 'reserved and awaiting deposit payment' : isWalkIn ? 'created, confirmed and seated' : 'created and confirmed'
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
      let sundayPreorderText = ''
      if (createForm.sunday_lunch) {
        if (payload.data.sunday_preorder_state === 'captured') sundayPreorderText = ' Sunday pre-order captured.'
        else if (payload.data.sunday_preorder_state === 'link_sent') sundayPreorderText = ' Sunday pre-order link sent by text.'
        else if (payload.data.sunday_preorder_state === 'capture_blocked') sundayPreorderText = ' Sunday pre-order could not be captured.'
        else if (payload.data.sunday_preorder_state === 'link_not_sent') sundayPreorderText = ' Sunday pre-order link could not be sent.'
      }
      const paymentLinkText = payload.data.state === 'pending_payment' && payload.data.next_step_url ? ` Deposit link: ${payload.data.next_step_url}` : ''
      await reloadSchedule()
      const bookingLabel = isManagement ? 'Management booking' : isWalkIn ? 'Walk-in booking' : 'Table booking'
      setStatusMessage(`${bookingLabel} ${bookingRef}${tableText}${walkInTableMoveText} was ${outcome}.${paymentLinkText}${sundayPreorderText}`)
      closeCreateModal()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create booking')
    } finally { setSubmittingBooking(false) }
  }

  return {
    isCreateModalOpen, createMode, createForm, walkInTargetTable, submittingBooking,
    searchingCustomers, customerQuery, customerResults, selectedCustomer,
    sundayMenuItems, loadingSundayMenu, sundayMenuError, sundayPreorderQuantities,
    eventOptions, loadingEventOptions, eventOptionsError,
    walkInPurposeAutoSelectionEnabled, tableEventPromptAcknowledgedEventId,
    hasLoadedSundayMenu,
    sundayMenuByCategory, sundaySelectedItemCount, selectedEventOption,
    overlappingEventForTable, formRequiresDeposit,
    setCreateForm, setCustomerQuery, setSelectedCustomer, setCustomerResults,
    setSundayPreorderQuantities, setTableEventPromptAcknowledgedEventId,
    setWalkInPurposeAutoSelectionEnabled,
    openCreateModal, closeCreateModal, handleCreateBooking,
    retrySundayMenu: () => { setSundayMenuError(null); setHasLoadedSundayMenu(false) },
  }
}
