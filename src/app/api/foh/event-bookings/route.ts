import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { sendManagerTableBookingCreatedEmailIfAllowed } from '@/lib/table-bookings/bookings'
import { logger } from '@/lib/logger'
import {
  isSundayLunchOnlyEvent,
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE
} from '@/lib/events/sunday-lunch-only-policy'

const CreateFohEventBookingSchema = z.object({
  customer_id: z.string().uuid().optional(),
  phone: z.string().trim().min(7).max(32).optional(),
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
  walk_in: z.boolean().optional(),
  walk_in_guest_name: z.string().trim().max(120).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  event_id: z.string().uuid(),
  seats: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  )
}).superRefine((value, context) => {
  if (!value.customer_id && !value.phone && value.walk_in !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide a customer or phone number'
    })
  }
})

type EventBookingResult = {
  state: 'confirmed' | 'pending_payment' | 'full_with_waitlist_option' | 'blocked'
  booking_id?: string
  status?: string
  payment_mode?: 'free' | 'cash_only' | 'prepaid'
  event_id?: string
  event_name?: string
  event_start_datetime?: string
  hold_expires_at?: string
  seats_remaining?: number
  reason?: string
}

type EventTableReservationResult = {
  state?: 'confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  booking_reference?: string
  table_name?: string
  start_datetime?: string
  end_datetime?: string
}

type FohEventBookingResponseData = {
  state: 'confirmed' | 'pending_payment' | 'full_with_waitlist_option' | 'blocked'
  booking_id: string | null
  reason: string | null
  seats_remaining: number | null
  next_step_url: string | null
  manage_booking_url: string | null
  event_name: string | null
  payment_mode: 'free' | 'cash_only' | 'prepaid' | null
  booking_mode: 'table' | 'general' | 'mixed' | null
  table_booking_id: string | null
  table_name: string | null
}

function normalizeEventBookingMode(value: unknown): 'table' | 'general' | 'mixed' {
  if (value === 'general' || value === 'mixed' || value === 'table') {
    return value
  }
  return 'table'
}

function formatLondonDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return 'your event time'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(isoDateTime))
  } catch {
    return 'your event time'
  }
}

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
  supabase: ReturnType<typeof createAdminClient>,
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

function buildEventBookingSms(
  state: EventBookingResult['state'],
  payload: {
    firstName: string
    eventName: string
    seats: number
    eventStart: string
    paymentMode?: EventBookingResult['payment_mode']
    paymentLink?: string | null
    manageLink?: string | null
  }
): string {
  const seatWord = payload.seats === 1 ? 'seat' : 'seats'

  if (state === 'pending_payment') {
    if (payload.paymentLink) {
      return `The Anchor: Hi ${payload.firstName}, we're holding ${payload.seats} ${seatWord} for ${payload.eventName}. Pay here: ${payload.paymentLink}.${payload.manageLink ? ` Manage booking: ${payload.manageLink}` : ''}`
    }

    return `The Anchor: Hi ${payload.firstName}, we're holding ${payload.seats} ${seatWord} for ${payload.eventName}. Your booking is pending payment and we'll text your payment link shortly.${payload.manageLink ? ` Manage booking: ${payload.manageLink}` : ''}`
  }

  const confirmedTail =
    payload.paymentMode === 'cash_only'
      ? ' Payment is cash on arrival.'
      : ''

  return `The Anchor: Hi ${payload.firstName}, your booking for ${payload.eventName} on ${payload.eventStart} is confirmed for ${payload.seats} ${seatWord}.${confirmedTail}${payload.manageLink ? ` Manage booking: ${payload.manageLink}` : ''}`
}

async function sendBookingSmsIfAllowed(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  normalizedPhone: string,
  bookingResult: EventBookingResult,
  seats: number,
  paymentLink?: string | null,
  manageLink?: string | null
): Promise<void> {
  const { data: customer, error } = await (supabase.from('customers') as any)
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', customerId)
    .maybeSingle()

  if (error || !customer) {
    logger.warn('Unable to load customer for FOH event booking SMS', {
      metadata: { customerId, error: error?.message }
    })
    return
  }

  if (customer.sms_status !== 'active') {
    return
  }

  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const eventName = bookingResult.event_name || 'your event'
  const eventStart = formatLondonDateTime(bookingResult.event_start_datetime)
  const firstName = customer.first_name || 'there'

  const smsBody = ensureReplyInstruction(
    buildEventBookingSms(bookingResult.state, {
      firstName,
      eventName,
      seats,
      eventStart,
      paymentMode: bookingResult.payment_mode,
      paymentLink,
      manageLink
    }),
    supportPhone
  )

  const to = customer.mobile_number || normalizedPhone

  const smsResult = await sendSMS(to, smsBody, {
    customerId,
    metadata: {
      event_booking_id: bookingResult.booking_id,
      event_id: bookingResult.event_id,
      template_key: bookingResult.state === 'pending_payment' ? 'event_booking_pending_payment' : 'event_booking_confirmed'
    }
  })

  if (!smsResult.success) {
    logger.warn('Failed to send FOH event booking SMS', {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        error: smsResult.error || 'Unknown SMS error'
      }
    })
  }
}

