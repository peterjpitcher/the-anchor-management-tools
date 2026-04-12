import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { sendManagerTableBookingCreatedEmailIfAllowed } from '@/lib/table-bookings/bookings'
import { logger } from '@/lib/logger'
import {
  isSundayLunchOnlyEvent,
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE
} from '@/lib/events/sunday-lunch-only-policy'
import { EventBookingService } from '@/services/event-bookings'

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

// ─── FOH-specific helpers ─────────────────────────────────────────────────────

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

    const { data, error } = await supabase.from('customers')
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

async function markTableBookingSeated(
  supabase: ReturnType<typeof createAdminClient>,
  tableBookingId: string
): Promise<void> {
  const nowIso = new Date().toISOString()
  const { data: seatedRow, error } = await supabase.from('table_bookings')
    .update({
      seated_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', tableBookingId)
    .is('seated_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!seatedRow) {
    throw new Error('Table booking could not be marked as seated')
  }
}

async function recordFohAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
): Promise<void> {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record FOH event booking analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

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
      id: eventRow.id || null,
      name: eventRow.name || null,
      date: eventRow.date || null,
      start_datetime: eventRow.start_datetime || null
    })
  ) {
    return NextResponse.json({ error: SUNDAY_LUNCH_ONLY_EVENT_MESSAGE }, { status: 409 })
  }

  const bookingMode = EventBookingService.normalizeBookingMode(eventRow.booking_mode)

  // ── Resolve customer ────────────────────────────────────────────────────────
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

  // ── Delegate booking creation to shared service ─────────────────────────────
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const source = payload.walk_in === true ? 'walk-in' : 'admin'

  const result = await EventBookingService.createBooking({
    eventId: payload.event_id,
    customerId,
    normalizedPhone: normalizedPhone ?? '',
    seats: payload.seats,
    source,
    bookingMode,
    appBaseUrl,
    shouldSendSms: shouldSendBookingSms && Boolean(normalizedPhone),
    supabaseClient: auth.supabase,
    logTag: 'FOH event booking',  // lowercase; capitalised automatically in service log messages
    firstName: fallbackFirstName || undefined
  })

  if (result.rpcFailed) {
    logger.error('create_event_booking_v05 RPC failed for FOH create', {
      metadata: { userId: auth.userId, eventId: payload.event_id, customerId }
    })
    return NextResponse.json({ error: 'Failed to create event booking' }, { status: 500 })
  }

  if (result.rollbackFailed) {
    return NextResponse.json(
      { error: 'Failed to finalize booking after table reservation conflict' },
      { status: 500 }
    )
  }

  // For FOH, payment link failure is a warning (not a hard error) — the manager
  // can still see the booking and send the link manually.
  if (result.paymentLinkFailed) {
    logger.warn('Failed to create event payment token for FOH create', {
      metadata: { bookingId: result.bookingId }
    })
  }

  const {
    resolvedState,
    resolvedReason,
    bookingId,
    seatsRemaining,
    nextStepUrl,
    manageUrl,
    smsMeta,
    tableBookingId,
    tableName,
    rpcResult
  } = result

  // ── Walk-in: auto-mark table booking as seated ──────────────────────────────
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

  // ── FOH-specific side effects (analytics + manager email) ───────────────────
  if (resolvedState === 'confirmed' || resolvedState === 'pending_payment') {
    type SideEffectTask = { label: string; promise: Promise<unknown> }

    const sideEffectTasks: SideEffectTask[] = [
      {
        label: 'analytics:event_booking_created',
        promise: recordFohAnalyticsSafe(
          auth.supabase,
          {
            customerId,
            eventType: 'event_booking_created',
            eventBookingId: bookingId ?? undefined,
            metadata: {
              event_id: payload.event_id,
              seats: payload.seats,
              state: resolvedState,
              payment_mode: rpcResult.payment_mode || null,
              booking_mode: bookingMode,
              table_booking_id: tableBookingId,
              source: 'foh'
            }
          },
          {
            userId: auth.userId,
            customerId,
            eventBookingId: bookingId,
            eventId: payload.event_id,
            state: resolvedState
          }
        )
      }
    ]

    if (tableBookingId) {
      sideEffectTasks.push({
        label: 'analytics:table_booking_created',
        promise: recordFohAnalyticsSafe(
          auth.supabase,
          {
            customerId,
            tableBookingId,
            eventType: 'table_booking_created',
            metadata: {
              booking_purpose: 'event',
              linked_event_booking_id: bookingId,
              event_id: payload.event_id,
              source: 'foh'
            }
          },
          {
            userId: auth.userId,
            customerId,
            tableBookingId,
            eventBookingId: bookingId,
            eventId: payload.event_id
          }
        )
      })

      sideEffectTasks.push({
        label: 'email:manager_table_booking_created',
        promise: sendManagerTableBookingCreatedEmailIfAllowed(auth.supabase, {
          tableBookingId,
          fallbackCustomerId: customerId,
          createdVia: payload.walk_in === true ? 'foh_event_walk_in' : 'foh_event'
        }).then((emailResult) => {
          if (!emailResult.sent && emailResult.error) {
            logger.warn('Failed to send manager booking-created email for FOH event booking', {
              metadata: {
                userId: auth.userId,
                tableBookingId,
                error: emailResult.error
              }
            })
          }
        })
      })
    }

    const sideEffectOutcomes = await Promise.allSettled(
      sideEffectTasks.map((task) => task.promise)
    )
    sideEffectOutcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
        logger.warn('FOH event booking side-effect task rejected unexpectedly', {
          metadata: {
            label: sideEffectTasks[index]?.label || `task_${index}`,
            bookingId,
            customerId,
            tableBookingId,
            state: resolvedState,
            error: reason
          }
        })
      }
    })
  }

  const responseStatus = resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? 201 : 200

  return NextResponse.json(
    {
      success: true,
      data: {
        state: resolvedState,
        booking_id: bookingId ?? null,
        reason: resolvedReason,
        seats_remaining: seatsRemaining ?? null,
        next_step_url: nextStepUrl,
        manage_booking_url: manageUrl,
        event_name: rpcResult.event_name ?? null,
        payment_mode: rpcResult.payment_mode ?? null,
        booking_mode: bookingMode,
        table_booking_id: tableBookingId,
        table_name: tableName
      } satisfies FohEventBookingResponseData,
      meta: {
        status_code: responseStatus,
        sms: smsMeta
      }
    },
    { status: responseStatus }
  )
}
