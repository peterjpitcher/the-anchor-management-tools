import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { fromZonedTime } from 'date-fns-tz'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  alignTableCardCaptureHoldToScheduledSend,
  createTableCardCaptureToken,
  mapTableBookingBlockedReason,
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendSundayPreorderLinkSmsIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
  type TableBookingRpcResult
} from '@/lib/table-bookings/bookings'
import { saveSundayPreorderByBookingId } from '@/lib/table-bookings/sunday-preorder'

const SundayPreorderItemSchema = z.object({
  menu_dish_id: z.string().uuid(),
  quantity: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(25)
  )
})

const CreateFohTableBookingSchema = z.object({
  customer_id: z.string().uuid().optional(),
  phone: z.string().trim().min(7).max(32).optional(),
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
  walk_in: z.boolean().optional(),
  walk_in_guest_name: z.string().trim().max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(50)
  ),
  purpose: z.enum(['food', 'drinks']),
  notes: z.string().trim().max(500).optional(),
  sunday_lunch: z.boolean().optional(),
  sunday_preorder_mode: z.enum(['send_link', 'capture_now']).optional(),
  sunday_preorder_items: z.array(SundayPreorderItemSchema).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional()
}).superRefine((value, context) => {
  if (!value.customer_id && !value.phone && value.walk_in !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide a customer or phone number'
    })
  }

  if (value.sunday_preorder_mode === 'capture_now') {
    if (value.sunday_lunch !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Capture now can only be used for Sunday lunch bookings'
      })
      return
    }

    if ((value.sunday_preorder_items || []).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add at least one Sunday lunch item or choose send link'
      })
    }
  }
})

function splitWalkInGuestName(fullName: string | null | undefined): {
  firstName?: string
  lastName?: string
} {
  if (!fullName) {
    return {}
  }

  const cleaned = fullName.trim()
  if (!cleaned) {
    return {}
  }

  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return {}
  }

  if (parts.length === 1) {
    return { firstName: parts[0] }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  }
}