async function cancelEventBookingAfterTableReservationFailure(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string
): Promise<void> {
  const cancelledAt = new Date().toISOString()

  await Promise.allSettled([
    (supabase.from('bookings') as any)
      .update({
        status: 'cancelled',
        cancelled_at: cancelledAt,
        cancelled_by: 'system',
        updated_at: cancelledAt
      })
      .eq('id', bookingId),
    (supabase.from('booking_holds') as any)
      .update({
        status: 'released',
        released_at: cancelledAt,
        updated_at: cancelledAt
      })
      .eq('event_booking_id', bookingId)
      .eq('hold_type', 'payment_hold')
      .eq('status', 'active')
  ])
}

async function markTableBookingSeated(
  supabase: ReturnType<typeof createAdminClient>,
  tableBookingId: string
): Promise<void> {
  const nowIso = new Date().toISOString()
  const { error } = await (supabase.from('table_bookings') as any)
    .update({
      seated_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', tableBookingId)
    .is('seated_at', null)

  if (error) {
    throw error
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

  const parsed = CreateFohEventBookingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid event booking payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const payload = parsed.data
  const { data: eventRow, error: eventLookupError } = await auth.supabase
    .from('events')
    .select('id, booking_mode, name, date, start_datetime')
    .eq('id', payload.event_id)
    .maybeSingle()

  if (eventLookupError) {
    return NextResponse.json({ error: 'Failed to load event details' }, { status: 500 })
  }

  if (!eventRow) {
    return NextResponse.json({ error: 'Selected event could not be found' }, { status: 404 })
  }

  if (
    isSundayLunchOnlyEvent({
      id: (eventRow as any).id || null,
      name: (eventRow as any).name || null,
      date: (eventRow as any).date || null,
      start_datetime: (eventRow as any).start_datetime || null
    })
  ) {
    return NextResponse.json({ error: SUNDAY_LUNCH_ONLY_EVENT_MESSAGE }, { status: 409 })
  }

  const bookingMode = normalizeEventBookingMode((eventRow as any).booking_mode)

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
      logger.error('Failed to create walk-in customer profile for event booking', {
        error: walkInError instanceof Error ? walkInError : new Error('Unknown walk-in customer error'),
        metadata: {
          userId: auth.userId
        }
      })
      return NextResponse.json({ error: 'Failed to prepare walk-in booking' }, { status: 500 })
    }
  }

  if (!customerId) {
    return NextResponse.json({ error: 'Failed to resolve customer' }, { status: 500 })
  }

  const { data: rpcResultRaw, error: rpcError } = await auth.supabase.rpc('create_event_booking_v05', {
    p_event_id: payload.event_id,
    p_customer_id: customerId,
    p_seats: payload.seats,
    p_source: payload.walk_in === true ? 'walk-in' : 'admin'
  })

  if (rpcError) {
    logger.error('create_event_booking_v05 RPC failed for FOH create', {
      error: new Error(rpcError.message),
      metadata: { userId: auth.userId, eventId: payload.event_id, customerId }
    })
    return NextResponse.json({ error: 'Failed to create event booking' }, { status: 500 })
  }

  const bookingResult = (rpcResultRaw ?? {}) as EventBookingResult
  const state = bookingResult.state || 'blocked'
  let resolvedState: FohEventBookingResponseData['state'] = state
  let resolvedReason = bookingResult.reason || null
  let tableBookingId: string | null = null
  let tableName: string | null = null
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  let nextStepUrl: string | null = null
  let manageUrl: string | null = null

  if (
    state === 'pending_payment' &&
    bookingResult.booking_id &&
    bookingResult.hold_expires_at
  ) {
    try {
      const paymentToken = await createEventPaymentToken(auth.supabase, {
        customerId,
        bookingId: bookingResult.booking_id,
        holdExpiresAt: bookingResult.hold_expires_at,
        appBaseUrl
      })
      nextStepUrl = paymentToken.url
    } catch (error) {
      logger.warn('Failed to create event payment token for FOH create', {
        metadata: {
          bookingId: bookingResult.booking_id,
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  if (
    (state === 'confirmed' || state === 'pending_payment') &&
    bookingResult.booking_id &&
    bookingResult.event_start_datetime
  ) {
    try {
      const manageToken = await createEventManageToken(auth.supabase, {
        customerId,
        bookingId: bookingResult.booking_id,
        eventStartIso: bookingResult.event_start_datetime,
        appBaseUrl
      })
      manageUrl = manageToken.url
    } catch (error) {
      logger.warn('Failed to create event manage token for FOH create', {
        metadata: {
          bookingId: bookingResult.booking_id,
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  if (
    resolvedState === 'confirmed' &&
    bookingMode !== 'general' &&
    bookingResult.booking_id
  ) {
    const { data: tableReservationRaw, error: tableReservationError } = await auth.supabase.rpc(
      'create_event_table_reservation_v05',
      {
        p_event_id: payload.event_id,
        p_event_booking_id: bookingResult.booking_id,
        p_customer_id: customerId,
        p_party_size: payload.seats,
        p_source: payload.walk_in === true ? 'walk-in' : 'admin',
        p_notes: `Event booking ${bookingResult.booking_id}`
      }
    )

    const tableReservation = (tableReservationRaw || {}) as EventTableReservationResult
    const tableReservationState = tableReservation.state || 'blocked'

    if (tableReservationError || tableReservationState !== 'confirmed') {
      await cancelEventBookingAfterTableReservationFailure(auth.supabase, bookingResult.booking_id)
      resolvedState = 'blocked'
      resolvedReason =
        tableReservation.reason ||
        (tableReservationError ? 'no_table' : bookingResult.reason || 'no_table')
      nextStepUrl = null
      manageUrl = null
    } else {
      tableBookingId = tableReservation.table_booking_id || null
      tableName = tableReservation.table_name || null
    }
  }

  if (
    payload.walk_in === true &&
    resolvedState === 'confirmed' &&
    tableBookingId
  ) {
    try {
      await markTableBookingSeated(auth.supabase, tableBookingId)
    } catch (seatError) {
      logger.warn('Failed to auto-mark walk-in event table booking as seated', {
        metadata: {
          userId: auth.userId,
          tableBookingId,
          error: seatError instanceof Error ? seatError.message : String(seatError)
        }
      })
    }
  }

  if (resolvedState === 'confirmed' || resolvedState === 'pending_payment') {
    const analyticsTasks: Promise<unknown>[] = [
      recordAnalyticsEvent(auth.supabase, {
        customerId,
        eventType: 'event_booking_created',
        eventBookingId: bookingResult.booking_id,
        metadata: {
          event_id: payload.event_id,
          seats: payload.seats,
          state: resolvedState,
          payment_mode: bookingResult.payment_mode || null,
          booking_mode: bookingMode,
          table_booking_id: tableBookingId,
          source: 'foh'
        }
      })
    ]

    if (tableBookingId) {
      analyticsTasks.push(
        recordAnalyticsEvent(auth.supabase, {
          customerId,
          tableBookingId,
          eventType: 'table_booking_created',
          metadata: {
            booking_purpose: 'event',
            linked_event_booking_id: bookingResult.booking_id,
            event_id: payload.event_id,
            source: 'foh'
          }
        })
      )

      analyticsTasks.push(
        sendManagerTableBookingCreatedEmailIfAllowed(auth.supabase, {
          tableBookingId,
          fallbackCustomerId: customerId,
          createdVia: payload.walk_in === true ? 'foh_event_walk_in' : 'foh_event'
        }).then((result) => {
          if (!result.sent && result.error) {
            logger.warn('Failed to send manager booking-created email for FOH event booking', {
              metadata: {
                userId: auth.userId,
                tableBookingId,
                error: result.error
              }
            })
          }
        })
      )
    }

    if (shouldSendBookingSms && normalizedPhone) {
      analyticsTasks.push(
        sendBookingSmsIfAllowed(
          auth.supabase,
          customerId,
          normalizedPhone,
          bookingResult,
          payload.seats,
          nextStepUrl,
          manageUrl
        )
      )
    }

    await Promise.allSettled(analyticsTasks)
  }

  const responseStatus = resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? 201 : 200

  return NextResponse.json(
    {
      success: true,
      data: {
        state: resolvedState,
        booking_id: bookingResult.booking_id ?? null,
        reason: resolvedReason,
        seats_remaining: bookingResult.seats_remaining ?? null,
        next_step_url: nextStepUrl,
        manage_booking_url: manageUrl,
        event_name: bookingResult.event_name ?? null,
        payment_mode: bookingResult.payment_mode ?? null,
        booking_mode: bookingMode,
        table_booking_id: tableBookingId,
        table_name: tableName
      } satisfies FohEventBookingResponseData
    },
    { status: responseStatus }
  )
}
