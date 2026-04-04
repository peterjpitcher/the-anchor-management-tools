import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventBookingSource = 'brand_site' | 'admin' | 'walk-in' | 'sms_reply'

export type EventBookingRpcResult = {
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

export type EventTableReservationRpcResult = {
  state?: 'confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  booking_reference?: string
  table_name?: string
  start_datetime?: string
  end_datetime?: string
}

export type SmsSafetyMeta =
  | {
      success: boolean
      code: string | null
      logFailure: boolean
    }
  | null

export type CreateBookingParams = {
  /** UUID of the event to book */
  eventId: string
  /** UUID of the resolved customer */
  customerId: string
  /** Normalised E.164 phone number — used as fallback if customer row has none */
  normalizedPhone: string
  /** Number of seats to reserve */
  seats: number
  /** Booking source forwarded to the RPC as p_source */
  source: EventBookingSource
  /** Booking mode resolved from the event row prior to this call */
  bookingMode: 'table' | 'general' | 'mixed'
  /** Base URL for payment/manage token generation (e.g. process.env.NEXT_PUBLIC_APP_URL) */
  appBaseUrl: string
  /**
   * Whether to send a booking confirmation SMS.
   * Walk-in customers and customers with no real phone should pass false.
   */
  shouldSendSms?: boolean
  /**
   * Supabase admin client. Callers that already hold a client (e.g. from
   * requireFohPermission) should pass it in to avoid creating a second connection.
   * If omitted, createAdminClient() is called internally.
   */
  supabaseClient?: ReturnType<typeof createAdminClient>
  /**
   * Prefix used in log messages. Should be lowercase — it is capitalised
   * automatically where a message starts with it.
   * Default: "event booking".
   * FOH route passes: "FOH event booking".
   */
  logTag?: string
}

export type CreateBookingResult = {
  resolvedState: EventBookingRpcResult['state']
  resolvedReason: string | null
  bookingId: string | null
  seatsRemaining: number | null
  nextStepUrl: string | null
  manageUrl: string | null
  smsMeta: SmsSafetyMeta
  tableBookingId: string | null
  tableName: string | null
  /** Full RPC result for callers that need extra fields (event_name, payment_mode, etc.) */
  rpcResult: EventBookingRpcResult
  /**
   * Callers should return HTTP 500 when this is true — it means the booking was
   * created but payment-link generation failed (pending_payment only).
   */
  paymentLinkFailed?: boolean
  /**
   * Callers should return HTTP 500 when this is true — it means the RPC itself failed.
   */
  rpcFailed?: boolean
  /**
   * Callers should return HTTP 500 when this is true — the table-reservation rollback
   * could not be completed, leaving the system in a partially inconsistent state.
   */
  rollbackFailed?: boolean
}

// ─── Helpers (module-private) ─────────────────────────────────────────────────

function normalizeBookingMode(value: unknown): 'table' | 'general' | 'mixed' {
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

function buildEventBookingSms(
  state: EventBookingRpcResult['state'],
  payload: {
    firstName: string
    eventName: string
    seats: number
    eventStart: string
    paymentMode?: EventBookingRpcResult['payment_mode']
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
    payload.paymentMode === 'cash_only' ? ' Payment is cash on arrival.' : ''

  return `The Anchor: Hi ${payload.firstName}, your booking for ${payload.eventName} on ${payload.eventStart} is confirmed for ${payload.seats} ${seatWord}.${confirmedTail}${payload.manageLink ? ` Manage booking: ${payload.manageLink}` : ''}`
}

async function sendBookingSmsIfAllowed(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  normalizedPhone: string,
  bookingResult: EventBookingRpcResult,
  seats: number,
  paymentLink: string | null | undefined,
  manageLink: string | null | undefined,
  /** Log tag, e.g. "event booking" or "FOH event booking" */
  logTag: string
): Promise<SmsSafetyMeta> {
  // Capitalise first char for sentence-start messages; preserve acronyms like "FOH".
  const logTagCap = logTag.charAt(0).toUpperCase() + logTag.slice(1)
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', customerId)
    .maybeSingle()

  if (error || !customer) {
    logger.warn('Unable to load customer for event booking SMS', {
      metadata: { customerId, error: error?.message }
    })
    return null
  }

  if (customer.sms_status !== 'active') {
    logger.info('Skipped event booking SMS due to sms_status', {
      metadata: { customerId, sms_status: customer.sms_status }
    })
    return null
  }

  const supportPhone =
    process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const eventName = bookingResult.event_name || 'your event'
  const eventStart = formatLondonDateTime(bookingResult.event_start_datetime)
  const firstName = getSmartFirstName(customer.first_name)

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

  let smsResult: Awaited<ReturnType<typeof sendSMS>>
  try {
    smsResult = await sendSMS(to, smsBody, {
      customerId,
      metadata: {
        event_booking_id: bookingResult.booking_id,
        event_id: bookingResult.event_id,
        template_key:
          bookingResult.state === 'pending_payment'
            ? 'event_booking_pending_payment'
            : 'event_booking_confirmed'
      }
    })
  } catch (smsError) {
    logger.warn(`${logTagCap} SMS threw unexpectedly`, {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        error: smsError instanceof Error ? smsError.message : String(smsError)
      }
    })
    return { success: false, code: 'unexpected_exception', logFailure: false }
  }

  const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
  const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
  const smsDeliveredOrUnknown = smsResult.success === true || smsLogFailure

  if (smsLogFailure) {
    logger.error(`${logTagCap} SMS sent but outbound message logging failed`, {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        code: smsCode,
        logFailure: smsLogFailure
      }
    })
  }

  if (!smsResult.success && !smsLogFailure) {
    logger.warn(`Failed to send ${logTag} SMS`, {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        error: smsResult.error || 'Unknown SMS error',
        code: smsCode
      }
    })
  }

  return { success: smsDeliveredOrUnknown, code: smsCode, logFailure: smsLogFailure }
}