function isSundayIsoDate(dateIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false
  const parsed = new Date(`${dateIso}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.getUTCDay() === 0
}

async function shouldAutoPromoteSundayLunchForFoh(input: {
  supabase: any
  bookingDate: string
  bookingTime: string
  purpose: 'food' | 'drinks'
  sundayLunchExplicit: boolean
  userId: string
}): Promise<boolean> {
  if (input.sundayLunchExplicit || input.purpose !== 'food' || !isSundayIsoDate(input.bookingDate)) {
    return false
  }

  const [regularWindowResult, sundayWindowResult] = await Promise.all([
    input.supabase.rpc('table_booking_matches_service_window_v05', {
      p_booking_date: input.bookingDate,
      p_booking_time: input.bookingTime,
      p_booking_purpose: input.purpose,
      p_sunday_lunch: false
    }),
    input.supabase.rpc('table_booking_matches_service_window_v05', {
      p_booking_date: input.bookingDate,
      p_booking_time: input.bookingTime,
      p_booking_purpose: input.purpose,
      p_sunday_lunch: true
    })
  ])

  if (regularWindowResult.error || sundayWindowResult.error) {
    logger.warn('Failed to evaluate FOH Sunday lunch auto-promotion window checks', {
      metadata: {
        userId: input.userId,
        bookingDate: input.bookingDate,
        bookingTime: input.bookingTime,
        regularError: regularWindowResult.error?.message || null,
        sundayError: sundayWindowResult.error?.message || null
      }
    })
    return false
  }

  const regularMatches = regularWindowResult.data === true
  const sundayMatches = sundayWindowResult.data === true
  return !regularMatches && sundayMatches
}

async function createWalkInCustomer(
  supabase: any,
  input: {
    firstName?: string
    lastName?: string
    guestName?: string
  }
): Promise<{ customerId: string; syntheticPhone: string }> {
  const guestNameParts = splitWalkInGuestName(input.guestName)
  const firstName = input.firstName?.trim() || guestNameParts.firstName || 'Walk-in'
  const lastName = input.lastName?.trim() || guestNameParts.lastName || 'Guest'

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
    const syntheticPhone = `+447000${suffix}`

    const { data, error } = await (supabase.from('customers') as any)
      .insert({
        first_name: firstName,
        last_name: lastName,
        mobile_number: syntheticPhone,
        mobile_e164: syntheticPhone,
        sms_opt_in: false,
        sms_status: 'sms_deactivated'
      })
      .select('id')
      .maybeSingle()

    if (!error && data?.id) {
      return {
        customerId: data.id as string,
        syntheticPhone
      }
    }

    if ((error as { code?: string } | null)?.code === '23505') {
      continue
    }

    throw new Error('Failed to create walk-in customer')
  }

  throw new Error('Failed to reserve a walk-in customer profile')
}

function buildWalkInBookingReference(): string {
  return `TB-W${randomBytes(4).toString('hex').toUpperCase()}`
}

function getWalkInDurationMinutes(input: {
  purpose: 'food' | 'drinks'
  sundayLunch: boolean
}): number {
  if (input.sundayLunch) return 120
  return input.purpose === 'food' ? 120 : 90
}

async function createManualWalkInBookingOverride(params: {
  supabase: any
  customerId: string
  payload: {
    date: string
    time: string
    party_size: number
    purpose: 'food' | 'drinks'
    notes?: string
    sunday_lunch?: boolean
  }
}): Promise<TableBookingRpcResult> {
  const bookingTime = params.payload.time.length === 5 ? `${params.payload.time}:00` : params.payload.time
  const start = fromZonedTime(`${params.payload.date}T${bookingTime}`, 'Europe/London')
  const startMs = start.getTime()
  if (!Number.isFinite(startMs)) {
    throw new Error('Invalid walk-in booking time')
  }

  const durationMinutes = getWalkInDurationMinutes({
    purpose: params.payload.purpose,
    sundayLunch: params.payload.sunday_lunch === true
  })
  const startIso = start.toISOString()
  const endIso = new Date(startMs + durationMinutes * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()
  const bookingType = params.payload.sunday_lunch === true ? 'sunday_lunch' : 'regular'

  type TableCandidate = {
    id: string
    displayName: string
    capacity: number
  }

  type TableCombo = {
    tableIds: string[]
    tableNames: string[]
    totalCapacity: number
  }

  async function computeAvailableCombos(): Promise<TableCombo[]> {
    const [tablesResult, joinLinksResult] = await Promise.all([
      (params.supabase.from('tables') as any)
        .select('id, table_number, name, capacity, is_bookable')
        .order('table_number', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true, nullsFirst: false }),
      (params.supabase.from('table_join_links') as any)
        .select('table_id, join_table_id')
    ])

    if (tablesResult.error) {
      throw new Error('Failed to load tables for walk-in override allocation')
    }

    if (joinLinksResult.error) {
      throw new Error('Failed to load table join links for walk-in override allocation')
    }

    const partySize = Math.max(1, Number(params.payload.party_size || 1))
    const rawTables = (tablesResult.data || []) as any[]
    const candidates = rawTables
      .filter((row) => row?.id && row.is_bookable !== false)
      .map((row) => ({
        id: String(row.id),
        table_number: typeof row.table_number === 'string' ? row.table_number : null,
        name: typeof row.name === 'string' ? row.name : null,
        capacity: Math.max(0, Number(row.capacity || 0))
      }))
      .filter((row) => row.capacity > 0)

    if (candidates.length === 0) {
      return []
    }

    const candidateTableIds = candidates.map((row) => row.id)

    const { data: overlappingAssignments, error: overlapError } = await (params.supabase.from('booking_table_assignments') as any)
      .select('table_id, table_booking_id')
      .in('table_id', candidateTableIds)
      .lt('start_datetime', endIso)
      .gt('end_datetime', startIso)

    if (overlapError) {
      throw new Error('Failed to check walk-in override table overlaps')
    }

    const overlappingRows = (overlappingAssignments || []) as any[]
    const overlappingBookingIds = Array.from(
      new Set(
        overlappingRows
          .map((row) => (typeof row?.table_booking_id === 'string' ? row.table_booking_id : null))
          .filter((value): value is string => Boolean(value))
      )
    )

    const activeOverlappingBookingIds = new Set<string>()
    if (overlappingBookingIds.length > 0) {
      const { data: overlappingBookings, error: overlappingBookingsError } = await (params.supabase.from('table_bookings') as any)
        .select('id, status')
        .in('id', overlappingBookingIds)

      if (overlappingBookingsError) {
        throw new Error('Failed to check overlapping booking statuses for walk-in override')
      }

      for (const row of (overlappingBookings || []) as any[]) {
        if (typeof row?.id === 'string' && row.status !== 'cancelled') {
          activeOverlappingBookingIds.add(row.id)
        }
      }
    }

    const unavailableByAssignment = new Set<string>()
    for (const row of overlappingRows) {
      if (
        typeof row?.table_id === 'string'
        && typeof row?.table_booking_id === 'string'
        && activeOverlappingBookingIds.has(row.table_booking_id)
      ) {
        unavailableByAssignment.add(row.table_id)
      }
    }

    const unavailableByPrivateBlocks = new Set<string>()
    await Promise.all(
      candidates.map(async (table) => {
        const { data: privateBlockResult, error: privateBlockError } = await params.supabase.rpc(
          'is_table_blocked_by_private_booking_v05',
          {
            p_table_id: table.id,
            p_window_start: startIso,
            p_window_end: endIso,
            p_exclude_private_booking_id: null
          }
        )

        if (privateBlockError) {
          throw new Error('Failed to check private blocks for walk-in override')
        }

        if (privateBlockResult === true) {
          unavailableByPrivateBlocks.add(table.id)
        }
      })
    )

    const availableTables: TableCandidate[] = candidates
      .filter((table) => !unavailableByAssignment.has(table.id))
      .filter((table) => !unavailableByPrivateBlocks.has(table.id))
      .map((table) => ({
        id: table.id,
        displayName: table.name || table.table_number || `Table ${table.id.slice(0, 4)}`,
        capacity: table.capacity
      }))

    if (availableTables.length === 0) {
      return []
    }

    const availableById = new Map<string, TableCandidate>()
    for (const table of availableTables) {
      availableById.set(table.id, table)
    }

    const neighbors = new Map<string, Set<string>>()
    for (const row of (joinLinksResult.data || []) as any[]) {
      const a = typeof row?.table_id === 'string' ? row.table_id : null
      const b = typeof row?.join_table_id === 'string' ? row.join_table_id : null
      if (!a || !b) continue
      if (!availableById.has(a) || !availableById.has(b)) continue

      const aSet = neighbors.get(a) || new Set<string>()
      aSet.add(b)
      neighbors.set(a, aSet)

      const bSet = neighbors.get(b) || new Set<string>()
      bSet.add(a)
      neighbors.set(b, bSet)
    }

    const sortedIds = Array.from(availableById.keys()).sort((a, b) => a.localeCompare(b))
    const combos: TableCombo[] = []

    for (const table of availableTables) {
      if (table.capacity >= partySize) {
        combos.push({
          tableIds: [table.id],
          tableNames: [table.displayName],
          totalCapacity: table.capacity
        })
      }
    }

    function isConnectedToCombo(candidateId: string, existingIds: string[]): boolean {
      for (const existingId of existingIds) {
        if (neighbors.get(existingId)?.has(candidateId)) {
          return true
        }
      }
      return false
    }

    function dfs(currentIds: string[], lastIndex: number, totalCapacity: number, currentNames: string[]) {
      if (currentIds.length >= 2 && totalCapacity >= partySize) {
        combos.push({
          tableIds: [...currentIds],
          tableNames: [...currentNames],
          totalCapacity
        })
      }

      if (currentIds.length >= 4) return

      for (let idx = lastIndex + 1; idx < sortedIds.length; idx += 1) {
        const nextId = sortedIds[idx]
        if (!nextId) continue
        if (!isConnectedToCombo(nextId, currentIds)) continue
        const nextTable = availableById.get(nextId)
        if (!nextTable) continue

        dfs(
          [...currentIds, nextId],
          idx,
          totalCapacity + nextTable.capacity,
          [...currentNames, nextTable.displayName]
        )
      }
    }

    for (let idx = 0; idx < sortedIds.length; idx += 1) {
      const baseId = sortedIds[idx]
      const base = availableById.get(baseId)
      if (!base) continue
      dfs([baseId], idx, base.capacity, [base.displayName])
    }

    const filtered = combos
      .filter((combo) => combo.totalCapacity >= partySize)
      .sort((a, b) => {
        if (a.tableIds.length !== b.tableIds.length) {
          return a.tableIds.length - b.tableIds.length
        }
        if (a.totalCapacity !== b.totalCapacity) {
          return a.totalCapacity - b.totalCapacity
        }
        return a.tableNames.join(' + ').localeCompare(b.tableNames.join(' + '))
      })

    // De-dupe identical combos.
    const seen = new Set<string>()
    const deduped: TableCombo[] = []
    for (const combo of filtered) {
      const key = combo.tableIds.join(',')
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(combo)
    }

    return deduped
  }

  const combos = await computeAvailableCombos()
  if (combos.length === 0) {
    return {
      state: 'blocked',
      reason: 'no_table'
    }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bookingReference = buildWalkInBookingReference()
    const { data, error } = await (params.supabase.from('table_bookings') as any)
      .insert({
        customer_id: params.customerId,
        booking_reference: bookingReference,
        booking_date: params.payload.date,
        booking_time: bookingTime,
        booking_type: bookingType,
        status: 'confirmed',
        party_size: params.payload.party_size,
        special_requirements: params.payload.notes || null,
        duration_minutes: durationMinutes,
        source: 'walk-in',
        confirmed_at: nowIso,
        booking_purpose: params.payload.purpose,
        committed_party_size: params.payload.party_size,
        card_capture_required: false,
        seated_at: nowIso,
        start_datetime: startIso,
        end_datetime: endIso,
        created_at: nowIso,
        updated_at: nowIso
      })
      .select('id, booking_reference')
      .maybeSingle()

    if (!error && data?.id) {
      const tableBookingId = data.id as string

      for (const combo of combos) {
        const assignmentPayload = combo.tableIds.map((tableId) => ({
          table_booking_id: tableBookingId,
          table_id: tableId,
          start_datetime: startIso,
          end_datetime: endIso,
          created_at: nowIso
        }))

        const { error: assignmentError } = await (params.supabase.from('booking_table_assignments') as any)
          .insert(assignmentPayload)

        if (!assignmentError) {
          return {
            state: 'confirmed',
            table_booking_id: tableBookingId,
            booking_reference: (data.booking_reference as string) || bookingReference,
            status: 'confirmed',
            table_id: combo.tableIds[0],
            table_ids: combo.tableIds,
            table_name: combo.tableNames.join(' + '),
            table_names: combo.tableNames,
            tables_joined: combo.tableIds.length > 1,
            party_size: params.payload.party_size,
            booking_purpose: params.payload.purpose,
            booking_type: bookingType,
            start_datetime: startIso,
            end_datetime: endIso,
            hold_expires_at: undefined,
            card_capture_required: false,
            sunday_lunch: params.payload.sunday_lunch === true
          }
        }

        if (isAssignmentConflictRpcError(assignmentError)) {
          continue
        }

        throw assignmentError
      }

      // If we couldn't assign any table combo (race condition), clean up the inserted booking.
      const cleanupOutcomes = await Promise.allSettled([
        (params.supabase.from('booking_table_assignments') as any)
          .delete()
          .eq('table_booking_id', tableBookingId),
        (params.supabase.from('table_bookings') as any)
          .delete()
          .eq('id', tableBookingId)
          .select('id')
          .maybeSingle()
      ])

      const cleanupLabels = ['booking_table_assignments_delete', 'table_bookings_delete']
      const cleanupErrors: string[] = []
      cleanupOutcomes.forEach((outcome, index) => {
        const label = cleanupLabels[index] || `cleanup_step_${index}`
        if (outcome.status === 'rejected') {
          const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
          cleanupErrors.push(`${label}:rejected:${message}`)
          return
        }

        const value = outcome.value as { data?: any; error?: { message?: string } | null } | null
        if (value?.error?.message) {
          cleanupErrors.push(`${label}:${value.error.message}`)
          return
        }

        if (label === 'table_bookings_delete' && !value?.data?.id) {
          cleanupErrors.push(`${label}:no_row_deleted`)
        }
      })

      if (cleanupErrors.length > 0) {
        // Fail closed by marking the booking cancelled if delete did not succeed, so it won't block
        // future availability checks (those ignore cancelled bookings).
        try {
          const { data: cancelledRow, error: cancelError } = await (params.supabase.from('table_bookings') as any)
            .update({
              status: 'cancelled',
              cancellation_reason: 'walk_in_override_cleanup_failed',
              cancelled_at: nowIso,
              updated_at: nowIso
            })
            .eq('id', tableBookingId)
            .select('id')
            .maybeSingle()

          if (cancelError) {
            cleanupErrors.push(`table_bookings_cancel:${cancelError.message || 'unknown_error'}`)
          } else if (!cancelledRow?.id) {
            cleanupErrors.push('table_bookings_cancel:no_row_updated')
          }
        } catch (cancelThrow) {
          const message = cancelThrow instanceof Error ? cancelThrow.message : String(cancelThrow)
          cleanupErrors.push(`table_bookings_cancel:rejected:${message}`)
        }

        logger.error('Walk-in override cleanup failed after table assignment race', {
          metadata: {
            tableBookingId,
            errors: cleanupErrors,
          }
        })
      }

      return {
        state: 'blocked',
        reason: 'no_table'
      }
    }

    if ((error as { code?: string } | null)?.code === '23505') {
      continue
    }

    throw error || new Error('Manual walk-in booking insert failed')
  }

  throw new Error('Failed to create manual walk-in booking')
}

async function markWalkInBookingAsSeated(
  supabase: any,
  bookingId: string
): Promise<void> {
  const nowIso = new Date().toISOString()
  const { data: seatedRow, error } = await (supabase.from('table_bookings') as any)
    .update({
      seated_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', bookingId)
    .is('seated_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!seatedRow) {
    throw new Error('Manual walk-in booking was not marked as seated')
  }
}

type FohCreateBookingResponseData = {
  state: 'confirmed' | 'pending_card_capture' | 'blocked'
  table_booking_id: string | null
  booking_reference: string | null
  reason: string | null
  blocked_reason:
    | 'outside_hours'
    | 'cut_off'
    | 'no_table'
    | 'private_booking_blocked'
    | 'too_large_party'
    | 'customer_conflict'
    | 'in_past'
    | 'blocked'
    | null
  next_step_url: string | null
  hold_expires_at: string | null
  table_name: string | null
  sunday_preorder_state:
    | 'not_applicable'
    | 'captured'
    | 'capture_blocked'
    | 'link_sent'
    | 'link_not_sent'
  sunday_preorder_reason: string | null
}

function isAssignmentConflictRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return (
    code === '23P01'
    || message.includes('table_assignment_overlap')
    || message.includes('table_assignment_private_blocked')
  )
}

async function recordFohTableBookingAnalyticsSafe(
  supabase: any,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
) {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record FOH table booking analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateFohTableBookingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid booking payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const payload = parsed.data

  let normalizedPhone: string | null = null
  let customerId: string | null = null
  let shouldSendBookingSms = true
  const walkInNameParts = splitWalkInGuestName(payload.walk_in_guest_name)
  const fallbackFirstName = payload.first_name || walkInNameParts.firstName
  const fallbackLastName = payload.last_name || walkInNameParts.lastName

  if (payload.customer_id) {
    const { data: selectedCustomer, error: selectedCustomerError } = await auth.supabase
      .from('customers')
      .select('id, mobile_e164, mobile_number')
      .eq('id', payload.customer_id)
      .maybeSingle()

    if (selectedCustomerError) {
      return NextResponse.json({ error: 'Failed to resolve selected customer' }, { status: 500 })
    }

    if (!selectedCustomer) {
      return NextResponse.json({ error: 'Selected customer was not found' }, { status: 404 })
    }

    let providedPhone: string | null = null
    if (payload.phone) {
      try {
        providedPhone = formatPhoneForStorage(payload.phone, {
          defaultCountryCode: payload.default_country_code
        })
      } catch {
        return NextResponse.json({ error: 'Please enter a valid phone number' }, { status: 400 })
      }
    }

    customerId = selectedCustomer.id
    normalizedPhone = selectedCustomer.mobile_e164 || selectedCustomer.mobile_number || providedPhone

    if (!normalizedPhone) {
      if (payload.walk_in === true) {
        shouldSendBookingSms = false
      } else {
        return NextResponse.json(
          { error: 'Selected customer has no phone number. Enter one before creating the booking.' },
          { status: 400 }
        )
      }
    }
  } else if (payload.phone) {
    try {
      normalizedPhone = formatPhoneForStorage(payload.phone || '', {
        defaultCountryCode: payload.default_country_code
      })
    } catch {
      return NextResponse.json({ error: 'Please enter a valid phone number' }, { status: 400 })
    }

    const customerResolution = await ensureCustomerForPhone(auth.supabase, normalizedPhone, {
      firstName: fallbackFirstName,
      lastName: fallbackLastName
    })
    customerId = customerResolution.customerId
  } else if (payload.walk_in === true) {
    try {
      const walkInCustomer = await createWalkInCustomer(auth.supabase, {
        firstName: fallbackFirstName,
        lastName: fallbackLastName,
        guestName: payload.walk_in_guest_name
      })
      customerId = walkInCustomer.customerId
      normalizedPhone = walkInCustomer.syntheticPhone
      shouldSendBookingSms = false
    } catch (walkInError) {
      logger.error('Failed to create walk-in customer profile', {
        error: walkInError instanceof Error ? walkInError : new Error('Unknown walk-in customer error'),
        metadata: {
          userId: auth.userId
        }
      })
      return NextResponse.json({ error: 'Failed to prepare walk-in booking' }, { status: 500 })
    }
  }

  const bookingTime = payload.time.length === 5 ? `${payload.time}:00` : payload.time

  if (!customerId) {
    return NextResponse.json({ error: 'Failed to resolve customer' }, { status: 500 })
  }

  let effectiveSundayLunch = payload.sunday_lunch === true
  if (!effectiveSundayLunch) {
    try {
      effectiveSundayLunch = await shouldAutoPromoteSundayLunchForFoh({
        supabase: auth.supabase,
        bookingDate: payload.date,
        bookingTime,
        purpose: payload.purpose,
        sundayLunchExplicit: payload.sunday_lunch === true,
        userId: auth.userId
      })
    } catch (promotionError) {
      logger.warn('Failed to evaluate FOH Sunday lunch auto-promotion', {
        metadata: {
          userId: auth.userId,
          bookingDate: payload.date,
          bookingTime,
          error: promotionError instanceof Error ? promotionError.message : String(promotionError)
        }
      })
      effectiveSundayLunch = false
    }
  }

  const { data: rpcResultRaw, error: rpcError } = await auth.supabase.rpc('create_table_booking_v05', {
    p_customer_id: customerId,
    p_booking_date: payload.date,
    p_booking_time: bookingTime,
    p_party_size: payload.party_size,
    p_booking_purpose: payload.purpose,
    p_notes: payload.notes || null,
    p_sunday_lunch: effectiveSundayLunch,
    p_source: payload.walk_in === true ? 'walk-in' : 'admin'
  })

  let bookingResult: TableBookingRpcResult
  if (rpcError) {
    if (isAssignmentConflictRpcError(rpcError)) {
      bookingResult = {
        state: 'blocked',
        reason: rpcError.message?.includes('table_assignment_private_blocked')
          ? 'private_booking_blocked'
          : 'no_table'
      }
    } else {
      logger.error('create_table_booking_v05 RPC failed for FOH create', {
        error: new Error(rpcError.message),
        metadata: {
          userId: auth.userId,
          customerId,
          bookingDate: payload.date,
          bookingTime,
          purpose: payload.purpose
        }
      })
      return NextResponse.json({ error: 'Failed to create table booking' }, { status: 500 })
    }
  } else {
    bookingResult = (rpcResultRaw ?? {}) as TableBookingRpcResult
  }
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  let nextStepUrl: string | null = null
  let holdExpiresAt = bookingResult.hold_expires_at || null
  let sundayPreorderState: FohCreateBookingResponseData['sunday_preorder_state'] = 'not_applicable'
  let sundayPreorderReason: string | null = null

  const shouldBypassHoursForWalkIn =
    payload.walk_in === true &&
    bookingResult.state === 'blocked' &&
    ['outside_hours', 'outside_service_window', 'cut_off', 'in_past', 'hours_not_configured'].includes(
      String(bookingResult.reason || '')
    )

  if (shouldBypassHoursForWalkIn) {
    try {
      bookingResult = await createManualWalkInBookingOverride({
        supabase: auth.supabase,
        customerId,
        payload: {
          date: payload.date,
          time: bookingTime,
          party_size: payload.party_size,
          purpose: payload.purpose,
          notes: payload.notes,
          sunday_lunch: effectiveSundayLunch
        }
      })
      shouldSendBookingSms = false
      holdExpiresAt = null
    } catch (walkInOverrideError) {
      const fallbackReason = bookingResult.reason || null
      logger.error('Manual walk-in booking override failed', {
        error:
          walkInOverrideError instanceof Error
            ? walkInOverrideError
            : new Error('Unknown walk-in override error'),
        metadata: {
          userId: auth.userId,
          customerId,
          bookingDate: payload.date,
          bookingTime,
          purpose: payload.purpose
        }
      })
      return NextResponse.json(
        {
          error: 'Failed to create walk-in booking override',
          reason: fallbackReason
        },
        { status: 500 }
      )
    }
  }

  if (
    payload.walk_in === true &&
    bookingResult.table_booking_id &&
    (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_card_capture')
  ) {
    try {
      await markWalkInBookingAsSeated(auth.supabase, bookingResult.table_booking_id)
    } catch (seatError) {
      logger.warn('Failed to auto-mark walk-in booking as seated', {
        metadata: {
          userId: auth.userId,
          tableBookingId: bookingResult.table_booking_id,
          error: seatError instanceof Error ? seatError.message : String(seatError)
        }
      })
    }
  }

  if (
    bookingResult.state === 'pending_card_capture' &&
    bookingResult.table_booking_id &&
    bookingResult.hold_expires_at
  ) {
    try {
      const token = await createTableCardCaptureToken(auth.supabase, {
        customerId,
        tableBookingId: bookingResult.table_booking_id,
        holdExpiresAt: bookingResult.hold_expires_at,
        appBaseUrl
      })
      nextStepUrl = token.url
    } catch (tokenError) {
      logger.warn('Failed to create table card-capture token for FOH create', {
        metadata: {
          tableBookingId: bookingResult.table_booking_id,
          error: tokenError instanceof Error ? tokenError.message : String(tokenError)
        }
      })
    }
  }

  if (
    shouldSendBookingSms &&
    normalizedPhone &&
    (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_card_capture')
  ) {
    const smsSendResult = await sendTableBookingCreatedSmsIfAllowed(auth.supabase, {
      customerId,
      normalizedPhone,
      bookingResult,
      nextStepUrl
    })

    if (
      bookingResult.state === 'pending_card_capture' &&
      bookingResult.table_booking_id &&
      smsSendResult.scheduledFor
    ) {
      holdExpiresAt =
        (await alignTableCardCaptureHoldToScheduledSend(auth.supabase, {
          tableBookingId: bookingResult.table_booking_id,
          scheduledSendIso: smsSendResult.scheduledFor,
          bookingStartIso: bookingResult.start_datetime || null
        })) || holdExpiresAt
    }

    await recordFohTableBookingAnalyticsSafe(auth.supabase, {
      customerId,
      tableBookingId: bookingResult.table_booking_id,
      eventType: 'table_booking_created',
      metadata: {
        party_size: payload.party_size,
        booking_purpose: payload.purpose,
        sunday_lunch: effectiveSundayLunch,
        status: bookingResult.status || bookingResult.state,
        table_name: bookingResult.table_name || null,
        source: 'foh'
      }
    }, {
      userId: auth.userId,
      customerId,
      tableBookingId: bookingResult.table_booking_id,
      eventType: 'table_booking_created'
    })

    if (bookingResult.state === 'pending_card_capture') {
      await recordFohTableBookingAnalyticsSafe(auth.supabase, {
        customerId,
        tableBookingId: bookingResult.table_booking_id,
        eventType: 'card_capture_started',
        metadata: {
          hold_expires_at: holdExpiresAt,
          next_step_url_provided: Boolean(nextStepUrl),
          source: 'foh'
        }
      }, {
        userId: auth.userId,
        customerId,
        tableBookingId: bookingResult.table_booking_id,
        eventType: 'card_capture_started'
      })
    }
  }

  if (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_card_capture') {
    const managerEmailResult = await sendManagerTableBookingCreatedEmailIfAllowed(auth.supabase, {
      tableBookingId: bookingResult.table_booking_id || null,
      fallbackCustomerId: customerId,
      createdVia: payload.walk_in === true ? 'foh_walk_in' : 'foh'
    })
    if (!managerEmailResult.sent && managerEmailResult.error) {
      logger.warn('Failed to send manager booking-created email for FOH booking', {
        metadata: {
          userId: auth.userId,
          tableBookingId: bookingResult.table_booking_id || null,
          error: managerEmailResult.error
        }
      })
    }
  }

  const shouldHandleSundayPreorder =
    effectiveSundayLunch &&
    (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_card_capture') &&
    Boolean(bookingResult.table_booking_id)

  if (shouldHandleSundayPreorder && bookingResult.table_booking_id) {
    const mode = payload.sunday_lunch === true
      ? payload.sunday_preorder_mode || 'send_link'
      : 'send_link'

    if (mode === 'capture_now') {
      let captureResult: Awaited<ReturnType<typeof saveSundayPreorderByBookingId>> | null = null
      try {
        captureResult = await saveSundayPreorderByBookingId(auth.supabase, {
          bookingId: bookingResult.table_booking_id,
          items: payload.sunday_preorder_items || []
        })
      } catch (captureError) {
        logger.warn('Failed to capture Sunday pre-order during FOH booking create', {
          metadata: {
            userId: auth.userId,
            tableBookingId: bookingResult.table_booking_id,
            error: captureError instanceof Error ? captureError.message : String(captureError),
          }
        })
        // Keep the response fail-safe: the table booking is already committed, and returning
        // 500 encourages operator retries that can create duplicates.
        sundayPreorderReason = 'capture_exception'
      }

      if (captureResult?.state === 'saved') {
        sundayPreorderState = 'captured'
      } else {
        if (!sundayPreorderReason) {
          sundayPreorderReason = captureResult?.reason || 'capture_failed'
        }

        try {
          const fallbackLink = await sendSundayPreorderLinkSmsIfAllowed(auth.supabase, {
            customerId,
            tableBookingId: bookingResult.table_booking_id,
            bookingStartIso: bookingResult.start_datetime || null,
            bookingReference: bookingResult.booking_reference || null,
            appBaseUrl
          })

          if (fallbackLink.sent) {
            sundayPreorderState = 'link_sent'
            sundayPreorderReason = `capture_failed:${sundayPreorderReason}`
          } else {
            sundayPreorderState = 'capture_blocked'
          }
        } catch (fallbackError) {
          logger.warn('Failed to send Sunday pre-order fallback link after capture failure', {
            metadata: {
              userId: auth.userId,
              tableBookingId: bookingResult.table_booking_id,
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            }
          })
          sundayPreorderState = 'capture_blocked'
        }
      }
    } else {
      try {
        const linkResult = await sendSundayPreorderLinkSmsIfAllowed(auth.supabase, {
          customerId,
          tableBookingId: bookingResult.table_booking_id,
          bookingStartIso: bookingResult.start_datetime || null,
          bookingReference: bookingResult.booking_reference || null,
          appBaseUrl
        })

        sundayPreorderState = linkResult.sent ? 'link_sent' : 'link_not_sent'
        if (!linkResult.sent) {
          sundayPreorderReason = 'link_not_sent'
        }
      } catch (linkError) {
        logger.warn('Failed to send Sunday pre-order link during FOH booking create', {
          metadata: {
            userId: auth.userId,
            tableBookingId: bookingResult.table_booking_id,
            error: linkError instanceof Error ? linkError.message : String(linkError),
          }
        })
        sundayPreorderState = 'link_not_sent'
        sundayPreorderReason = 'link_exception'
      }
    }
  }

  const responseState: FohCreateBookingResponseData['state'] =
    bookingResult.state === 'confirmed' || bookingResult.state === 'pending_card_capture'
      ? bookingResult.state
      : 'blocked'

  const responseStatus = responseState === 'blocked' ? 200 : 201

  return NextResponse.json(
    {
      success: true,
      data: {
        state: responseState,
        table_booking_id: bookingResult.table_booking_id || null,
        booking_reference: bookingResult.booking_reference || null,
        reason: bookingResult.reason || null,
        blocked_reason:
          responseState === 'blocked' ? mapTableBookingBlockedReason(bookingResult.reason) : null,
        next_step_url: responseState === 'pending_card_capture' ? nextStepUrl : null,
        hold_expires_at: responseState === 'pending_card_capture' ? holdExpiresAt : null,
        table_name: bookingResult.table_name || null,
        sunday_preorder_state: sundayPreorderState,
        sunday_preorder_reason: sundayPreorderReason
      } satisfies FohCreateBookingResponseData
    },
    { status: responseStatus }
  )
}
