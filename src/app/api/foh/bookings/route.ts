import { NextRequest, NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/env'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { getLondonDateIso, requireFohPermission } from '@/lib/foh/api-auth'
import { loadTradingHours, resolveTradingDayNow, serviceInstantFor } from '@/lib/business-hours/trading-day'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { recordBookingContactEmail } from '@/lib/bookings/contact-email'
import { recordStaffReadOutConsent } from '@/lib/consent/staff-capture'
import { logger } from '@/lib/logger'
import {
  getChristmasCourseAvailability,
  oneCourseForEveryone,
  recordChristmasCourseCounts,
  recordOneCourseInsideCutoff,
} from '@/lib/table-bookings/christmas-one-course'
import { syncPreorderCovers } from '@/lib/table-bookings/preorder'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  alignTablePaymentHoldToScheduledSend,
  chargedDepositAmount,
  createTablePaymentToken,
  mapTableBookingBlockedReason,
  sendTableBookingCreatedSmsIfAllowed,
  type TableBookingRpcResult
} from '@/lib/table-bookings/bookings'
import {
  computeDepositAmount,
  requiresDeposit as requiresDepositForParty,
} from '@/lib/table-bookings/deposit'
import {
  expectedDepositForCreate,
  loadBookingPeriodContext,
  type BookingPeriodContext,
} from '@/lib/table-bookings/period-lookup'
import {
  extractChristmasRuleErrorMessage,
  isChristmasPurpose,
  toBookingType,
  toStoredBookingPurpose,
} from '@/lib/table-bookings/christmas'
import { isAssignmentConflictError } from '@/lib/table-bookings/move-table'
import { extractServiceWindowRuleErrorMessage } from '@/lib/table-bookings/service-window-guard'
import { fohBookingBypassesPacing } from '@/lib/foh/pacing-bypass'
import {
  PARTY_SIZE_INPUT_CEILING,
  readTableBookingPartyLimit,
  staffPartyLimitMessage,
} from '@/lib/table-bookings/party-limit'
import {
  FOH_BOOKING_CLIENT_HEADER,
  FOH_CLIENT_OUTDATED_CODE,
  isCurrentFohBookingClient,
} from '@/lib/foh/booking-client-contract'
import {
  isFohWalkInDateAllowed,
  shouldSeatFohWalkIn,
  WALK_IN_TODAY_ONLY_MESSAGE,
} from '@/lib/foh/walk-in'
import {
  splitWalkInGuestName,
  createWalkInCustomer,
  startWalkInCustomerTrail,
  finishWalkInCustomerTrail,
  type WalkInCustomerTrail,
} from '@/lib/foh/walk-in-customer'

/** Booking purposes the FOH create endpoint accepts. */
type FohBookingPurpose = 'food' | 'drinks' | 'christmas'

const CreateFohTableBookingSchema = z.object({
  customer_mode: z.enum(['selected', 'phone', 'anonymous']),
  customer_id: z.string().uuid().optional(),
  phone: z.string().trim().min(7).max(32).optional(),
  email: z.string().trim().email().max(255).optional(),
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().max(80).optional(),
  walk_in: z.boolean().optional(),
  walk_in_guest_name: z.string().trim().max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  // A typo guard only. The limit is the setting the booking functions read (D30, BK-146): the staff
  // function refuses a bigger party as too_large_party, and the override path checks it itself.
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(PARTY_SIZE_INPUT_CEILING)
  ),
  // `christmas` creates a `booking_type = 'christmas'` booking. The RPC maps it
  // to a food purpose internally, so kitchen hours, duration and pacing behave
  // exactly as for `food`, but a deposit is always taken whatever the size.
  purpose: z.enum(['food', 'drinks', 'christmas']),
  notes: z.string().trim().max(500).optional(),
  // Allergies in their own field (BK-052), split on the screen. The same limits as the public API.
  allergies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  // Deprecated. Older FOH clients may still post this while their bundle rolls
  // forward, but Sunday bookings no longer have a pre-order flow.
  sunday_lunch: z.boolean().optional(),
  sunday_deposit_method: z.enum(['cash', 'payment_link']).optional(),
  // The seasonal period offered and what the guest said. Advisory only: the database re-reads the
  // live period for the booking date and refuses an id naming a different one. A `christmas`
  // purpose is treated as a yes to a Christmas-kind period, so the existing FOH flow needs no
  // change to keep working.
  booking_period_id: z.string().uuid().optional(),
  booking_period_answer: z.boolean().optional(),
  // High-chair request (hard cap of 2 for everyone — no override flag). The DB
  // grants atomically and may clamp below the request. `outside_seating` holds
  // no indoor table but still paces.
  high_chair_count: z.coerce.number().int().min(0).max(2).optional(),
  outside_seating: z.boolean().optional(),
  requires_accessible_table: z.boolean().optional(),
  // Christmas only: the 1, 2 or 3 courses each guest is having, seat 1 first (BK-057). Optional so
  // an older FOH bundle that never sends it keeps working; the database checks it again.
  christmas_course_counts: z.array(z.number().int().min(1).max(3)).min(1).max(20).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  management_override: z.boolean().optional(),
  waive_deposit: z.boolean().optional(),
  bypass_pacing: z.boolean().optional(),
  is_venue_event: z.boolean().optional().default(false),
  // Staff read the guest the marketing notice and they said yes (owner decision D32).
  marketing_texts_yes: z.boolean().optional()
}).superRefine((value, context) => {
  if (value.customer_mode === 'selected' && !value.customer_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The selected customer was not included. Refresh and try again.'
    })
  }

  if (value.customer_mode === 'phone' && !value.phone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The customer phone number was not included. Refresh and try again.'
    })
  }

  if (value.customer_mode === 'anonymous' && value.walk_in !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Anonymous customers are only allowed for walk-ins'
    })
  }

  if (value.customer_id && value.customer_mode !== 'selected') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Selected customer details are inconsistent. Refresh and try again.'
    })
  }

  if (!value.customer_id && !value.phone && value.walk_in !== true && value.management_override !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide a customer or phone number'
    })
  }

  if (!value.customer_id && value.walk_in !== true && value.management_override !== true) {
    if (!value.first_name?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter the customer first name'
      })
    }
  }

  if (value.management_override === true && !value.customer_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Management override requires a selected customer'
    })
  }

  // Deposit not required for management overrides, deposit waivers, or venue events — they bypass deposit restrictions.
  // The deposit threshold is the centralised 15+ rule; the deprecated `sunday_lunch`
  // flag no longer drives deposit or pre-order behaviour.
  if (
    value.management_override !== true &&
    value.waive_deposit !== true &&
    value.is_venue_event !== true &&
    value.party_size != null &&
    requiresDepositForParty(value.party_size, {
      // Christmas bookings always take a deposit, so staff must always pick a
      // deposit method for them, even for a party of 6.
      isChristmas: isChristmasPurpose(value.purpose),
    }) &&
    value.sunday_deposit_method == null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose cash or payment link for the table deposit'
    })
  }

  if (value.christmas_course_counts) {
    if (!isChristmasPurpose(value.purpose)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Course choices are only taken for Christmas bookings.'
      })
    } else if (value.christmas_course_counts.length !== value.party_size) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose 1, 2 or 3 courses for every Christmas guest.'
      })
    }
  }
})

function buildWalkInBookingReference(): string {
  return `TB-W${randomBytes(4).toString('hex').toUpperCase()}`
}

/**
 * The visit length and turnaround gap, from table_booking_turn_minutes: the booking function's own
 * rule (turn times by party size, the Sunday uplift and the gap when turn times are on). This path
 * used fixed 90 or 120 minutes with no gap (BK-145).
 */