async function cancelBookingAfterTableReservationFailure(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string
): Promise<void> {
  const cancelledAt = new Date().toISOString()
  const rollbackErrors: string[] = []

  const [bookingCancelResult, holdReleaseResult] = await Promise.all([
    supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: cancelledAt,
        cancelled_by: 'system',
        updated_at: cancelledAt
      })
      .eq('id', bookingId)
      .select('id')
      .maybeSingle(),
    supabase
      .from('booking_holds')
      .update({
        status: 'released',
        released_at: cancelledAt,
        updated_at: cancelledAt
      })
      .eq('event_booking_id', bookingId)
      .eq('hold_type', 'payment_hold')
      .eq('status', 'active')
      .select('id')
  ])

  if (bookingCancelResult?.error?.message) {
    rollbackErrors.push(`booking_cancel: ${bookingCancelResult.error.message}`)
  } else if (!bookingCancelResult?.data) {
    rollbackErrors.push('booking_cancel: booking row no longer exists')
  }

  if (holdReleaseResult?.error?.message) {
    rollbackErrors.push(`payment_hold_release: ${holdReleaseResult.error.message}`)
  } else if (!Array.isArray(holdReleaseResult?.data)) {
    rollbackErrors.push('payment_hold_release: mutation_result_unavailable')
  } else if (holdReleaseResult.data.length === 0) {
    const { data: remainingActiveHolds, error: remainingActiveHoldsError } = await supabase
      .from('booking_holds')
      .select('id')
      .eq('event_booking_id', bookingId)
      .eq('hold_type', 'payment_hold')
      .eq('status', 'active')

    if (remainingActiveHoldsError?.message) {
      rollbackErrors.push(
        `payment_hold_release: verification_error:${remainingActiveHoldsError.message}`
      )
    } else if (!Array.isArray(remainingActiveHolds)) {
      rollbackErrors.push('payment_hold_release: verification_result_unavailable')
    } else if (remainingActiveHolds.length > 0) {
      rollbackErrors.push(
        `payment_hold_release: active_rows_remaining:${remainingActiveHolds.length}`
      )
    }
  }

  if (rollbackErrors.length > 0) {
    throw new Error(
      `Failed rolling back event booking after table reservation failure: ${rollbackErrors.join('; ')}`
    )
  }
}

