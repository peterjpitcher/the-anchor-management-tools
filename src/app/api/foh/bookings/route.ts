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
      return {
        state: 'confirmed',
        table_booking_id: data.id as string,
        booking_reference: (data.booking_reference as string) || bookingReference,
        status: 'confirmed',
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
  const { error } = await (supabase.from('table_bookings') as any)
    .update({
      seated_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', bookingId)
    .is('seated_at', null)

  if (error) {
    throw error
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

  const { data: rpcResultRaw, error: rpcError } = await auth.supabase.rpc('create_table_booking_v05', {
    p_customer_id: customerId,
    p_booking_date: payload.date,
    p_booking_time: bookingTime,
    p_party_size: payload.party_size,
    p_booking_purpose: payload.purpose,
    p_notes: payload.notes || null,
    p_sunday_lunch: payload.sunday_lunch === true,
    p_source: payload.walk_in === true ? 'walk-in' : 'admin'
  })

  if (rpcError) {
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

  let bookingResult = (rpcResultRaw ?? {}) as TableBookingRpcResult
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
          sunday_lunch: payload.sunday_lunch
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
          error:
            walkInOverrideError instanceof Error
              ? walkInOverrideError.message || 'Failed to create walk-in booking override'
              : 'Failed to create walk-in booking override',
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

    await recordAnalyticsEvent(auth.supabase, {
      customerId,
      tableBookingId: bookingResult.table_booking_id,
      eventType: 'table_booking_created',
      metadata: {
        party_size: payload.party_size,
        booking_purpose: payload.purpose,
        sunday_lunch: payload.sunday_lunch === true,
        status: bookingResult.status || bookingResult.state,
        table_name: bookingResult.table_name || null,
        source: 'foh'
      }
    })

    if (bookingResult.state === 'pending_card_capture') {
      await recordAnalyticsEvent(auth.supabase, {
        customerId,
        tableBookingId: bookingResult.table_booking_id,
        eventType: 'card_capture_started',
        metadata: {
          hold_expires_at: holdExpiresAt,
          next_step_url_provided: Boolean(nextStepUrl),
          source: 'foh'
        }
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
    payload.sunday_lunch === true &&
    (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_card_capture') &&
    Boolean(bookingResult.table_booking_id)

  if (shouldHandleSundayPreorder && bookingResult.table_booking_id) {
    const mode = payload.sunday_preorder_mode || 'send_link'

    if (mode === 'capture_now') {
      const captureResult = await saveSundayPreorderByBookingId(auth.supabase, {
        bookingId: bookingResult.table_booking_id,
        items: payload.sunday_preorder_items || []
      })

      if (captureResult.state === 'saved') {
        sundayPreorderState = 'captured'
      } else {
        sundayPreorderReason = captureResult.reason || 'capture_failed'
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
      }
    } else {
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