async function getWalkInTurnMinutes(
  supabase: any,
  input: { date: string; partySize: number; purpose: FohBookingPurpose }
): Promise<{ durationMinutes: number; turnaroundMinutes: number }> {
  const { data, error } = await supabase.rpc('table_booking_turn_minutes', {
    p_booking_date: input.date,
    p_party_size: input.partySize,
    p_purpose: input.purpose,
  })
  const row = Array.isArray(data) ? data[0] : data
  const durationMinutes = Number(row?.duration_minutes)
  const turnaroundMinutes = Number(row?.turnaround_minutes)
  if (error || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(turnaroundMinutes)) {
    throw new Error(`Could not read the visit length for a walk-in override: ${error?.message ?? 'no answer'}`)
  }
  return { durationMinutes, turnaroundMinutes: Math.max(0, turnaroundMinutes) }
}

// Raw-insert override path (management override + walk-in hours-bypass fallback).
// Never calls the booking function, so it already bypasses kitchen pacing and hours; do not add a
// duplicate pacing check here. Tables come from find_table_allocation_candidates, the booking
// function's own picker, so priority, accessibility, high chairs, maintenance and live bookings are
// judged the same way (BK-145).
async function createManualWalkInBookingOverride(params: {
  supabase: any
  customerId: string
  source?: string   // default: 'walk-in'
  seatNow?: boolean // default: true
  /**
   * Recorded as deposit_waived. Set for a super admin override of a party that would owe a deposit
   * (BK-050), so the booking says why nothing is owed and can be seated. Never for a walk-in.
   */
  depositWaived?: boolean
  payload: {
    date: string
    time: string
    party_size: number
    purpose: FohBookingPurpose
    notes?: string
    // High-chair request (0–2). Granted atomically via reserve_high_chairs
    // after the row is inserted — never counted-then-inserted in JS.
    high_chair_count?: number
    // Outside bookings hold no indoor table, so table allocation and the
    // assignment insert are skipped for them.
    outside_seating?: boolean
    // Kept on the booking and given to the table picker, as the booking function does.
    requires_accessible_table?: boolean
  }
}): Promise<TableBookingRpcResult> {
  const bookingTime = params.payload.time.length === 5 ? `${params.payload.time}:00` : params.payload.time
  // The start within the date's trading day, not the date glued to the time: on a night that
  // closes after midnight, 00:31 on 31 December's service is 00:31 on 1 January, as the booking
  // functions' hours check already reads it. The booking keeps the service date. Throws when the
  // hours cannot be read, rather than risk writing the booking a day early.
  const serviceHours = (await loadTradingHours(params.supabase, [params.payload.date])).get(params.payload.date)
  const start = serviceInstantFor(params.payload.date, bookingTime, serviceHours)
  const startMs = start?.getTime() ?? Number.NaN
  if (!start || !Number.isFinite(startMs)) {
    throw new Error('Invalid walk-in booking time')
  }

  const { durationMinutes, turnaroundMinutes } = await getWalkInTurnMinutes(params.supabase, {
    date: params.payload.date,
    partySize: Math.max(1, Number(params.payload.party_size || 1)),
    purpose: params.payload.purpose,
  })
  const startIso = start.toISOString()
  // The booking's own end, and the table hold, which runs on by the turnaround gap, as the booking
  // function writes them.
  const endIso = new Date(startMs + durationMinutes * 60 * 1000).toISOString()
  const occupancyEndIso = new Date(startMs + (durationMinutes + turnaroundMinutes) * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()
  // Mirror what the RPC does: a Christmas request stamps booking_type
  // 'christmas' and stores booking_purpose 'food'.
  const bookingType = toBookingType(params.payload.purpose)
  const storedBookingPurpose = toStoredBookingPurpose(params.payload.purpose)
  // Normalise the two new features once. `isOutsideSeating` skips indoor table
  // allocation; `requestedHighChairs` is granted atomically after insert.
  const isOutsideSeating = params.payload.outside_seating === true
  const requestedHighChairs = Math.max(
    0,
    Math.min(2, Math.trunc(Number(params.payload.high_chair_count ?? 0)) || 0)
  )
  const requiresAccessibleTable = params.payload.requires_accessible_table === true

  type TableCombo = {
    tableIds: string[]
    tableNames: string[]
    totalCapacity: number
  }

  // Every valid candidate in the picker's order (rank 1 first), so a lost race on the first falls
  // through to the next. Channel 'walkin': online holds and minimum party sizes do not apply to a
  // guest standing at the bar, but live bookings, private hires, communal event seats, maintenance
  // and accessibility do.
  async function computeAvailableCombos(): Promise<TableCombo[]> {
    const { data, error } = await params.supabase.rpc('find_table_allocation_candidates', {
      p_start_at: startIso,
      p_end_at: occupancyEndIso,
      p_party_size: Math.max(1, Number(params.payload.party_size || 1)),
      p_purpose: storedBookingPurpose === 'drinks' ? 'drinks' : 'food',
      p_high_chair_count: requestedHighChairs,
      p_requires_accessible_table: requiresAccessibleTable,
      p_channel: 'walkin',
    })
    if (error) {
      throw new Error(`Failed to find tables for walk-in override: ${error.message}`)
    }
    type CandidateRow = {
      rank: number | null
      table_ids: string[] | null
      table_names: string[] | null
      total_capacity: number | null
    }
    return ((data || []) as CandidateRow[])
      .filter((row) => typeof row.rank === 'number' && Array.isArray(row.table_ids) && row.table_ids.length > 0)
      .sort((a, b) => (a.rank as number) - (b.rank as number))
      .map((row) => ({
        tableIds: row.table_ids as string[],
        tableNames: row.table_names ?? [],
        totalCapacity: Number(row.total_capacity ?? 0),
      }))
  }

  // Outside bookings hold no indoor table, so skip allocation entirely — they
  // can never return `no_table`. Indoor bookings still require a viable combo.
  const combos = isOutsideSeating ? [] : await computeAvailableCombos()
  if (!isOutsideSeating && combos.length === 0) {
    return {
      state: 'blocked',
      reason: 'no_table'
    }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bookingReference = buildWalkInBookingReference()
    const bookingSource = params.source ?? 'walk-in'
    const seatNow = params.seatNow ?? true
    const { data, error } = await (params.supabase.from('table_bookings') as any)
      .insert({
        customer_id: params.customerId,
        booking_reference: bookingReference,
        booking_date: params.payload.date,
        booking_time: bookingTime,
        booking_type: bookingType,
        status: 'confirmed',
        // Named, never left to a column default: the default of 'pending' made every walk-in and
        // override read as owing a deposit, and an override of 15 or more could not be seated
        // (BK-050). Nothing is owed on a booking made this way.
        payment_status: null,
        deposit_waived: params.depositWaived === true,
        party_size: params.payload.party_size,
        special_requirements: params.payload.notes || null,
        duration_minutes: durationMinutes,
        source: bookingSource,
        confirmed_at: nowIso,
        booking_purpose: storedBookingPurpose,
        committed_party_size: params.payload.party_size,
        seated_at: seatNow ? nowIso : null,
        start_datetime: startIso,
        end_datetime: endIso,
        // Insert chairs as 0 and grant atomically via reserve_high_chairs below
        // — never count-then-insert in JS (not atomic across separate requests).
        high_chair_count: 0,
        is_outside_seating: isOutsideSeating,
        requires_accessible_table: requiresAccessibleTable,
        created_at: nowIso,
        updated_at: nowIso
      })
      .select('id, booking_reference')
      .maybeSingle()

    if (!error && data?.id) {
      const tableBookingId = data.id as string
      let unknownAssignmentError: { code?: string; message?: string } | null = null

      // Grant high chairs atomically via the shared primitive. It locks, counts
      // the overlapping window, clamps to inventory and persists the granted
      // count on the row — safe despite this multi-statement flow because the
      // lock+count+update happen inside one function invocation. Never blocks.
      async function grantHighChairs(): Promise<number> {
        if (requestedHighChairs <= 0) {
          return 0
        }
        const { data: grantedRaw, error: reserveError } = await params.supabase.rpc('reserve_high_chairs', {
          p_booking_id: tableBookingId,
          p_requested: requestedHighChairs,
          p_start: startIso,
          p_end: endIso
        })
        if (reserveError) {
          // Non-fatal: the booking is valid without the chair. Log and treat as
          // zero granted so the caller/customer is never blocked on chairs.
          logger.warn('reserve_high_chairs failed for walk-in override', {
            metadata: {
              tableBookingId,
              requested: requestedHighChairs,
              error: reserveError.message || String(reserveError)
            }
          })
          return 0
        }
        return typeof grantedRaw === 'number' ? grantedRaw : Number(grantedRaw ?? 0) || 0
      }

      // Record the outside table this booking occupies. It holds no INDOOR table, which is
      // why the assignment insert is skipped below, but it does take space in the garden and
      // that has to be visible to the outside cap and to availability. This path inserts the
      // booking directly rather than through the RPC, so it has to say so explicitly: the
      // reconciling trigger fires on UPDATE only, deliberately (see
      // 20260802000008_outside_reservation_sync.sql). Never fails the booking, because a
      // walk-in already standing in the garden is not turned away over a bookkeeping row.
      async function holdOutsideTable(): Promise<void> {
        const { error: syncError } = await params.supabase.rpc('sync_outside_reservation', {
          p_table_booking_id: tableBookingId
        })
        if (syncError) {
          logger.warn('sync_outside_reservation failed for outside walk-in override', {
            metadata: {
              tableBookingId,
              error: syncError.message || String(syncError)
            }
          })
        }
      }

      // Outside bookings hold no indoor table, so skip the assignment insert and return
      // confirmed directly (with chairs granted). Not a `no_table` case.
      if (isOutsideSeating) {
        const highChairsGranted = await grantHighChairs()
        await holdOutsideTable()
        return {
          state: 'confirmed',
          table_booking_id: tableBookingId,
          booking_reference: (data.booking_reference as string) || bookingReference,
          status: 'confirmed',
          party_size: params.payload.party_size,
          booking_purpose: storedBookingPurpose,
          booking_type: bookingType,
          start_datetime: startIso,
          end_datetime: endIso,
          hold_expires_at: undefined,
          sunday_lunch: false,
          high_chairs_granted: highChairsGranted,
          high_chair_count: highChairsGranted,
          is_outside_seating: true
        }
      }

      for (const combo of combos) {
        const assignmentPayload = combo.tableIds.map((tableId) => ({
          table_booking_id: tableBookingId,
          table_id: tableId,
          start_datetime: startIso,
          end_datetime: occupancyEndIso,
          created_at: nowIso
        }))

        const { error: assignmentError } = await (params.supabase.from('booking_table_assignments') as any)
          .insert(assignmentPayload)

        if (!assignmentError) {
          const highChairsGranted = await grantHighChairs()
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
            booking_purpose: storedBookingPurpose,
            booking_type: bookingType,
            start_datetime: startIso,
            end_datetime: endIso,
            hold_expires_at: undefined,
            sunday_lunch: false,
            high_chairs_granted: highChairsGranted,
            high_chair_count: highChairsGranted,
            is_outside_seating: false
          }
        }

        if (isAssignmentConflictError(assignmentError)) {
          continue
        }

        // Unknown failure: stop trying combos and fall through to the cleanup
        // below so the just-inserted booking row is never stranded without a
        // table assignment. Re-raised (as a friendly error) after cleanup.
        unknownAssignmentError = assignmentError as { code?: string; message?: string }
        break
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

      if (unknownAssignmentError) {
        logger.error('Walk-in override table assignment failed with unexpected error', {
          metadata: {
            tableBookingId,
            code: unknownAssignmentError.code || null,
            error: unknownAssignmentError.message || String(unknownAssignmentError)
          }
        })
        throw new Error('Failed to assign a table for this booking')
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

/**
 * The guest's allergies, in their own field (BK-052). The booking functions do not take them, so they
 * are written straight after the booking. A failure is an error, not a warning, and the screen tells
 * staff to add them: a booking that quietly lost an allergy is the outcome to avoid.
 */
async function saveStaffBookingAllergies(
  supabase: any,
  tableBookingId: string,
  allergies: string[]
): Promise<boolean> {
  const { error } = await supabase.from('table_bookings').update({ allergies }).eq('id', tableBookingId)
  if (error) {
    logger.error('Staff booking saved but its allergies did not', {
      error: new Error(error.message || 'Allergy update failed'),
      metadata: { tableBookingId, allergyCount: allergies.length },
    })
    return false
  }
  return true
}

type FohCreateBookingResponseData = {
  /** Present when staff sent Christmas courses: false means the booking exists without them. */
  christmas_courses_saved?: boolean
  /**
   * True when a confirmation is known to have reached the guest, false when one was due and none
   * did (a landline with no email, say), null when none was due. Staff are told on false (BK-162).
   */
  notification_sent?: boolean | null
  /** Present when staff sent allergies: false means the booking exists without them. */
  allergies_saved?: boolean
  state: 'confirmed' | 'pending_payment' | 'blocked'
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
    | 'slot_full'
    | 'drinks_full'
    | 'outside_full'
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
  // What the database granted, which can be fewer than asked for when the venue's
  // high chairs are already held, so staff can tell the guest before they arrive.
  high_chairs_granted: number
  is_outside_seating: boolean
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

// PostgREST errors arrive as plain objects rather than Errors, so name their fields instead of
// logging "Unknown error" (tasks/lessons.md, 2026-05-28).
/**
 * Whether this user may take the deposit off a booking or override kitchen pacing: the
 * table_bookings manage permission, which managers, super admins and the Deputy role hold
 * (owner decision D18). It replaces checks on the role names 'manager' and 'super_admin', which
 * refused the Deputy role although it holds the permission (BK-106). Null when it cannot be read.
 */
async function canManageTableBookings(userId: string | null | undefined): Promise<boolean | null> {
  if (!userId) return false
  try {
    return await checkUserPermission('table_bookings', 'manage', userId)
  } catch (permissionError) {
    logger.error('Failed to check the table_bookings manage permission', {
      error: permissionError instanceof Error ? permissionError : new Error(String(permissionError)),
      metadata: { userId },
    })
    return null
  }
}

/**
 * One "Booking created" audit row for every booking FOH makes, whichever way it was made (BK-038):
 * the staff booking function, the walk-in fallback or the super admin override. Website bookings
 * always wrote one; staff-made bookings wrote none, so a disputed booking, waiver or table showed
 * nobody behind it. FOH runs on one shared login, so the row names that login, not the person.
 * Never fails the booking: the audit writer swallows its own errors.
 */
async function recordFohBookingCreated(input: {
  userId: string | null | undefined
  bookingResult: TableBookingRpcResult
  details: {
    path: 'staff_booking' | 'walk_in_fallback' | 'management_override'
    source: string
    channel: string
    bookingDate: string
    depositMethod: string | null
    waiveDeposit: boolean
    isVenueEvent: boolean
    bypassPacing: boolean
    managementOverride: boolean
  }
}): Promise<void> {
  const { bookingResult, details } = input
  if (!bookingResult.table_booking_id) return
  await logAuditEvent({
    user_id: input.userId ?? undefined,
    operation_type: 'create',
    resource_type: 'table_booking',
    resource_id: bookingResult.table_booking_id,
    operation_status: 'success',
    additional_info: {
      booking_reference: bookingResult.booking_reference ?? null,
      booking_state: bookingResult.state,
      booking_date: details.bookingDate,
      party_size: bookingResult.party_size ?? null,
      path: details.path,
      source: details.source,
      channel: details.channel,
      deposit_method: details.depositMethod,
      waive_deposit: details.waiveDeposit,
      is_venue_event: details.isVenueEvent,
      bypass_pacing: details.bypassPacing,
      management_override: details.managementOverride,
      table_ids: bookingResult.table_ids ?? (bookingResult.table_id ? [bookingResult.table_id] : []),
    },
  })
}

function describeDatabaseError(error: unknown): {
  code: string | null
  message: string | null
  details: string | null
  hint: string | null
} {
  const record = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const field = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : null)
  return { code: field('code'), message: field('message'), details: field('details'), hint: field('hint') }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // An anonymous walk-in gets a customer made up before its booking is attempted. The `finally`
  // removes it again on any way out, a thrown error included, when no booking row came of it.
  const walkInTrail = startWalkInCustomerTrail()
  try {
    return await createFohTableBooking(request, walkInTrail)
  } finally {
    await finishWalkInCustomerTrail(walkInTrail, 'POST /api/foh/bookings')
  }
}

async function createFohTableBooking(
  request: NextRequest,
  walkInTrail: WalkInCustomerTrail,
): Promise<NextResponse> {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  if (!isCurrentFohBookingClient(request.headers.get(FOH_BOOKING_CLIENT_HEADER))) {
    return NextResponse.json(
      {
        error: 'This FOH screen is out of date. Refresh it, then create the booking again.',
        code: FOH_CLIENT_OUTDATED_CODE,
        refresh_required: true,
      },
      { status: 409 },
    )
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
  // A walk-in joins the service in force: the night before, from midnight until an
  // after-midnight close. Only a walk-in needs the hours read to know it.
  const serviceDateNow = payload.walk_in === true
    ? (await resolveTradingDayNow(auth.supabase)).date
    : getLondonDateIso()
  if (!isFohWalkInDateAllowed({
    walkIn: payload.walk_in === true,
    bookingDate: payload.date,
    serviceDateNow,
  })) {
    return NextResponse.json({ error: WALK_IN_TODAY_ONLY_MESSAGE }, { status: 400 })
  }

  const shouldSeatNow = shouldSeatFohWalkIn({
    walkIn: payload.walk_in === true,
    bookingDate: payload.date,
    serviceDateNow,
  })

  // Management override: verify caller is super_admin, then bypass all booking rules.
  if (payload.management_override === true) {
    const { data: roleRows } = await auth.supabase
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', auth.userId)
    const isSuperAdmin = (roleRows as Array<{ roles: { name: string } | null }> | null)
      ?.some((r) => r.roles?.name === 'super_admin') ?? false
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Management override requires super_admin role' }, { status: 403 })
    }

    // One party limit for every channel (owner decision D30, BK-146), from the setting the booking
    // functions read. The override inserts directly, so it checks here; every other path goes
    // through create_table_booking_staff_v06, which refuses a bigger party as too_large_party.
    const partyLimit = await readTableBookingPartyLimit(auth.supabase)
    if (payload.party_size > partyLimit) {
      return NextResponse.json({ error: staffPartyLimitMessage(partyLimit) }, { status: 400 })
    }

    // Customer must already be resolved (schema enforces customer_id is set)
    const mgmtCustomerId = payload.customer_id!
    const bookingTime = payload.time.length === 5 ? `${payload.time}:00` : payload.time

    let mgmtResult: TableBookingRpcResult
    try {
      mgmtResult = await createManualWalkInBookingOverride({
        supabase: auth.supabase,
        customerId: mgmtCustomerId,
        source: 'management',
        seatNow: false,
        // An override takes no deposit. For a party that would owe one, say so on the booking
        // rather than leave it reading as unpaid (BK-050).
        depositWaived: requiresDepositForParty(payload.party_size, {
          isChristmas: isChristmasPurpose(payload.purpose),
        }),
        payload: {
          date: payload.date,
          time: bookingTime,
          party_size: payload.party_size,
          purpose: payload.purpose,
          notes: payload.notes,
          high_chair_count: payload.high_chair_count,
          outside_seating: payload.outside_seating,
          requires_accessible_table: payload.requires_accessible_table
        }
      })
    } catch (mgmtError) {
      // An override still meets the kitchen-hours guard, so tell the manager in its words.
      const serviceWindowMessage = extractServiceWindowRuleErrorMessage(mgmtError)
      if (serviceWindowMessage) {
        return NextResponse.json({ error: serviceWindowMessage }, { status: 400 })
      }
      logger.error('Management booking override failed', {
        error: mgmtError instanceof Error ? mgmtError : new Error('Unknown error'),
        metadata: {
          userId: auth.userId,
          customerId: mgmtCustomerId,
          bookingDate: payload.date,
          ...describeDatabaseError(mgmtError),
        }
      })
      return NextResponse.json({ error: 'Failed to create management booking' }, { status: 500 })
    }

    const mgmtAllergiesSaved =
      (payload.allergies?.length ?? 0) > 0 &&
      mgmtResult.table_booking_id &&
      (mgmtResult.state === 'confirmed' || mgmtResult.state === 'pending_payment')
        ? await saveStaffBookingAllergies(auth.supabase, mgmtResult.table_booking_id, payload.allergies ?? [])
        : undefined
    if (mgmtResult.state === 'confirmed') {
      await recordFohBookingCreated({
        userId: auth.userId,
        bookingResult: mgmtResult,
        details: {
          path: 'management_override',
          source: 'management',
          channel: 'staff',
          bookingDate: payload.date,
          depositMethod: null,
          waiveDeposit: false,
          isVenueEvent: false,
          bypassPacing: true,
          managementOverride: true,
        },
      })
    }

    const responseData: FohCreateBookingResponseData = {
      ...(mgmtAllergiesSaved === undefined ? {} : { allergies_saved: mgmtAllergiesSaved }),
      state: mgmtResult.state as FohCreateBookingResponseData['state'],
      table_booking_id: mgmtResult.table_booking_id ?? null,
      booking_reference: mgmtResult.booking_reference ?? null,
      reason: mgmtResult.reason ?? null,
      blocked_reason: mgmtResult.state === 'blocked'
        ? (mgmtResult.reason as FohCreateBookingResponseData['blocked_reason'] ?? 'blocked')
        : null,
      next_step_url: null,
      hold_expires_at: null,
      table_name: mgmtResult.table_name ?? null,
      sunday_preorder_state: 'not_applicable',
      sunday_preorder_reason: null,
      high_chairs_granted: mgmtResult.high_chairs_granted ?? mgmtResult.high_chair_count ?? 0,
      is_outside_seating: mgmtResult.is_outside_seating ?? false
    }
    return NextResponse.json({ success: true, data: responseData })
  }

  // Taking the deposit off a booking, by a waiver or by marking it a pub event, needs the
  // table_bookings manage permission (D18, BK-106). The pub event tick used to need nothing beyond
  // the FOH edit permission and wrote no audit row, so the shared FOH login could drop any 15+ or
  // Christmas deposit with one tick and nobody could tell afterwards.
  if (payload.is_venue_event === true && isChristmasPurpose(payload.purpose)) {
    // A pub event never removes a Christmas deposit (D18).
    return NextResponse.json(
      { error: 'A Christmas booking always takes its deposit, so it cannot be marked as a pub event. A manager can waive it instead.' },
      { status: 400 }
    )
  }
  if (payload.waive_deposit === true || payload.is_venue_event === true) {
    const canManage = await canManageTableBookings(auth.userId)
    if (canManage === null) {
      return NextResponse.json({ error: 'Failed to verify permissions' }, { status: 500 })
    }
    if (!canManage) {
      return NextResponse.json(
        {
          error: payload.is_venue_event === true
            ? 'Insufficient permissions to mark a booking as a pub event'
            : 'Insufficient permissions to waive deposit',
        },
        { status: 403 }
      )
    }
    // The waiver is audited once the booking exists, against it (BK-038): logged here it carried
    // no booking id, so it could never be tied to the booking it waived.
  }

  let normalizedPhone: string | null = null
  let customerId: string | null = null
  let shouldSendBookingSms = true
  const walkInNameParts = splitWalkInGuestName(payload.walk_in_guest_name)
  const fallbackFirstName = payload.first_name || walkInNameParts.firstName
  const fallbackLastName = payload.last_name || walkInNameParts.lastName
  // The typed email when the matched customer's record holds a different one (BK-078).
  let bookingContactEmail: string | null = null

  if (payload.customer_id) {
    const { data: selectedCustomer, error: selectedCustomerError } = await auth.supabase
      .from('customers')
      .select('id, mobile_e164, mobile_number, email')
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

    if (providedPhone && (!selectedCustomer.mobile_e164 || !selectedCustomer.mobile_number)) {
      // customers has no updated_at column: naming one makes PostgREST refuse the whole update.
      const phonePatch: Record<string, string> = {}
      if (!selectedCustomer.mobile_e164) phonePatch.mobile_e164 = providedPhone
      if (!selectedCustomer.mobile_number) phonePatch.mobile_number = providedPhone

      const { error: customerPhoneUpdateError } = await auth.supabase
        .from('customers')
        .update(phonePatch)
        .eq('id', selectedCustomer.id)

      if (customerPhoneUpdateError) {
        logger.error('Failed to persist selected customer phone for FOH booking', {
          error: customerPhoneUpdateError,
          metadata: {
            userId: auth.userId,
            customerId: selectedCustomer.id,
          },
        })
        return NextResponse.json({ error: 'Failed to update selected customer phone number' }, { status: 500 })
      }
    }

    // Backfill email only when the customer has none. Best-effort: a
    // lower(email) unique-index collision (another customer owns this email)
    // must never block the booking, so we log and continue rather than 500.
    if (payload.email && !selectedCustomer.email?.trim()) {
      const { error: emailBackfillError } = await auth.supabase
        .from('customers')
        .update({ email: payload.email.toLowerCase() })
        .eq('id', selectedCustomer.id)

      if (emailBackfillError) {
        // Another customer owning the email (23505) is expected and stays a warning. Anything
        // else is a fault on our side, and logger.warn does not print in production.
        const emailTaken = emailBackfillError.code === '23505'
        logger[emailTaken ? 'warn' : 'error']('Failed to backfill selected customer email for FOH booking', {
          metadata: {
            userId: auth.userId,
            customerId: selectedCustomer.id,
            error: emailBackfillError.message || String(emailBackfillError),
          },
        })
      }
    }

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
      lastName: fallbackLastName,
      email: payload.email
    }, { trustedEntry: true })
    customerId = customerResolution.customerId
    bookingContactEmail = customerResolution.bookingContactEmail ?? null
  } else if (payload.walk_in === true) {
    try {
      const walkInCustomer = await createWalkInCustomer(auth.supabase, {
        firstName: fallbackFirstName,
        lastName: fallbackLastName,
        guestName: payload.walk_in_guest_name,
        email: payload.email
      })
      customerId = walkInCustomer.customerId
      normalizedPhone = walkInCustomer.syntheticPhone
      shouldSendBookingSms = false
      walkInTrail.supabase = auth.supabase
      walkInTrail.userId = auth.userId
      walkInTrail.customer = walkInCustomer
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

  // Deduplication: for bookings with a real (non-walk-in) customer, check for an identical
  // booking created in the last 60 seconds and return it idempotently instead of creating a duplicate.
  // Wrapped in try/catch so a query failure is non-fatal — we skip dedup and proceed normally.
  if (payload.walk_in !== true && customerId) {
    try {
      const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString()
      // Fingerprint the request so two near-simultaneous bookings that differ
      // in party size, purpose, or indoor/outside seating are NOT collapsed.
      // All fingerprint fields are stored as requested, so they filter in SQL.
      // We deliberately do NOT compare high_chair_count: it is stored as the
      // GRANTED value (may be clamped below the request), so comparing it would
      // fail to dedupe an identical retry whose request was clamped — creating a
      // duplicate booking. A same customer/date/time/party/purpose/seating retry
      // within 60s is a double-submit regardless of the requested chair count.
      // A Christmas request stores booking_purpose 'food', so compare against
      // the stored value and narrow on booking_type instead. Without this a
      // Christmas retry would never match and would create a duplicate.
      let duplicateQuery = (auth.supabase.from('table_bookings') as any)
        .select('id, booking_reference, status, high_chair_count')
        .eq('customer_id', customerId)
        .eq('booking_date', payload.date)
        .eq('booking_time', bookingTime)
        .eq('party_size', payload.party_size)
        .eq('booking_purpose', toStoredBookingPurpose(payload.purpose))
        .eq('is_outside_seating', payload.outside_seating ?? false)
        // A retry that adds a step-free need is a different booking request, not a double-tap:
        // replaying the first row would silently drop the guest's accessibility requirement.
        .eq('requires_accessible_table', payload.requires_accessible_table ?? false)
        .not('status', 'in', '("cancelled","no_show")')
        .gte('created_at', sixtySecondsAgo)
      if (isChristmasPurpose(payload.purpose)) {
        duplicateQuery = duplicateQuery.eq('booking_type', 'christmas')
      }
      const { data: recentDuplicate } = await duplicateQuery.maybeSingle()

      if (recentDuplicate) {
        const dupState: FohCreateBookingResponseData['state'] =
          recentDuplicate.status === 'confirmed'
            ? 'confirmed'
            : recentDuplicate.status === 'pending_payment'
              ? 'pending_payment'
              : 'confirmed'
        return NextResponse.json(
          {
            success: true,
            data: {
              state: dupState,
              table_booking_id: recentDuplicate.id,
              booking_reference: recentDuplicate.booking_reference || null,
              reason: null,
              blocked_reason: null,
              next_step_url: null,
              hold_expires_at: null,
              table_name: null,
              sunday_preorder_state: 'not_applicable',
              sunday_preorder_reason: null,
              // The first submit's grant, so a double-tap reports the chairs actually held.
              high_chairs_granted: Number(recentDuplicate.high_chair_count) || 0,
              is_outside_seating: payload.outside_seating ?? false
            } satisfies FohCreateBookingResponseData
          },
          { status: 200 }
        )
      }
    } catch (dedupError) {
      // Deduplication check failed non-fatally; proceed with normal booking
      // creation — but log it, otherwise a permanently broken guard is invisible.
      logger.warn('FOH booking dedup pre-check failed; proceeding without dedup', {
        metadata: {
          userId: auth.userId,
          customerId,
          bookingDate: payload.date,
          bookingTime,
          error: dedupError instanceof Error ? dedupError.message : String(dedupError)
        }
      })
    }
  }

  const effectiveSundayLunch = false

  // Deposit-required decision uses the centralised 15+ rule with explicit
  // waiver support. Sunday pre-orders have been retired, so FOH bookings always
  // enter the generic table-booking path.
  //
  // Defects AB-001 / WF-004: management_override implies waiver. Today the
  // override path returns early at line ~856 so TypeScript correctly
  // narrows `payload.management_override` to `false | undefined` here —
  // the `Boolean(...)` wrapper widens it back so the defense-in-depth
  // check survives any future refactor that lets an override booking
  // flow into this branch (Zod schema at line ~96 already exempts it).
  const treatAsWaived =
    payload.waive_deposit === true ||
    payload.is_venue_event === true ||
    Boolean(payload.management_override)
  // Christmas bookings always take a deposit, at any party size. A manager
  // waiver, venue event or management override still wins.
  const isChristmasBooking = isChristmasPurpose(payload.purpose)

  // Whether a deposit is due has to be known HERE, before the RPC runs, because it decides whether
  // staff must pick cash or payment link. It used to be worked out by a local copy of the
  // party-size rule that had never heard of seasonal periods, so a per-booking Mother's Day deposit
  // would have been charged by the database while this screen believed nothing was due and never
  // asked for a method, leaving a pending_payment booking with no way to pay. It now asks the same
  // resolver the database will ask, from the same period row.
  const periodAccepted = payload.booking_period_answer === true || isChristmasBooking
  let periodContext: BookingPeriodContext = { period: null, collectPeriodDeposits: true }
  try {
    periodContext = await loadBookingPeriodContext(auth.supabase, payload.date)
  } catch (periodError) {
    // A period that cannot be read must not take the booking down. The database still resolves the
    // deposit correctly inside the RPC; the only thing lost is this screen's advance warning.
    logger.warn('Could not load the seasonal period for a FOH booking; falling back to the party-size rule', {
      metadata: {
        date: payload.date,
        error: periodError instanceof Error ? periodError.message : String(periodError),
      },
    })
  }

  const expectedDeposit = expectedDepositForCreate({
    context: periodContext,
    partySize: payload.party_size,
    bookingDate: payload.date,
    periodAccepted,
    depositWaived: treatAsWaived,
    waivedFor: payload.is_venue_event === true ? 'pub_event' : 'manager',
  })

  const requiresDeposit = expectedDeposit
    ? expectedDeposit.required
    : requiresDepositForParty(payload.party_size, {
        depositWaived: treatAsWaived,
        isChristmas: isChristmasBooking,
      })
  const depositMethod = requiresDeposit
    ? payload.sunday_deposit_method || null
    : null

  if (requiresDeposit && !depositMethod) {
    return NextResponse.json(
      { error: 'Choose whether the deposit was paid in cash or should be sent by payment link.' },
      { status: 400 }
    )
  }

  // Walk-ins and drinks never consume kitchen pacing. Advance food bookings
  // are subject to pacing unless a manager/super_admin explicitly overrides.
  // Drinks do not add kitchen covers, so they must never be blocked by the
  // food-only kitchen pacing gate.
  // The same rule the FOH free-times list applies (src/lib/foh/pacing-bypass.ts).
  let bypassPacing = fohBookingBypassesPacing({ walkIn: payload.walk_in === true, purpose: payload.purpose })
  if (payload.bypass_pacing === true && payload.walk_in !== true) {
    // The table_bookings manage permission, not role names (BK-106).
    const canManage = await canManageTableBookings(auth.userId)
    if (canManage === null) {
      return NextResponse.json({ error: 'Failed to verify permissions' }, { status: 500 })
    }
    if (!canManage) {
      return NextResponse.json({ error: 'Insufficient permissions to override kitchen pacing' }, { status: 403 })
    }
    await logAuditEvent({
      user_id: auth.userId,
      operation_type: 'create',
      resource_type: 'table_booking_pacing_override',
      operation_status: 'success',
      additional_info: { bypass_pacing: true, date: payload.date, time: payload.time, party_size: payload.party_size },
    })
    bypassPacing = true
  }

  // Two or three courses need a pre-order, so they can only be booked before noon seven days out.
  // Checked BEFORE the booking is made, so staff are told now rather than left with a booking that
  // has no courses. The trigger on table_bookings checks the same rule again when they are saved.
  const requestedCourses = isChristmasBooking ? payload.christmas_course_counts ?? null : null
  if (requestedCourses?.some((count) => count > 1)) {
    const availability = await getChristmasCourseAvailability(auth.supabase, payload.date)
    if (availability !== 'available') {
      return NextResponse.json(
        {
          error:
            availability === 'closed'
              ? 'The Christmas pre-order deadline has passed for that date, so every guest is on 1 course. Choose 1 course for each guest.'
              : 'Could not check the Christmas pre-order deadline. Please try again.'
        },
        { status: availability === 'closed' ? 400 : 503 }
      )
    }
  }

  // Staff path, so the STAFF entry point. It is service-role only, and this route has
  // already run requireFohTableBookingPermission above, which is what proves authority.
  // The channel is never taken from the request body: it is derived here from whether the
  // booking is a walk-in, so a caller cannot claim a channel it has not earned.
  //
  // v06 falls back to v05 internally while table_allocation_v06_enabled is false, so this
  // switch is inert until the flag is turned on.
  const { data: rpcResultRaw, error: rpcError } = await auth.supabase.rpc('create_table_booking_staff_v06', {
    p_customer_id: customerId,
    p_booking_date: payload.date,
    p_booking_time: bookingTime,
    p_party_size: payload.party_size,
    p_booking_purpose: payload.purpose,
    p_notes: payload.notes || null,
    p_sunday_lunch: false,
    p_source: payload.walk_in === true ? 'walk-in' : 'admin',
    p_bypass_cutoff: true,
    // Venue events and management overrides automatically waive the deposit,
    // matching the explicit waive_deposit path.
    p_deposit_waived: treatAsWaived,
    p_bypass_pacing: bypassPacing,
    // Chairs are a hard ceiling for everyone, with no override flag. Granted
    // atomically inside the RPC; outside bookings hold no indoor table.
    p_high_chair_count: payload.high_chair_count ?? 0,
    p_outside_seating: payload.outside_seating ?? false,
    p_requires_accessible_table: payload.requires_accessible_table ?? false,
    // A walk-in is not subject to the online holds or minimum party sizes: the guest is
    // standing at the bar.
    p_channel: payload.walk_in === true ? 'walkin' : 'staff',
    p_actor_id: auth.userId ?? null,
    // The seasonal answer only. The amount, the basis and the refund terms are resolved inside the
    // RPC from the period it re-reads by booking date, so this route never sends a figure.
    p_booking_period_id: payload.booking_period_id ?? null,
    p_booking_period_answer: payload.booking_period_answer ?? null
  })

  let bookingResult: TableBookingRpcResult
  if (rpcError) {
    if (isAssignmentConflictError(rpcError)) {
      bookingResult = {
        state: 'blocked',
        reason: rpcError.message?.includes('table_assignment_private_blocked')
          ? 'private_booking_blocked'
          : 'no_table'
      }
    } else {
      // Christmas rule breaches (party size below 6, under 24 hours notice)
      // come back with wording that is already safe to show, so pass it through
      // unchanged instead of a generic failure.
      const christmasRuleMessage = extractChristmasRuleErrorMessage(rpcError)
      if (christmasRuleMessage) {
        return NextResponse.json({ error: christmasRuleMessage }, { status: 400 })
      }
      // The kitchen is not serving at that time. The guard's own sentence says exactly that, so
      // staff get it rather than a failure they cannot act on.
      const serviceWindowMessage = extractServiceWindowRuleErrorMessage(rpcError)
      if (serviceWindowMessage) {
        return NextResponse.json({ error: serviceWindowMessage }, { status: 400 })
      }
      logger.error('create_table_booking_staff_v06 RPC failed for FOH create', {
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
  const appBaseUrl = getAppUrl()

  let nextStepUrl: string | null = null
  let holdExpiresAt = bookingResult.hold_expires_at || null
  const sundayPreorderState: FohCreateBookingResponseData['sunday_preorder_state'] = 'not_applicable'
  const sundayPreorderReason: string | null = null

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
        seatNow: shouldSeatNow,
        payload: {
          date: payload.date,
          time: bookingTime,
          party_size: payload.party_size,
          purpose: payload.purpose,
          notes: payload.notes,
          high_chair_count: payload.high_chair_count,
          outside_seating: payload.outside_seating,
          requires_accessible_table: payload.requires_accessible_table
        }
      })
      shouldSendBookingSms = false
      holdExpiresAt = null
    } catch (walkInOverrideError) {
      // The fallback's raw insert meets the same kitchen-hours guard as the booking function.
      const serviceWindowMessage = extractServiceWindowRuleErrorMessage(walkInOverrideError)
      if (serviceWindowMessage) {
        return NextResponse.json({ error: serviceWindowMessage }, { status: 400 })
      }
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
          purpose: payload.purpose,
          ...describeDatabaseError(walkInOverrideError),
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

  // From here a booking row exists and points at the customer, so a made-up walk-in customer
  // has to stay whatever happens next: a failed payment link cancels the booking, it does not
  // delete it. Decided on the state, never on whether an id came back, because a blocked result
  // can carry another booking's id (tasks/lessons.md, 2026-07-03).
  if (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_payment') {
    walkInTrail.bookingPersisted = true
    await recordFohBookingCreated({
      userId: auth.userId,
      bookingResult,
      details: {
        path: shouldBypassHoursForWalkIn ? 'walk_in_fallback' : 'staff_booking',
        source: payload.walk_in === true ? 'walk-in' : 'admin',
        channel: payload.walk_in === true ? 'walkin' : 'staff',
        bookingDate: payload.date,
        depositMethod,
        waiveDeposit: payload.waive_deposit === true,
        isVenueEvent: payload.is_venue_event === true,
        bypassPacing,
        managementOverride: false,
      },
    })
    if ((payload.waive_deposit === true || payload.is_venue_event === true) && bookingResult.table_booking_id) {
      await logAuditEvent({
        user_id: auth.userId,
        operation_type: 'table_booking.deposit_waived',
        resource_type: 'table_booking',
        resource_id: bookingResult.table_booking_id,
        operation_status: 'success',
        additional_info: {
          // Who and why: a pub event, or a manager's waiver (BK-106).
          reason: payload.is_venue_event === true ? 'pub_event' : 'manager_waiver',
          description: payload.is_venue_event === true ? 'No deposit: pub event' : 'Deposit waived by a manager',
          booking_reference: bookingResult.booking_reference ?? null,
          party_size: payload.party_size,
        },
      })
    }
  }

  // Stamp is_venue_event on the booking record when set — the RPC does not accept this field,
  // so we update it immediately after creation. Non-fatal: the deposit logic has already been
  // bypassed above; this is a data-quality write for reporting/display purposes.
  if (payload.is_venue_event === true && bookingResult.table_booking_id) {
    const { error: venueEventUpdateError } = await (auth.supabase.from('table_bookings') as any)
      .update({ is_venue_event: true })
      .eq('id', bookingResult.table_booking_id)

    if (venueEventUpdateError) {
      // Error, not warn: production drops warn, and a booking whose deposit was taken off for a
      // pub event must say so (BK-106).
      logger.error('Failed to stamp is_venue_event on table booking', {
        metadata: {
          userId: auth.userId,
          tableBookingId: bookingResult.table_booking_id,
          error: venueEventUpdateError.message || String(venueEventUpdateError)
        }
      })
    }
  }

  const allergiesSaved =
    (payload.allergies?.length ?? 0) > 0 &&
    bookingResult.table_booking_id &&
    (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_payment')
      ? await saveStaffBookingAllergies(auth.supabase, bookingResult.table_booking_id, payload.allergies ?? [])
      : undefined

  // The courses staff chose for each guest are recorded on the booking (BK-057), so the pre-order
  // forms, the chase and the kitchen know who is on 1, 2 or 3 courses. A request without them (an
  // older FOH bundle) keeps the earlier rule: inside the Christmas pre-order deadline the 1 course
  // tier is the only one on offer (SSOT §7, owner decision 10 September 2026), so every guest is
  // recorded as one course, with nothing to pre-order and nobody to chase. Non-fatal either way:
  // the booking already exists, and staff are told when the courses did not save.
  let christmasCoursesSaved: boolean | undefined
  if (
    isChristmasBooking &&
    bookingResult.table_booking_id &&
    (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_payment') &&
    requestedCourses
  ) {
    const createdBookingId = bookingResult.table_booking_id
    const outcome = await recordChristmasCourseCounts(
      auth.supabase,
      { id: createdBookingId, bookingDate: payload.date },
      requestedCourses
    )
    christmasCoursesSaved = outcome === 'recorded'
    if (outcome === 'recorded') {
      const requiresPreorder = requestedCourses.some((count) => count > 1)
      bookingResult = {
        ...bookingResult,
        booking_period_requires_preorder: requiresPreorder,
        christmas_course_counts: requestedCourses,
      }
      if (requiresPreorder) {
        // One seat row per guest, so the booker's form and the staff card open ready to fill.
        try {
          await syncPreorderCovers(auth.supabase, createdBookingId)
        } catch (syncError) {
          logger.warn('Could not set up pre-order seats for a new staff Christmas booking', {
            metadata: {
              tableBookingId: createdBookingId,
              error: syncError instanceof Error ? syncError.message : String(syncError)
            }
          })
        }
      }
    }
  } else if (
    isChristmasBooking &&
    bookingResult.table_booking_id &&
    (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_payment')
  ) {
    const outcome = await recordOneCourseInsideCutoff(auth.supabase, {
      id: bookingResult.table_booking_id,
      bookingDate: payload.date,
      partySize: payload.party_size,
    })
    // The confirmation text is built from this result, not from the row, so without this it would
    // still say "Choose your food" and link to a form that has already locked.
    if (outcome === 'recorded') {
      bookingResult = {
        ...bookingResult,
        booking_period_requires_preorder: false,
        christmas_course_counts: oneCourseForEveryone(payload.party_size),
      }
    }
  }

  if (payload.waive_deposit !== true) {
    if (
      bookingResult.state === 'pending_payment' &&
      bookingResult.table_booking_id &&
      depositMethod === 'cash'
    ) {
      // Staff-confirmed cash deposit. The amount is whatever the RPC actually resolved and wrote on
      // the booking, because that is the figure the guest is being asked for at the bar. Recomputing
      // it here from party size was correct only while every deposit was GBP 10 a head: a seasonal
      // period at any other rate, or a per-booking one, made the cash taken disagree with the
      // deposit charged. The party-size helper remains the fallback for the case where the RPC
      // returned no figure at all. We then lock the confirmed amount on the booking row so any
      // later recompute honours what was actually taken. Spec §6, §7.4, §8.3.
      const cashDepositAmount = chargedDepositAmount(bookingResult, () =>
        computeDepositAmount(Math.max(1, Number(payload.party_size || 1)), {
          isChristmas: isChristmasBooking,
        }),
      )
      const { data: cashConfirmRaw, error: cashConfirmError } = await auth.supabase.rpc('record_table_cash_deposit_v05', {
        p_table_booking_id: bookingResult.table_booking_id,
        p_amount: cashDepositAmount,
        p_currency: 'GBP',
      })

      if (cashConfirmError) {
        logger.error('record_table_cash_deposit_v05 RPC failed for FOH create', {
          error: new Error(cashConfirmError.message),
          metadata: {
            userId: auth.userId,
            customerId,
            tableBookingId: bookingResult.table_booking_id,
          },
        })
        return NextResponse.json(
          // A manager can now record it from the booking (BK-045); "reopen and retry" was impossible.
          { error: 'Booking was created but the cash deposit was not recorded. Open the booking and use "Deposit taken at the bar" to record it.' },
          { status: 500 }
        )
      }

      const cashConfirm = (cashConfirmRaw ?? {}) as {
        state?: 'confirmed' | 'already_confirmed' | 'blocked'
        reason?: string
      }

      if (cashConfirm.state === 'blocked') {
        logger.warn('Cash deposit confirmation returned blocked for FOH create', {
          metadata: {
            userId: auth.userId,
            customerId,
            tableBookingId: bookingResult.table_booking_id,
            reason: cashConfirm.reason || null,
          },
        })
        return NextResponse.json(
          { error: 'Booking was created but cash deposit could not be confirmed.' },
          { status: 409 }
        )
      }

      // Lock the staff-confirmed cash amount on the booking row. The RPC
      // updates payments + sets payment_status='completed' but does NOT touch
      // deposit_amount_locked, so we write it here.
      // Spec §6, §7.4, §8.3.
      //
      // Defects WF-003 / SEC-003 / ARCH-003: previously this was best-effort
      // (logged + continued), which left a window where the booking is
      // confirmed-but-unlocked and the canonical reader would fall back to
      // `deposit_amount`. We now fail the request when the lock write fails
      // so the operator can retry. The cash payment is already recorded by
      // the RPC; the retry path is "reopen the booking and confirm again",
      // which the response error message already instructs.
      const { error: cashLockError } = await auth.supabase
        .from('table_bookings')
        .update({ deposit_amount_locked: cashDepositAmount })
        .eq('id', bookingResult.table_booking_id)
      if (cashLockError) {
        logger.error('Failed to lock cash deposit amount on booking — failing FOH create for operator retry', {
          error: new Error(cashLockError.message),
          metadata: {
            tableBookingId: bookingResult.table_booking_id,
            cashDepositAmount,
          },
        })
        return NextResponse.json(
          {
            error: 'Booking confirmed and the cash recorded, but the deposit amount could not be locked on the booking. Tell a manager before the booking is changed.',
            tableBookingId: bookingResult.table_booking_id,
          },
          { status: 500 }
        )
      }

      bookingResult = {
        ...bookingResult,
        state: 'confirmed',
        status: 'confirmed',
        hold_expires_at: undefined,
      }
      holdExpiresAt = null
      nextStepUrl = null
    } else if (
      bookingResult.state === 'pending_payment' &&
      bookingResult.table_booking_id &&
      bookingResult.hold_expires_at &&
      depositMethod === 'payment_link'
    ) {
      try {
        const token = await createTablePaymentToken(auth.supabase, {
          customerId,
          tableBookingId: bookingResult.table_booking_id,
          holdExpiresAt: bookingResult.hold_expires_at,
          appBaseUrl,
        })
        nextStepUrl = token.url
      } catch (tokenError) {
        const failureAt = new Date().toISOString()
        logger.error('Failed to create table payment token for FOH create; cancelling pending booking', {
          error: tokenError instanceof Error ? tokenError : new Error(String(tokenError)),
          metadata: {
            tableBookingId: bookingResult.table_booking_id,
          },
        })
        const { error: cancelError } = await auth.supabase
          .from('table_bookings')
          .update({
            status: 'cancelled',
            cancelled_at: failureAt,
            cancelled_by: 'system',
            cancellation_reason: 'payment_link_generation_failed',
            hold_expires_at: null,
            paypal_deposit_order_id: null,
            updated_at: failureAt,
          })
          .eq('id', bookingResult.table_booking_id)
          .eq('status', 'pending_payment')

        if (cancelError) {
          logger.error('Failed to cancel pending FOH booking after payment-token failure', {
            error: new Error(cancelError.message),
            metadata: {
              tableBookingId: bookingResult.table_booking_id,
            },
          })
        }

        return NextResponse.json(
          { error: 'Booking could not be created because the payment link failed. Please try again.' },
          { status: 500 },
        )
      }
    }
  }
  // If waive_deposit is true, booking is already confirmed via RPC — fall through to SMS

  if (
    shouldSeatNow &&
    bookingResult.table_booking_id &&
    bookingResult.state === 'confirmed'
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

  // Kept before the confirmation goes, so it reaches the address the guest gave (BK-078).
  if (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_payment') {
    await recordBookingContactEmail('table_bookings', bookingResult.table_booking_id, bookingContactEmail)
    // A made-up walk-in customer has no number to text, so there is nothing to consent to.
    await recordStaffReadOutConsent({
      saidYes: payload.marketing_texts_yes === true && !walkInTrail.customer,
      customerId,
      actorUserId: auth.userId,
      source: 'staff_table_booking',
      relatedEntityType: 'table_booking',
      relatedEntityId: bookingResult.table_booking_id,
    })
  }

  // Whether a confirmation is known to have reached the guest, so staff can tell them when none
  // did (BK-162). Null when none was due: a walk-in, a blocked booking or no number.
  let notificationSent: boolean | null = null

  if (
    shouldSendBookingSms &&
    normalizedPhone &&
    (
      bookingResult.state === 'confirmed' ||
      bookingResult.state === 'pending_payment'
    )
  ) {
    // A walk-in is standing at the bar. Sending them "your table booking is confirmed" with a
    // link to change or cancel it, while they are being shown to a table, reads as a message
    // about a future booking they have not made. Walk-ins entered without a number were already
    // silent; one entered WITH a number was not, which is the only reason this case existed.
    //
    // The manager email still goes (it skips walk-ins by source), the analytics events below
    // still record, and the booking itself is untouched: only the guest notice is dropped.
    const guestNoticeApplies = payload.walk_in !== true
    const smsSendResult = guestNoticeApplies
      ? await sendTableBookingCreatedSmsIfAllowed(auth.supabase, {
          customerId,
          normalizedPhone,
          bookingResult,
          nextStepUrl
        })
      : null

    if (smsSendResult) {
      notificationSent = smsSendResult.notificationSent === true
    }

    if (!guestNoticeApplies) {
      logger.info('Walk-in booking created, so no guest booking confirmation was sent', {
        metadata: {
          userId: auth.userId,
          tableBookingId: bookingResult.table_booking_id || null,
          state: bookingResult.state
        }
      })
    }

    if (
      bookingResult.state === 'pending_payment' &&
      bookingResult.table_booking_id &&
      smsSendResult?.scheduledFor
    ) {
      holdExpiresAt =
        (await alignTablePaymentHoldToScheduledSend(auth.supabase, {
          tableBookingId: bookingResult.table_booking_id,
          scheduledSendIso: smsSendResult.scheduledFor,
          bookingStartIso: bookingResult.start_datetime || null,
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
        source: 'foh',
        deposit_waived: payload.waive_deposit === true,
        // Record the GRANTED chair count (not the requested figure) and the
        // seating type for reporting.
        high_chairs_granted: bookingResult.high_chairs_granted ?? bookingResult.high_chair_count ?? 0,
        is_outside_seating: bookingResult.is_outside_seating ?? false
      }
    }, {
      userId: auth.userId,
      customerId,
      tableBookingId: bookingResult.table_booking_id,
      eventType: 'table_booking_created'
    })

    if (bookingResult.state === 'pending_payment') {
      await recordFohTableBookingAnalyticsSafe(auth.supabase, {
        customerId,
        tableBookingId: bookingResult.table_booking_id,
        eventType: 'table_deposit_started',
          metadata: {
            hold_expires_at: holdExpiresAt,
            next_step_url_provided: Boolean(nextStepUrl),
            // What the booking function charged, as the guest is asked for it (BK-049).
            deposit_amount: chargedDepositAmount(bookingResult, () =>
              computeDepositAmount(Math.max(1, Number(payload.party_size || 1)), {
                depositWaived: payload.waive_deposit === true,
                isChristmas: isChristmasBooking,
              }),
            ),
            source: 'foh',
          },
      }, {
        userId: auth.userId,
        customerId,
        tableBookingId: bookingResult.table_booking_id,
        eventType: 'table_deposit_started',
      })
    }
  }

  const responseState: FohCreateBookingResponseData['state'] =
    (
      bookingResult.state === 'confirmed' ||
      bookingResult.state === 'pending_payment'
    )
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
        next_step_url: responseState === 'pending_payment' ? nextStepUrl : null,
        hold_expires_at: responseState === 'pending_payment' ? holdExpiresAt : null,
        table_name: bookingResult.table_name || null,
        sunday_preorder_state: sundayPreorderState,
        sunday_preorder_reason: sundayPreorderReason,
        high_chairs_granted: bookingResult.high_chairs_granted ?? bookingResult.high_chair_count ?? 0,
        is_outside_seating: bookingResult.is_outside_seating ?? false,
        notification_sent: notificationSent,
        ...(christmasCoursesSaved === undefined ? {} : { christmas_courses_saved: christmasCoursesSaved }),
        ...(allergiesSaved === undefined ? {} : { allergies_saved: allergiesSaved })
      } satisfies FohCreateBookingResponseData
    },
    { status: responseStatus }
  )
}