async function recordAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
): Promise<void> {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record event booking analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EventBookingService {
  /**
   * Create an event booking via the create_event_booking_v05 RPC.
   *
   * Shared by the public API (brand_site), FOH API (admin / walk-in), and the
   * SMS reply-to-book webhook (sms_reply — Phase 5).
   *
   * Handles:
   *   - RPC call with all required parameters
   *   - Table reservation for table/mixed booking modes
   *   - Payment token generation for pending_payment state
   *   - Manage-booking token generation
   *   - Confirmation SMS dispatch
   *   - Analytics event recording
   *
   * Does NOT handle:
   *   - Request parsing (caller's responsibility)
   *   - Auth checks (caller's responsibility)
   *   - Response formatting / HTTP status codes (caller's responsibility)
   *   - Idempotency key management (caller's responsibility)
   */
  static async createBooking(params: CreateBookingParams): Promise<CreateBookingResult> {
    const {
      eventId,
      customerId,
      normalizedPhone,
      seats,
      source,
      bookingMode,
      appBaseUrl,
      shouldSendSms = true,
      supabaseClient,
      logTag = 'event booking'
    } = params

    // Capitalised form used when logTag starts a log message.
    const logTagCap = logTag.charAt(0).toUpperCase() + logTag.slice(1)

    const supabase = supabaseClient ?? createAdminClient()

    // ── 1. Call create_event_booking_v05 RPC ──────────────────────────────────
    const { data: rpcResultRaw, error: rpcError } = await supabase.rpc(
      'create_event_booking_v05',
      {
        p_event_id: eventId,
        p_customer_id: customerId,
        p_seats: seats,
        p_source: source
      }
    )

    if (rpcError) {
      logger.error('create_event_booking_v05 RPC failed', {
        error: new Error(rpcError.message),
        metadata: { eventId, customerId, source }
      })
      return {
        resolvedState: 'blocked',
        resolvedReason: null,
        bookingId: null,
        seatsRemaining: null,
        nextStepUrl: null,
        manageUrl: null,
        smsMeta: null,
        tableBookingId: null,
        tableName: null,
        rpcResult: {} as EventBookingRpcResult,
        rpcFailed: true
      }
    }

    const rpcResult = (rpcResultRaw ?? {}) as EventBookingRpcResult
    const state = rpcResult.state || 'blocked'
    let resolvedState: EventBookingRpcResult['state'] = state
    let resolvedReason: string | null = rpcResult.reason ?? null
    let nextStepUrl: string | null = null
    let manageUrl: string | null = null
    let tableBookingId: string | null = null
    let tableName: string | null = null

    // ── 2. Table reservation (table / mixed modes) ────────────────────────────
    if (
      (state === 'confirmed' || state === 'pending_payment') &&
      bookingMode !== 'general' &&
      rpcResult.booking_id
    ) {
      const { data: tableReservationRaw, error: tableReservationError } = await supabase.rpc(
        'create_event_table_reservation_v05',
        {
          p_event_id: eventId,
          p_event_booking_id: rpcResult.booking_id,
          p_customer_id: customerId,
          p_party_size: seats,
          p_source: source,
          p_notes: `Event booking ${rpcResult.booking_id}`
        }
      )

      const tableReservation = (tableReservationRaw || {}) as EventTableReservationRpcResult
      const tableReservationState = tableReservation.state || 'blocked'

      if (tableReservationError || tableReservationState !== 'confirmed') {
        try {
          await cancelBookingAfterTableReservationFailure(supabase, rpcResult.booking_id)
        } catch (rollbackError) {
          logger.error('Failed to rollback event booking after table reservation failure', {
            metadata: {
              bookingId: rpcResult.booking_id,
              eventId,
              customerId,
              tableReservationState,
              tableReservationReason: tableReservation.reason || null,
              error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            }
          })
          return {
            resolvedState: 'blocked',
            resolvedReason: null,
            bookingId: null,
            seatsRemaining: null,
            nextStepUrl: null,
            manageUrl: null,
            smsMeta: null,
            tableBookingId: null,
            tableName: null,
            rpcResult,
            rollbackFailed: true
          }
        }

        resolvedState = 'blocked'
        resolvedReason =
          tableReservation.reason ||
          (tableReservationError ? 'no_table' : rpcResult.reason || 'no_table')
      } else {
        tableBookingId = tableReservation.table_booking_id || null
        tableName = tableReservation.table_name || null
      }
    }

    // ── 3. Payment token (pending_payment only) ───────────────────────────────
    if (
      resolvedState === 'pending_payment' &&
      rpcResult.booking_id &&
      rpcResult.hold_expires_at
    ) {
      try {
        const paymentToken = await createEventPaymentToken(supabase, {
          customerId,
          bookingId: rpcResult.booking_id,
          holdExpiresAt: rpcResult.hold_expires_at,
          appBaseUrl
        })
        nextStepUrl = paymentToken.url
      } catch (tokenError) {
        // Payment link is critical for pending_payment bookings — the customer
        // cannot complete payment without it. Signal failure to the caller.
        logger.error('Failed to create event payment token', {
          error: tokenError instanceof Error ? tokenError : new Error(String(tokenError)),
          metadata: { bookingId: rpcResult.booking_id }
        })
        return {
          resolvedState,
          resolvedReason,
          bookingId: rpcResult.booking_id ?? null,
          seatsRemaining: rpcResult.seats_remaining ?? null,
          nextStepUrl: null,
          manageUrl: null,
          smsMeta: null,
          tableBookingId,
          tableName,
          rpcResult,
          paymentLinkFailed: true
        }
      }
    }

    // ── 4. Manage-booking token ────────────────────────────────────────────────
    if (
      (resolvedState === 'confirmed' || resolvedState === 'pending_payment') &&
      rpcResult.booking_id &&
      rpcResult.event_start_datetime
    ) {
      try {
        const manageToken = await createEventManageToken(supabase, {
          customerId,
          bookingId: rpcResult.booking_id,
          eventStartIso: rpcResult.event_start_datetime,
          appBaseUrl
        })
        manageUrl = manageToken.url
      } catch (error) {
        logger.warn('Failed to create event manage token', {
          metadata: {
            bookingId: rpcResult.booking_id,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }

    // ── 5. SMS + analytics (fire-and-forget with settled result) ──────────────
    let smsMeta: SmsSafetyMeta = null

    if (resolvedState === 'confirmed' || resolvedState === 'pending_payment') {
      const tasks: Array<{ label: string; promise: Promise<unknown> }> = [
        {
          label: 'analytics:event_booking_created',
          promise: recordAnalyticsSafe(
            supabase,
            {
              customerId,
              eventType: 'event_booking_created',
              eventBookingId: rpcResult.booking_id,
              metadata: {
                event_id: eventId,
                seats,
                state: resolvedState,
                payment_mode: rpcResult.payment_mode || null,
                source
              }
            },
            { customerId, eventId, eventBookingId: rpcResult.booking_id || null, state: resolvedState }
          )
        }
      ]

      if (shouldSendSms && normalizedPhone) {
        tasks.push({
          label: 'sms:booking_created',
          promise: sendBookingSmsIfAllowed(
            supabase,
            customerId,
            normalizedPhone,
            rpcResult,
            seats,
            nextStepUrl,
            manageUrl,
            logTag
          )
            .then((meta) => {
              smsMeta = meta
            })
            .catch((smsError) => {
              const message = smsError instanceof Error ? smsError.message : String(smsError)
              logger.warn(`${logTagCap} SMS task rejected unexpectedly`, {
                metadata: {
                  bookingId: rpcResult.booking_id,
                  state: resolvedState,
                  error: message
                }
              })
              smsMeta = { success: false, code: 'unexpected_exception', logFailure: false }
            })
        })
      }

      const outcomes = await Promise.allSettled(tasks.map((t) => t.promise))
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'rejected') {
          const reason =
            outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
          logger.warn(`${logTagCap} side-effect task rejected unexpectedly`, {
            metadata: {
              label: tasks[index]?.label ?? `task_${index}`,
              bookingId: rpcResult.booking_id,
              customerId,
              state: resolvedState,
              error: reason
            }
          })
        }
      })
    }

    return {
      resolvedState,
      resolvedReason,
      bookingId: rpcResult.booking_id ?? null,
      seatsRemaining: rpcResult.seats_remaining ?? null,
      nextStepUrl,
      manageUrl,
      smsMeta,
      tableBookingId,
      tableName,
      rpcResult
    }
  }

  /** Exposed for re-use: normalise a booking_mode value from the DB. */
  static normalizeBookingMode(value: unknown): 'table' | 'general' | 'mixed' {
    return normalizeBookingMode(value)
  }
}
