import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage } from '@/lib/utils';
import { formatDateInLondon, toLocalIsoDate } from '@/lib/dateUtils';
import { SmsQueueService } from '@/services/sms-queue';
import { syncCalendarEvent, deleteCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { logAuditEvent } from '@/app/actions/audit';
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { logger } from '@/lib/logger';
import {
  sendBookingConfirmationEmail,
  sendBookingCalendarInvite,
  sendBookingCancelledEmail,
} from '@/lib/email/private-booking-emails';
import type {
  BookingStatus,
  PrivateBookingWithDetails,
} from '@/types/private-bookings';
import {
  type CreatePrivateBookingInput,
  type UpdatePrivateBookingInput,
  type PrivateBookingSmsSideEffectSummary,
  ALLOWED_TRANSITIONS,
  normalizeSmsSafetyMeta,
  toNumber,
  computeHoldExpiry,
  balanceDueMoment,
  DATE_TBD_NOTE,
  DEFAULT_TBD_TIME,
  PRIVATE_BOOKING_INTAKE_FIELDS,
  assertBarTabRules,
  deriveRiskStatus,
} from './types';
import {
  findBookingConflicts,
  checkCapacity,
  getBookingSpaceIds,
  type BookingConflict,
} from './conflicts';
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection';
import {
  privateBookingCreatedMessage,
  bookingConfirmedMessage,
  setupReminderMessage,
  dateChangedMessage,
  bookingCompletedThanksMessage,
  bookingExpiredMessage,
  holdExtendedMessage,
  bookingCancelledHoldMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledPartialRefundMessage,
  bookingCancelledRetentionMessage,
  bookingCancelledReviewPendingMessage,
  bookingCancelledManualReviewMessage,
} from '@/lib/private-bookings/messages';
import {
  getPrivateBookingCancellationOutcome,
  type CancellationFinancialOutcome,
} from '@/services/private-bookings/financial';
import { sendBookingConfirmedSideEffects } from './payments';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function formatPrivateBookingDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
): string {
  if (!value) return ''
  return formatDateInLondon(value, options)
}

 
async function sendCreationSms(booking: any, phone?: string | null): Promise<void> {
  const isTbd = isBookingDateTbd(booking);
  const eventDateReadable = isTbd
    ? 'Date to be confirmed'
    : formatPrivateBookingDate(booking.event_date);

  const depositAmount = toNumber(booking.deposit_amount);

  // Calculate hold expiry (14 days from creation)
  const holdExpiryDate = booking.hold_expiry ? new Date(booking.hold_expiry) : new Date();
  const expiryReadable = formatPrivateBookingDate(holdExpiryDate, {
    day: 'numeric',
    month: 'long'
  });

  const smsMessage = privateBookingCreatedMessage({
    customerFirstName: booking.customer_first_name,
    eventDate: eventDateReadable,
    depositAmount: depositAmount,
    holdExpiry: expiryReadable,
  });

  try {
    const result = await SmsQueueService.queueAndSend({
      booking_id: booking.id,
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: smsMessage,
      customer_phone: phone ?? undefined,
      customer_name: booking.customer_name,
      customer_id: booking.customer_id,
      created_by: booking.created_by,
      priority: 2,
      metadata: {
        template: 'private_booking_created',
        first_name: booking.customer_first_name,
        event_date: eventDateReadable,
        deposit_amount: depositAmount
      }
    });

    const smsSafety = normalizeSmsSafetyMeta(result)
    if (smsSafety.logFailure) {
      logger.error('Private booking created SMS logging failed', {
        metadata: {
          bookingId: booking.id,
          triggerType: 'booking_created',
          templateKey: 'private_booking_created',
          code: smsSafety.code
        }
      })
    }

    if (typeof result?.error === 'string') {
      logger.error('Private booking created SMS queue/send failed', {
        metadata: {
          bookingId: booking.id,
          triggerType: 'booking_created',
          templateKey: 'private_booking_created',
          error: result.error
        }
      })
    }
  } catch (smsError) {
    logger.error('Failed to queue booking created SMS after booking creation:', { error: smsError instanceof Error ? smsError : new Error(String(smsError)) });
  }
}

type CancellationSmsVariant = {
  triggerType:
    | 'booking_cancelled_hold'
    | 'booking_cancelled_refundable'
    | 'booking_cancelled_partial_refund'
    | 'booking_cancelled_retention'
    | 'booking_cancelled_review_pending'
    | 'booking_cancelled_manual_review'
  templateKey:
    | 'private_booking_cancelled_hold'
    | 'private_booking_cancelled_refundable'
    | 'private_booking_cancelled_partial_refund'
    | 'private_booking_cancelled_retention'
    | 'private_booking_cancelled_review_pending'
    | 'private_booking_cancelled_manual_review'
  messageBody: string
  outcome: CancellationFinancialOutcome
  refundAmount: number
  retainedAmount: number
}

/**
 * Manager decision for a sub-30-day cancellation (SOP §14): how much of the
 * paid deposit is retained (0..deposit) and why. Never applied automatically.
 */
export type CancellationRetentionDecision = {
  retainedAmount: number
  reason: string
}

/**
 * SOP §14: cancellations are captured with the written channel they arrived
 * through and when they were received; the processor is recorded separately.
 */
export type CancellationCaptureDetails = {
  channel?: 'email' | 'whatsapp' | 'text' | 'phone' | 'in_person' | 'other'
  receivedAt?: string
}

const UPDATE_BOOKING_BASE_SELECT =
  'status, contact_phone, contact_email, customer_first_name, customer_last_name, customer_name, event_date, start_time, setup_date, setup_time, end_time, end_time_next_day, customer_id, internal_notes, balance_due_date, calendar_event_id, hold_expiry, deposit_paid_date, deposit_amount, guest_count, event_type, source, customer_requests, contract_note, special_requirements, accessibility_needs, has_open_dispute, layout, guest_count_adults, guest_count_under_18, bar_tab_required, bar_tab_limit, bar_tab_prepaid_amount, bar_tab_preauth_reference, outside_food, high_power_equipment, decorations_plan, dogs_expected, special_risk_notes, communication_preference, cleardown_time, risk_status'

const CANCELLED_BOOKING_CORRECTION_FIELDS = new Set([
  'contact_email',
])

const IMMUTABLE_BOOKING_NULLABLE_TEXT_FIELDS = new Set([
  'accessibility_needs',
  'contract_note',
  'customer_requests',
  'end_time',
  'event_type',
  'internal_notes',
  'setup_date',
  'setup_time',
  'source',
  'special_requirements',
])

const IMMUTABLE_BOOKING_TIME_FIELDS = new Set([
  'end_time',
  'setup_time',
  'start_time',
])

function normalizeImmutableBookingValue(key: string, value: unknown): unknown {
  if (value === undefined) {
    return undefined
  }

  if (value === '' && IMMUTABLE_BOOKING_NULLABLE_TEXT_FIELDS.has(key)) {
    return null
  }

  if (typeof value === 'string' && IMMUTABLE_BOOKING_TIME_FIELDS.has(key)) {
    const match = value.match(/^(\d{2}:\d{2})(?::\d{2})?$/)
    if (match) {
      return match[1]
    }
  }

  return value
}

function immutableBookingValuesDiffer(key: string, nextValue: unknown, currentValue: unknown): boolean {
  return normalizeImmutableBookingValue(key, nextValue) !== normalizeImmutableBookingValue(key, currentValue)
}

function isMissingDateTbdColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as { code?: unknown; message?: unknown; details?: unknown }
  const text = `${String(candidate.code ?? '')} ${String(candidate.message ?? '')} ${String(candidate.details ?? '')}`.toLowerCase()

  return text.includes('date_tbd') && (
    text.includes('schema cache') ||
    text.includes('column') ||
    text.includes('does not exist') ||
    text.includes('pgrst204')
  )
}

/**
 * Resolve the cancellation SMS variant for a booking from its financial
 * outcome. Returns the trigger/template keys and the rendered message body
 * so `cancelBooking()` and the status-change cancel path in `updateBooking()`
 * can queue a single variant-specific SMS instead of the generic
 * `booking_cancelled` placeholder that Wave 2 left in place.
 */
async function resolveCancellationSmsVariant(input: {
  bookingId: string
  customerFirstName: string | null | undefined
  eventDate: string
  retentionDecision?: CancellationRetentionDecision | null
}): Promise<CancellationSmsVariant> {
  const outcome = await getPrivateBookingCancellationOutcome(input.bookingId)

  switch (outcome.outcome) {
    case 'no_money':
      return {
        triggerType: 'booking_cancelled_hold',
        templateKey: 'private_booking_cancelled_hold',
        messageBody: bookingCancelledHoldMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'refundable':
      return {
        triggerType: 'booking_cancelled_refundable',
        templateKey: 'private_booking_cancelled_refundable',
        messageBody: bookingCancelledRefundableMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
          refundAmount: outcome.refund_amount,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'deposit_partial_refund':
      return {
        triggerType: 'booking_cancelled_partial_refund',
        templateKey: 'private_booking_cancelled_partial_refund',
        messageBody: bookingCancelledPartialRefundMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
          refundAmount: outcome.refund_amount,
          deductionAmount: outcome.deposit_deduction,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'gm_review_required': {
      // SOP §14: retention up to the full deposit is a manager decision.
      const decision = input.retentionDecision
      if (!decision) {
        // Cancelled before a retention decision exists (e.g. edit-form path):
        // tell the customer the payment review is in progress — never assert
        // an automatic retention.
        return {
          triggerType: 'booking_cancelled_review_pending',
          templateKey: 'private_booking_cancelled_review_pending',
          messageBody: bookingCancelledReviewPendingMessage({
            customerFirstName: input.customerFirstName,
            eventDate: input.eventDate,
          }),
          outcome: outcome.outcome,
          refundAmount: outcome.refund_amount,
          retainedAmount: 0,
        }
      }

      const retained = Math.min(Math.max(decision.retainedAmount, 0), outcome.max_retainable)
      const refundTotal = outcome.refund_amount + (outcome.max_retainable - retained)

      if (retained <= 0) {
        return {
          triggerType: 'booking_cancelled_refundable',
          templateKey: 'private_booking_cancelled_refundable',
          messageBody: bookingCancelledRefundableMessage({
            customerFirstName: input.customerFirstName,
            eventDate: input.eventDate,
            refundAmount: refundTotal,
          }),
          outcome: outcome.outcome,
          refundAmount: refundTotal,
          retainedAmount: 0,
        }
      }

      return {
        triggerType: 'booking_cancelled_retention',
        templateKey: 'private_booking_cancelled_retention',
        messageBody: bookingCancelledRetentionMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
          retainedAmount: retained,
          refundAmount: refundTotal,
        }),
        outcome: outcome.outcome,
        refundAmount: refundTotal,
        retainedAmount: retained,
      }
    }
    case 'manual_review':
    default:
      return {
        triggerType: 'booking_cancelled_manual_review',
        templateKey: 'private_booking_cancelled_manual_review',
        messageBody: bookingCancelledManualReviewMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
        }),
        outcome: 'manual_review',
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
  }
}

// ---------------------------------------------------------------------------
// SOP compliance helpers (intake, risk, conflicts, waiver, electricity)
// ---------------------------------------------------------------------------

const ELECTRICITY_CHARGE_DESCRIPTION = 'Electricity charge — high-power equipment'

// Waiver-package name fallback — used ONLY when catering_packages.requires_waiver
// is unavailable (pre-migration schema). Flag-first everywhere else (SOP §21).
const WAIVER_PACKAGE_NAME_PATTERN = /bring your own|self[\s-]?cater|\bbyo\b/i

function formatConflictError(conflict: BookingConflict): string {
  return `Space conflict: ${conflict.space_name} is held by ${conflict.customer_name || 'another booking'} (${conflict.booking_status}) from ${conflict.occupies_from} to ${conflict.occupies_until}`
}

/**
 * SOP §6/§28: block bookings whose spaces clash with existing holds/confirmed
 * bookings, or whose guest count exceeds the safe capacity for the layout.
 * Genuine conflicts and capacity breaches throw; infrastructure failures fail
 * open (logged) so a broken check never blocks the flow.
 */
async function assertSpaceAvailabilityAndCapacity(input: {
  spaceIds: string[]
  eventDate: string
  startTime?: string | null
  endTime?: string | null
  setupDate?: string | null
  setupTime?: string | null
  cleardownTime?: string | null
  excludeBookingId?: string | null
  guestCount?: number | null
  layout?: 'seated' | 'standing' | 'mixed' | null
  skipCapacity?: boolean
}): Promise<void> {
  if (input.spaceIds.length === 0) return

  // findBookingConflicts fails open internally (returns [] on RPC errors), so
  // any conflicts returned here are genuine.
  const conflicts = await findBookingConflicts({
    eventDate: input.eventDate,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    setupDate: input.setupDate ?? null,
    setupTime: input.setupTime ?? null,
    cleardownTime: input.cleardownTime ?? null,
    spaceIds: input.spaceIds,
    excludeBookingId: input.excludeBookingId ?? null,
  })
  if (conflicts.length > 0) {
    throw new Error(formatConflictError(conflicts[0]))
  }

  if (input.skipCapacity) return

  let spacesForCapacity: Array<{ name: string; capacity_seated?: number | null; capacity_standing?: number | null }> | null = null
  try {
    const admin = createAdminClient()
    const { data: spaces, error } = await admin
      .from('venue_spaces')
      .select('name, capacity_seated, capacity_standing')
      .in('id', input.spaceIds)
    if (error) throw new Error(error.message)
    spacesForCapacity = spaces || []
  } catch (spacesError) {
    // Fail open: a broken lookup must never block the booking flow.
    logger.error('Capacity check skipped: failed to load venue spaces', {
      error: spacesError instanceof Error ? spacesError : new Error(String(spacesError)),
      metadata: { spaceIds: input.spaceIds },
    })
  }

  if (spacesForCapacity) {
    const capacityResult = checkCapacity({
      spaces: spacesForCapacity,
      guestCount: input.guestCount ?? null,
      layout: input.layout ?? null,
    })
    if (!capacityResult.ok) {
      throw new Error(capacityResult.reason || 'Guest count exceeds the capacity for the selected space')
    }
  }
}

/**
 * SOP §17: ensure exactly one £25 electricity line exists for approved
 * high-power or amplified equipment. Never duplicates; never removes.
 */
async function ensureElectricityChargeItem(
  admin: ReturnType<typeof createAdminClient>,
  bookingId: string
): Promise<void> {
  const { data: existing, error: lookupError } = await admin
    .from('private_booking_items')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('description', ELECTRICITY_CHARGE_DESCRIPTION)
    .limit(1)
  if (lookupError) throw new Error(lookupError.message)
  if (existing && existing.length > 0) return

  const { error: insertError } = await admin.from('private_booking_items').insert({
    booking_id: bookingId,
    item_type: 'other',
    description: ELECTRICITY_CHARGE_DESCRIPTION,
    quantity: 1,
    unit_price: 25,
    vat_rate: 20,
  })
  if (insertError) throw new Error(insertError.message)
}

/**
 * Post-create follow-up: the create RPC ignores unknown keys, so the §9 intake
 * fields (plus the derived §18 risk status and any §17 electricity line) are
 * persisted with one admin UPDATE. Failures are logged, never thrown — the
 * booking itself already exists.
 */
async function applyIntakeFollowUp(bookingId: string, input: CreatePrivateBookingInput): Promise<void> {
  try {
    const admin = createAdminClient()

    const intakeUpdate: Record<string, unknown> = {}
    for (const field of PRIVATE_BOOKING_INTAKE_FIELDS) {
      const value = (input as Record<string, unknown>)[field]
      if (value !== undefined) {
        intakeUpdate[field] = value === '' ? null : value
      }
    }

    // SOP §18/§6.7: derive the initial risk status — no GM decision can exist
    // at creation, so the derived value always applies.
    const derivedRisk = deriveRiskStatus(input)
    if (Object.keys(intakeUpdate).length > 0 || derivedRisk !== 'normal') {
      intakeUpdate.risk_status = derivedRisk
      const { error } = await admin.from('private_bookings').update(intakeUpdate).eq('id', bookingId)
      if (error) throw new Error(error.message)
    }

    if (input.high_power_equipment === true) {
      await ensureElectricityChargeItem(admin, bookingId)
    }
  } catch (intakeError) {
    logger.error('Private booking intake follow-up failed (non-blocking)', {
      error: intakeError instanceof Error ? intakeError : new Error(String(intakeError)),
      metadata: { bookingId },
    })
  }
}

/**
 * SOP §21: keep waiver_status in step with the booking's catering items.
 * Flag-first (catering_packages.requires_waiver); the name pattern is only a
 * fallback when the flag column is unavailable. 'not_required' ⇄ 'required'
 * only — never downgrades 'sent' / 'signed' / 'overdue'. Also marks
 * outside_food when a waiver package is present.
 */
async function reconcileWaiverStatus(bookingId: string, performedByUserId?: string): Promise<void> {
  const admin = createAdminClient()

  const { data: bookingRow, error: bookingError } = await admin
    .from('private_bookings')
    .select('id, waiver_status, outside_food')
    .eq('id', bookingId)
    .single()
  if (bookingError || !bookingRow) {
    throw new Error(bookingError?.message || 'Booking not found for waiver reconciliation')
  }

  let waiverRequired = false
  const { data: flaggedItems, error: flaggedError } = await admin
    .from('private_booking_items')
    .select('id, package:catering_packages(id, name, requires_waiver)')
    .eq('booking_id', bookingId)
    .eq('item_type', 'catering')

  if (flaggedError) {
    // Fallback ONLY when the requires_waiver column errors: match by name.
    const { data: namedItems, error: namedError } = await admin
      .from('private_booking_items')
      .select('id, package:catering_packages(id, name)')
      .eq('booking_id', bookingId)
      .eq('item_type', 'catering')
    if (namedError) throw new Error(namedError.message)
    waiverRequired = (namedItems || []).some((item: any) =>
      WAIVER_PACKAGE_NAME_PATTERN.test(item.package?.name || '')
    )
  } else {
    waiverRequired = (flaggedItems || []).some((item: any) => item.package?.requires_waiver === true)
  }

  const currentStatus = (bookingRow as any).waiver_status || 'not_required'
  let nextStatus: string | null = null
  if (waiverRequired && currentStatus === 'not_required') {
    nextStatus = 'required'
  } else if (!waiverRequired && currentStatus === 'required') {
    nextStatus = 'not_required'
  }

  const updates: Record<string, unknown> = {}
  if (nextStatus) updates.waiver_status = nextStatus
  if (waiverRequired && (bookingRow as any).outside_food !== true) updates.outside_food = true
  if (Object.keys(updates).length === 0) return

  const { error: updateError } = await admin
    .from('private_bookings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', bookingId)
  if (updateError) throw new Error(updateError.message)

  if (nextStatus) {
    const { error: auditError } = await admin.from('private_booking_audit').insert({
      booking_id: bookingId,
      action: 'field_updated',
      field_name: 'waiver_status',
      old_value: currentStatus,
      new_value: nextStatus,
      performed_by: performedByUserId ?? null,
      metadata: { via: 'booking_items_reconciliation' },
    })
    if (auditError) {
      logger.error('Failed to audit waiver status change (non-blocking)', {
        error: new Error(auditError.message),
        metadata: { bookingId, nextStatus },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Create booking
// ---------------------------------------------------------------------------

 
export async function createBooking(input: CreatePrivateBookingInput): Promise<any> {
  const supabase = await createClient();

  // 1. Prepare Data
  const finalEventDate = input.event_date || toLocalIsoDate(new Date());
  const finalStartTime = input.start_time || DEFAULT_TBD_TIME;

  let internalNotes = input.internal_notes;
  if (input.date_tbd) {
    if (!internalNotes) {
      internalNotes = DATE_TBD_NOTE;
    } else if (!internalNotes.includes(DATE_TBD_NOTE)) {
      internalNotes = `${internalNotes}\n${DATE_TBD_NOTE}`;
    }
  }

  const currentDateTime = new Date();
  const actualEventDate = new Date(finalEventDate);
  const dueMoment = balanceDueMoment(actualEventDate);
  const isShortNotice = !input.date_tbd && currentDateTime.getTime() > dueMoment.getTime();

  // Balance & final details are due 14 calendar days before the event
  // (SOP §13). Bookings created inside that window are due immediately.
  let balanceDueDate = input.balance_due_date;
  if (!balanceDueDate && finalEventDate && !input.date_tbd) {
    balanceDueDate = isShortNotice
      ? toLocalIsoDate(currentDateTime)
      : toLocalIsoDate(dueMoment);
  }

  const depositAmount = input.deposit_amount ?? 250;
  const requiresDeposit = depositAmount > 0;

  // SOP §12: the £250 default deposit may only be reduced with a recorded
  // reason (General Manager discretion); £0 requires an explicit waiver.
  if (depositAmount === 0) {
    if (!input.deposit_waived || !(input.deposit_waived_reason || '').trim()) {
      throw new Error('A £0 deposit requires a General Manager waiver with a reason');
    }
  } else if (depositAmount < 250 && !(input.deposit_reduction_reason || '').trim()) {
    throw new Error('Reducing the deposit below £250 requires a reason (General Manager discretion)');
  }

  // SOP §12: bar tabs need a recorded limit and pre-payment/pre-authorisation.
  assertBarTabRules(input);

  // SOP §6/§28: conflict + capacity gate for real-dated bookings with spaces.
  const requestedSpaceIds = Array.from(new Set(
    (input.items || [])
      .filter((item) => item.item_type === 'space' && item.space_id)
      .map((item) => item.space_id as string)
  ));
  if (requestedSpaceIds.length > 0 && !input.date_tbd && input.event_date) {
    await assertSpaceAvailabilityAndCapacity({
      spaceIds: requestedSpaceIds,
      eventDate: input.event_date,
      startTime: input.start_time ?? null,
      endTime: input.end_time ?? null,
      setupDate: input.setup_date ?? null,
      setupTime: input.setup_time ?? null,
      cleardownTime: input.cleardown_time ?? null,
      guestCount: input.guest_count ?? null,
      layout: input.layout ?? null,
    });
  }

  let holdExpiryMoment: Date | null = null;

  // Logic for Deposit Due Date (Hold Expiry) — a hold must never run past the
  // balance & final-details deadline (SOP §10).
  if (!requiresDeposit || input.date_tbd) {
    holdExpiryMoment = null;
  } else if (input.hold_expiry) {
    // User manually specified a date
    holdExpiryMoment = new Date(input.hold_expiry);

    if (!isShortNotice) {
      if (holdExpiryMoment.getTime() > dueMoment.getTime()) {
        holdExpiryMoment = dueMoment;
      }
    } else {
      if (holdExpiryMoment.getTime() > actualEventDate.getTime()) {
        holdExpiryMoment = actualEventDate;
      }
    }
  } else {
    // Default auto-calculation
    holdExpiryMoment = computeHoldExpiry(actualEventDate, currentDateTime);
  }

  const holdExpiryIso = holdExpiryMoment ? holdExpiryMoment.toISOString() : null;

  const normalizedContactPhone =
    input.contact_phone && input.contact_phone.trim() !== ''
      ? formatPhoneForStorage(input.contact_phone.trim(), {
          defaultCountryCode: input.default_country_code
        })
      : null;

  const normalizedContactEmail =
    input.contact_email && input.contact_email.trim() !== ''
      ? input.contact_email.trim().toLowerCase()
      : null;

  // Always resolve customer through the shared lookup-first helper.
  let resolvedCustomerId = input.customer_id ?? null;
  if (!resolvedCustomerId && normalizedContactPhone) {
    const ensured = await ensureCustomerForPhone(createAdminClient(), normalizedContactPhone, {
      firstName: input.customer_first_name,
      lastName: input.customer_last_name?.trim() || undefined,
      email: normalizedContactEmail
    });
    resolvedCustomerId = ensured.customerId;
  }

  if (!resolvedCustomerId) {
    throw new Error('Private booking must include a linked customer (customer_id or contact_phone)');
  }

  const bookingPayload = {
    ...input,
    contact_phone: normalizedContactPhone,
    contact_email: normalizedContactEmail,
    customer_id: resolvedCustomerId,
    event_date: finalEventDate,
    start_time: finalStartTime,
    internal_notes: internalNotes,
    balance_due_date: balanceDueDate,
    hold_expiry: holdExpiryIso,
    customer_name: input.customer_last_name
      ? `${input.customer_first_name} ${input.customer_last_name}`
      : input.customer_first_name,
    deposit_amount: depositAmount,
    status: requiresDeposit ? 'draft' : 'confirmed',
    date_tbd: input.date_tbd ? true : false,
  };

  // 2. Atomic Transaction
  const { data: booking, error } = await supabase.rpc('create_private_booking_transaction', {
    p_booking_data: bookingPayload,
    p_items: input.items || [],
    p_customer_data: null
  });

  if (error) {
    logger.error('Create private booking transaction error:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error('Failed to create private booking');
  }

  // 2b. Intake follow-up (SOP §9/§17/§18): the create RPC ignores unknown
  // keys, so persist the intake fields + derived risk status with one admin
  // UPDATE (non-blocking on failure).
  if (booking) {
    await applyIntakeFollowUp(booking.id, input);
  }

  // 3. Side Effects (Fire and Forget / Non-blocking mostly)

  // SMS
  if (booking) {
    const bookingForSideEffects = { ...bookingPayload, ...booking, hold_expiry: holdExpiryIso };
    if (requiresDeposit) {
      void sendCreationSms(bookingForSideEffects, normalizedContactPhone).catch((smsError) => {
        logger.error('Private booking creation SMS background task failed', {
          error: smsError instanceof Error ? smsError : new Error(String(smsError)),
          metadata: { bookingId: booking.id }
        })
      })
    } else {
      void sendBookingConfirmedSideEffects({
        booking: bookingForSideEffects,
        performedByUserId: (booking as any).created_by ?? (bookingPayload as any).created_by,
        analyticsVia: 'private_booking_no_deposit_create',
        syncCalendar: false,
      }).catch((smsError) => {
        logger.error('Private booking no-deposit confirmation side effects failed', {
          error: smsError instanceof Error ? smsError : new Error(String(smsError)),
          metadata: { bookingId: booking.id }
        })
      })
    }
  }

  // Google Calendar Sync
  if (booking && isCalendarConfigured()) {
    const bookingForCalendar = { ...bookingPayload, ...booking, hold_expiry: holdExpiryIso } as PrivateBookingWithDetails
    const isDateTbdBooking = Boolean(bookingForCalendar.internal_notes?.includes(DATE_TBD_NOTE))
    if (!isDateTbdBooking && booking.status !== 'cancelled') {
      try {
        const eventId = await syncCalendarEvent(bookingForCalendar);
        if (eventId) {
          const { data: updatedCalendarRow, error: calendarUpdateError } = await createAdminClient()
            .from('private_bookings')
            .update({ calendar_event_id: eventId })
            .eq('id', booking.id)
            .select('id')
            .maybeSingle();

          if (calendarUpdateError) {
            logger.error('Failed to persist calendar_event_id after booking create:', { error: calendarUpdateError instanceof Error ? calendarUpdateError : new Error(String(calendarUpdateError)) });
          } else if (!updatedCalendarRow) {
            logger.error('Failed to persist calendar_event_id after booking create: booking row not found', { error: new Error('Failed to persist calendar_event_id after booking create: booking row not found') });
          }
        }
      } catch (e) {
        logger.error('Calendar sync failed:', { error: e instanceof Error ? e : new Error(String(e)) });
      }
    }
  }

  return booking;
}

// ---------------------------------------------------------------------------
// Update booking
// ---------------------------------------------------------------------------

 
export async function updateBooking(id: string, input: UpdatePrivateBookingInput, performedByUserId?: string): Promise<any> {
  const supabase = await createClient();

  // 1. Get Current Booking
  let hasDateTbdColumn = true;
  let currentBookingResult = await supabase
    .from('private_bookings')
    .select(`${UPDATE_BOOKING_BASE_SELECT}, date_tbd`)
    .eq('id', id)
    .single();

  if (currentBookingResult.error && isMissingDateTbdColumnError(currentBookingResult.error)) {
    hasDateTbdColumn = false;
    currentBookingResult = await supabase
      .from('private_bookings')
      .select(UPDATE_BOOKING_BASE_SELECT)
      .eq('id', id)
      .single();
  }

  const { data: currentBooking, error: fetchError } = currentBookingResult;

  if (fetchError || !currentBooking) {
    throw new Error('Booking not found');
  }

  if (input.status && input.status !== currentBooking.status) {
    const allowed = ALLOWED_TRANSITIONS[currentBooking.status as BookingStatus] ?? [];
    if (!allowed.includes(input.status as BookingStatus)) {
      throw new Error(`Cannot transition booking from '${currentBooking.status}' to '${input.status}'`);
    }
  }

  // SOP §12: deposit reductions below £250 need a recorded reason; £0 needs an
  // explicit GM waiver. Enforced on the edit path too (mirrors createBooking).
  const depositChanged =
    input.deposit_amount !== undefined &&
    !currentBooking.deposit_paid_date &&
    toNumber(input.deposit_amount) !== toNumber(currentBooking.deposit_amount)
  if (depositChanged) {
    const nextDeposit = toNumber(input.deposit_amount)
    if (nextDeposit === 0) {
      if (!input.deposit_waived || !(input.deposit_waived_reason || '').trim()) {
        throw new Error('A £0 deposit requires a General Manager waiver with a reason')
      }
    } else if (nextDeposit < 250 && !(input.deposit_reduction_reason || '').trim()) {
      throw new Error('Reducing the deposit below £250 requires a reason (General Manager discretion)')
    }
  }

  // SOP §12: bar tab rules on the edit path — merge partial input with the
  // current values so a limit-only edit is still validated against the flag.
  const barTabTouched =
    input.bar_tab_required !== undefined ||
    input.bar_tab_limit !== undefined ||
    input.bar_tab_prepaid_amount !== undefined ||
    input.bar_tab_preauth_reference !== undefined
  if (barTabTouched) {
    assertBarTabRules({
      bar_tab_required: input.bar_tab_required ?? (currentBooking as any).bar_tab_required,
      bar_tab_limit: input.bar_tab_limit ?? (currentBooking as any).bar_tab_limit,
      bar_tab_prepaid_amount: input.bar_tab_prepaid_amount ?? (currentBooking as any).bar_tab_prepaid_amount,
      bar_tab_preauth_reference: input.bar_tab_preauth_reference ?? (currentBooking as any).bar_tab_preauth_reference,
    })
  }

  let completedStatusAlreadyMessaged = false;
  if (input.status === 'completed' && currentBooking.status !== 'completed') {
    const admin = createAdminClient();
    const { count, error: duplicateCheckError } = await admin
      .from('private_booking_sms_queue')
      .select('*', { count: 'exact', head: true })
      .eq('booking_id', id)
      .eq('trigger_type', 'booking_completed')
      .in('status', ['pending', 'approved', 'sent']);

    if (duplicateCheckError) {
      logger.error('Failed to verify completed-booking SMS duplicate guard:', { error: duplicateCheckError instanceof Error ? duplicateCheckError : new Error(String(duplicateCheckError)) });
      throw new Error('Failed completed-booking SMS duplicate safety check');
    }

    completedStatusAlreadyMessaged = (count ?? 0) > 0;
  }

  // 2. Prepare Updates
  const finalEventDate = input.event_date || currentBooking.event_date || toLocalIsoDate(new Date());

  // Check if event date changed and booking is in draft to reset hold
  let holdExpiryIso = undefined;
  const dateChanged = input.event_date && input.event_date !== currentBooking.event_date;

  if (dateChanged && currentBooking.status === 'draft') {
    const currentDateTime = new Date();
    const newEventDate = input.event_date ? new Date(input.event_date) : new Date(finalEventDate);

    holdExpiryIso = computeHoldExpiry(newEventDate, currentDateTime).toISOString();
  }

  const finalStartTime = input.start_time || currentBooking.start_time || DEFAULT_TBD_TIME;

  let endTimeNextDay = currentBooking.end_time_next_day ?? false;
  const cleanedEndTime = input.end_time || (input.end_time === '' ? null : undefined);

  if (cleanedEndTime) {
    const [startHour, startMin] = finalStartTime.split(':').map(Number);
    const [endHour, endMin] = cleanedEndTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    endTimeNextDay = endMinutes <= startMinutes;
  } else if (cleanedEndTime === null) {
    endTimeNextDay = false;
  }

  let internalNotes = input.internal_notes ?? currentBooking.internal_notes ?? null;

  if (input.date_tbd) {
    if (!internalNotes) {
      internalNotes = DATE_TBD_NOTE;
    } else if (!internalNotes.includes(DATE_TBD_NOTE)) {
      internalNotes = `${internalNotes}\n${DATE_TBD_NOTE}`;
    }
  } else if (input.date_tbd === false && internalNotes?.includes(DATE_TBD_NOTE)) {
    internalNotes =
      internalNotes
        .split('\n')
        .filter((line: string) => line.trim() !== DATE_TBD_NOTE)
        .join('\n')
        .trim() || null;
  }

  const normalizedContactPhone =
    input.contact_phone === undefined
      ? undefined
      : input.contact_phone.trim() === ''
        ? null
        : formatPhoneForStorage(input.contact_phone.trim(), {
            defaultCountryCode: input.default_country_code
          });

  const normalizedContactEmail =
    input.contact_email === undefined
      ? undefined
      : input.contact_email.trim() === ''
        ? null
        : input.contact_email.trim().toLowerCase();

  const normalizedSetupDate =
    input.setup_date === undefined
      ? undefined
      : input.setup_date.trim() === ''
        ? null
        : input.setup_date;

  const normalizedSetupTime =
    input.setup_time === undefined
      ? undefined
      : input.setup_time.trim() === ''
        ? null
        : input.setup_time;

  const customer_name = input.customer_last_name
    ? `${input.customer_first_name} ${input.customer_last_name}`
    : input.customer_first_name || undefined;

   
  const updatePayload: any = {
    ...input,
    customer_name,
    contact_phone: normalizedContactPhone,
    contact_email: normalizedContactEmail,
    event_date: finalEventDate,
    start_time: finalStartTime,
    setup_date: normalizedSetupDate,
    setup_time: normalizedSetupTime,
    end_time: cleanedEndTime,
    end_time_next_day: endTimeNextDay,
    internal_notes: internalNotes,
    hold_expiry: holdExpiryIso,
    updated_at: new Date().toISOString()
  };

  // Remove non-column fields.
  delete updatePayload.items;
  delete updatePayload.default_country_code;
  delete updatePayload.deposit_reduction_reason;
  delete updatePayload.date_change_reason;

  // cleardown_time is a time column — an empty string means "clear it".
  if (typeof updatePayload.cleardown_time === 'string' && updatePayload.cleardown_time.trim() === '') {
    updatePayload.cleardown_time = null;
  }

  // SOP §18: re-derive risk status when risk-relevant intake changes — but
  // never overwrite a GM decision ('approved' / 'rejected').
  const riskInputsTouched =
    input.event_type !== undefined ||
    input.guest_count !== undefined ||
    input.guest_count_under_18 !== undefined ||
    input.outside_food !== undefined ||
    input.high_power_equipment !== undefined ||
    input.special_risk_notes !== undefined
  const currentRiskStatus = ((currentBooking as any).risk_status as string | undefined) ?? 'normal'
  if (riskInputsTouched && !['approved', 'rejected'].includes(currentRiskStatus)) {
    const derivedRisk = deriveRiskStatus({
      event_type: input.event_type ?? currentBooking.event_type,
      guest_count: input.guest_count ?? currentBooking.guest_count,
      guest_count_under_18: input.guest_count_under_18 ?? (currentBooking as any).guest_count_under_18,
      outside_food: input.outside_food ?? (currentBooking as any).outside_food,
      high_power_equipment: input.high_power_equipment ?? (currentBooking as any).high_power_equipment,
      special_risk_notes: input.special_risk_notes ?? (currentBooking as any).special_risk_notes,
    })
    // Only write when it actually changes — a no-op write would create a
    // spurious audit entry and trip the cancelled/completed immutability guard.
    if (derivedRisk !== currentRiskStatus) {
      updatePayload.risk_status = derivedRisk
    }
  }

  // Deposit waiver columns only move when the deposit amount itself changes:
  // £0 records the waiver; any positive amount clears it.
  if (depositChanged) {
    const nextDeposit = toNumber(input.deposit_amount)
    updatePayload.deposit_waived = nextDeposit === 0
    updatePayload.deposit_waived_reason = nextDeposit === 0 ? (input.deposit_waived_reason || null) : null
  } else {
    delete updatePayload.deposit_waived
    delete updatePayload.deposit_waived_reason
  }

  // Handle TBD transitions
  const wasTbd = isBookingDateTbd(currentBooking);
  if (input.date_tbd === true && !wasTbd) {
    // Real date -> TBD transition
    updatePayload.date_tbd = true;
    updatePayload.hold_expiry = null;
    updatePayload.balance_due_date = null;
  } else if (input.date_tbd === false && wasTbd) {
    // TBD -> real date transition
    updatePayload.date_tbd = false;
    updatePayload.balance_due_date = null; // trigger will recalculate
    // Compute hold_expiry for the now-real date
    if (currentBooking.status === 'draft') {
      const newEventDate = new Date(finalEventDate);
      updatePayload.hold_expiry = computeHoldExpiry(newEventDate, new Date()).toISOString();
    }
  } else if (input.date_tbd) {
    // Still TBD — keep nulls
    updatePayload.balance_due_date = null;
    updatePayload.hold_expiry = null;
  }

  if (!hasDateTbdColumn) {
    delete updatePayload.date_tbd;
  }

  // Clean up undefined values
  Object.keys(updatePayload).forEach(key => updatePayload[key] === undefined && delete updatePayload[key]);

  if (input.status === 'cancelled' && currentBooking.status !== 'cancelled') {
    updatePayload.cancellation_reason = 'Cancelled via edit form';
    updatePayload.cancelled_at = new Date().toISOString();
  }

  const immutableStatuses = ['completed', 'cancelled'];
  if (immutableStatuses.includes(currentBooking.status as string)) {
    const changedNonStatusKeys = Object.keys(updatePayload).filter(k =>
      k !== 'status' &&
      k !== 'updated_at' &&
      updatePayload[k] !== undefined &&
      immutableBookingValuesDiffer(k, updatePayload[k], currentBooking[k as keyof typeof currentBooking])
    );
    const disallowedChangedKeys = changedNonStatusKeys.filter(k =>
      currentBooking.status !== 'cancelled' || !CANCELLED_BOOKING_CORRECTION_FIELDS.has(k)
    )
    if (disallowedChangedKeys.length > 0) {
      throw new Error(`Cannot edit a ${currentBooking.status} booking. Only status changes are allowed.`);
    }
  }

  // SOP §6/§28: when the event timing moves on a real-dated booking with space
  // items, re-check conflicts against other holds/confirmed bookings.
  const startTimeChanged = input.start_time !== undefined &&
    immutableBookingValuesDiffer('start_time', finalStartTime, currentBooking.start_time)
  const endTimeChangedForConflicts = cleanedEndTime !== undefined &&
    immutableBookingValuesDiffer('end_time', cleanedEndTime, currentBooking.end_time)
  const setupTouched = normalizedSetupDate !== undefined || normalizedSetupTime !== undefined
  const cleardownTouched = input.cleardown_time !== undefined
  const timingChanged = Boolean(dateChanged) || startTimeChanged || endTimeChangedForConflicts || setupTouched || cleardownTouched
  const effectiveDateTbd = input.date_tbd ?? wasTbd

  if (timingChanged && !effectiveDateTbd && finalEventDate) {
    const bookingSpaceIds = await getBookingSpaceIds(id)
    if (bookingSpaceIds.length > 0) {
      await assertSpaceAvailabilityAndCapacity({
        spaceIds: bookingSpaceIds,
        eventDate: finalEventDate,
        startTime: finalStartTime,
        endTime: cleanedEndTime === undefined ? (currentBooking.end_time as string | null) : cleanedEndTime,
        setupDate: normalizedSetupDate === undefined ? (currentBooking.setup_date as string | null) : normalizedSetupDate,
        setupTime: normalizedSetupTime === undefined ? (currentBooking.setup_time as string | null) : normalizedSetupTime,
        cleardownTime: input.cleardown_time !== undefined
          ? (input.cleardown_time || null)
          : ((currentBooking as any).cleardown_time ?? null),
        excludeBookingId: id,
        skipCapacity: true,
      })
    }
  }

  // 3. Perform Update
  const { data: updatedBooking, error } = await supabase
    .from('private_bookings')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('Error updating private booking:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error('Failed to update private booking');
  }

  if (!updatedBooking) {
    throw new Error('Booking not found');
  }

  // SOP §15.6: audit the date change (original date, new date, reason, approver).
  if (dateChanged) {
    try {
      const { error: dateAuditError } = await createAdminClient().from('private_booking_audit').insert({
        booking_id: id,
        action: 'date_changed',
        field_name: 'event_date',
        old_value: String(currentBooking.event_date ?? ''),
        new_value: String(updatedBooking.event_date ?? ''),
        performed_by: performedByUserId ?? null,
        metadata: {
          reason: input.date_change_reason ?? null,
          approved_by: performedByUserId ?? null,
        },
      })
      if (dateAuditError) throw new Error(dateAuditError.message)
    } catch (dateAuditFailure) {
      logger.error('Failed to audit private booking date change (non-blocking)', {
        error: dateAuditFailure instanceof Error ? dateAuditFailure : new Error(String(dateAuditFailure)),
        metadata: { bookingId: id },
      })
    }
  }

  // SOP §28: field-level audit diffs for key commercial/contact fields
  // (event_date is covered by the date_changed entry above).
  try {
    const auditedFieldKeys = [
      'start_time', 'end_time', 'guest_count', 'deposit_amount', 'balance_due_date',
      'contact_phone', 'contact_email', 'layout', 'bar_tab_limit',
    ]
    const stringifyAuditValue = (key: string, value: unknown): string => {
      const normalised = normalizeImmutableBookingValue(key, value)
      return normalised === null || normalised === undefined ? '' : String(normalised)
    }
    const fieldAuditRows = auditedFieldKeys
      .filter((key) => key in updatePayload)
      .map((key) => ({
        key,
        oldValue: stringifyAuditValue(key, (currentBooking as any)[key]),
        newValue: stringifyAuditValue(key, updatePayload[key]),
      }))
      .filter((row) => row.oldValue !== row.newValue)
      .map((row) => ({
        booking_id: id,
        action: 'field_updated',
        field_name: row.key,
        old_value: row.oldValue,
        new_value: row.newValue,
        performed_by: performedByUserId ?? null,
      }))
    if (fieldAuditRows.length > 0) {
      const { error: fieldAuditError } = await createAdminClient()
        .from('private_booking_audit')
        .insert(fieldAuditRows)
      if (fieldAuditError) throw new Error(fieldAuditError.message)
    }
  } catch (fieldAuditFailure) {
    logger.error('Failed to write private booking field audit rows (non-blocking)', {
      error: fieldAuditFailure instanceof Error ? fieldAuditFailure : new Error(String(fieldAuditFailure)),
      metadata: { bookingId: id },
    })
  }

  // SOP §17: add the £25 electricity line when high-power equipment is newly flagged.
  if (input.high_power_equipment === true && (currentBooking as any).high_power_equipment !== true) {
    try {
      await ensureElectricityChargeItem(createAdminClient(), id)
    } catch (electricityError) {
      logger.error('Failed to add electricity charge item (non-blocking)', {
        error: electricityError instanceof Error ? electricityError : new Error(String(electricityError)),
        metadata: { bookingId: id },
      })
    }
  }

  const smsSideEffects: Array<{
    triggerType: string
    templateKey: string
    queueId?: string
    sent?: boolean
    suppressed?: boolean
    requiresApproval?: boolean
    code?: string | null
    logFailure?: boolean
    error?: string
  }> = []

  let abortSmsSideEffects = false

   
  const captureSmsSideEffect = (triggerType: string, templateKey: string, result: any) => {
    const safety = normalizeSmsSafetyMeta(result)
    const summary = {
      triggerType,
      templateKey,
      queueId: typeof result?.queueId === 'string' ? result.queueId : undefined,
      sent: result?.sent === true,
      suppressed: result?.suppressed === true,
      requiresApproval: result?.requiresApproval === true,
      code: safety.code,
      logFailure: safety.logFailure,
      error: typeof result?.error === 'string' ? result.error : undefined
    }

    smsSideEffects.push(summary)

    if (safety.fatal) {
      abortSmsSideEffects = true
    }

    if (summary.logFailure) {
      logger.error('Private booking SMS logging failed', {
        metadata: {
          bookingId: id,
          triggerType,
          templateKey,
          code: summary.code
        }
      })
    }

    if (summary.error) {
      logger.error('Private booking SMS queue/send failed', {
        metadata: {
          bookingId: id,
          triggerType,
          templateKey,
          error: summary.error
        }
      })
    }
  }

  // 4. Side Effects

  // Send Date Change SMS: drafts get it when the hold was reset; confirmed
  // bookings get it on any real date change (SOP §15.6).
  const shouldSendDateChangeSms =
    (Boolean(holdExpiryIso) && updatedBooking.status === 'draft') ||
    (Boolean(dateChanged) && updatedBooking.status === 'confirmed')
  if (!abortSmsSideEffects && shouldSendDateChangeSms) {
    const eventDateReadable = formatPrivateBookingDate(updatedBooking.event_date);

    const expiryReadable = holdExpiryIso
      ? formatPrivateBookingDate(new Date(holdExpiryIso), {
          day: 'numeric', month: 'long'
        })
      : null;

    const smsMessage = dateChangedMessage({
      customerFirstName: updatedBooking.customer_first_name,
      newEventDate: eventDateReadable,
    });

    const result = await SmsQueueService.queueAndSend({
      booking_id: updatedBooking.id,
      trigger_type: 'date_changed',
      template_key: 'private_booking_date_changed',
      message_body: smsMessage,
      customer_phone: updatedBooking.contact_phone,
      customer_name: updatedBooking.customer_name,
      customer_id: updatedBooking.customer_id,
      created_by: performedByUserId,
      priority: 2,
      metadata: {
        template: 'private_booking_date_changed',
        new_date: eventDateReadable,
        new_expiry: expiryReadable
      }
    })
    captureSmsSideEffect('date_changed', 'private_booking_date_changed', result)
  }

  const statusChanged = updatedBooking.status && updatedBooking.status !== currentBooking.status;

  // Setup reminder (confirmed bookings)
  const setupDateChanged = input.setup_date !== undefined && input.setup_date !== currentBooking.setup_date;
  const setupTimeChanged = input.setup_time !== undefined && input.setup_time !== currentBooking.setup_time;
  const shouldSendSetupReminder =
    updatedBooking.status === 'confirmed' &&
    Boolean(updatedBooking.setup_time) &&
    (setupDateChanged || setupTimeChanged);

  if (!abortSmsSideEffects && shouldSendSetupReminder) {
    const eventDateReadable = formatPrivateBookingDate(updatedBooking.event_date);

    const setupTimeReadable = updatedBooking.setup_time
      ? new Date(`1970-01-01T${updatedBooking.setup_time}`).toLocaleTimeString('en-GB', {
          hour: 'numeric',
          minute: '2-digit'
        })
      : '';

    const firstName =
      updatedBooking.customer_first_name || updatedBooking.customer_name?.split(' ')[0] || 'there';

    const messageBody = setupReminderMessage({
      customerFirstName: firstName,
      eventDate: eventDateReadable,
    });

    const result = await SmsQueueService.queueAndSend({
      booking_id: updatedBooking.id,
      trigger_type: 'setup_reminder',
      template_key: 'private_booking_setup_reminder',
      message_body: messageBody,
      customer_phone: updatedBooking.contact_phone,
      customer_name:
        updatedBooking.customer_name ||
        `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
      customer_id: updatedBooking.customer_id,
      created_by: performedByUserId,
      priority: 2,
      metadata: {
        template: 'private_booking_setup_reminder',
        event_date: eventDateReadable,
        setup_time: updatedBooking.setup_time ?? null,
        setup_date: updatedBooking.setup_date ?? null
      }
    })
    captureSmsSideEffect('setup_reminder', 'private_booking_setup_reminder', result)
  }

  // Status change messages (e.g. status modal)
  if (statusChanged) {
    const updatedIsTbd = isBookingDateTbd(updatedBooking);
    const eventDateReadable = updatedIsTbd
      ? 'Date to be confirmed'
      : formatPrivateBookingDate(updatedBooking.event_date);

    const firstName =
      updatedBooking.customer_first_name || updatedBooking.customer_name?.split(' ')[0] || 'there';

    if (updatedBooking.status === 'confirmed' && updatedBooking.customer_id) {
      try {
        const adminClient = createAdminClient();
        await recordAnalyticsEvent(adminClient, {
          customerId: updatedBooking.customer_id,
          privateBookingId: updatedBooking.id,
          eventType: 'private_booking_confirmed',
          metadata: {
            via: 'private_booking_status_change',
            event_type: updatedBooking.event_type ?? null
          }
        });
      } catch (analyticsError) {
        logger.error('Failed to record private booking confirmation analytics:', { error: analyticsError instanceof Error ? analyticsError : new Error(String(analyticsError)) });
      }

      // Send confirmation email (non-blocking)
      if (updatedBooking.contact_email) {
        sendBookingConfirmationEmail(updatedBooking).catch(e =>
          logger.error('Failed to send booking confirmation email', { error: e instanceof Error ? e : new Error(String(e)) })
        );
        // Send calendar invite alongside confirmation (non-blocking)
        sendBookingCalendarInvite(updatedBooking).catch(e =>
          logger.error('Failed to send calendar invite', { error: e instanceof Error ? e : new Error(String(e)) })
        );
      }
    }

    if (!abortSmsSideEffects && updatedBooking.status === 'confirmed' && !updatedBooking.deposit_paid_date) {
      const messageBody = bookingConfirmedMessage({
        customerFirstName: firstName,
        eventDate: eventDateReadable,
      });

      const result = await SmsQueueService.queueAndSend({
        booking_id: updatedBooking.id,
        trigger_type: 'booking_confirmed',
        template_key: 'private_booking_confirmed',
        message_body: messageBody,
        customer_phone: updatedBooking.contact_phone,
        customer_name:
          updatedBooking.customer_name ||
          `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
        customer_id: updatedBooking.customer_id,
        created_by: performedByUserId,
        priority: 1,
        metadata: {
          template: 'private_booking_confirmed',
          event_date: eventDateReadable,
          event_type: updatedBooking.event_type ?? null
        }
      })
      captureSmsSideEffect('booking_confirmed', 'private_booking_confirmed', result)
    }

    // Cancel pending SMS queue entries when transitioning to cancelled
    if (updatedBooking.status === 'cancelled' && currentBooking.status !== 'cancelled') {
      try {
        const admin = createAdminClient();
        await admin
          .from('private_booking_sms_queue')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('booking_id', id)
          .in('status', ['pending', 'approved']);
      } catch (smsCleanupError) {
        logger.error('Failed to cancel pending SMS during status change to cancelled:', {
          error: smsCleanupError instanceof Error ? smsCleanupError : new Error(String(smsCleanupError)),
          metadata: { bookingId: id },
        });
      }
    }

    if (!abortSmsSideEffects && updatedBooking.status === 'cancelled') {
      // Pick the variant keyed by the financial outcome (no_money /
      // refundable / non-refundable / manual review). See
      // `resolveCancellationSmsVariant` for the mapping.
      const variant = await resolveCancellationSmsVariant({
        bookingId: updatedBooking.id,
        customerFirstName: firstName,
        eventDate: eventDateReadable,
      })

      const result = await SmsQueueService.queueAndSend({
        booking_id: updatedBooking.id,
        trigger_type: variant.triggerType,
        template_key: variant.templateKey,
        message_body: variant.messageBody,
        customer_phone: updatedBooking.contact_phone,
        customer_name:
          updatedBooking.customer_name ||
          `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
        customer_id: updatedBooking.customer_id,
        created_by: performedByUserId,
        priority: 2,
        metadata: {
          template: variant.templateKey,
          event_date: eventDateReadable,
          reason: 'status_change',
          financial_outcome: variant.outcome,
          refund_amount: variant.refundAmount,
          retained_amount: variant.retainedAmount,
        }
      })
      captureSmsSideEffect(variant.triggerType, variant.templateKey, result)
    }

    if (!abortSmsSideEffects && updatedBooking.status === 'completed' && !completedStatusAlreadyMessaged) {
      const messageBody = bookingCompletedThanksMessage({
        customerFirstName: firstName,
      });

      const result = await SmsQueueService.queueAndSend({
        booking_id: updatedBooking.id,
        trigger_type: 'booking_completed',
        template_key: 'private_booking_thank_you',
        message_body: messageBody,
        customer_phone: updatedBooking.contact_phone,
        customer_name:
          updatedBooking.customer_name ||
          `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
        customer_id: updatedBooking.customer_id,
        created_by: performedByUserId,
        priority: 4,
        metadata: {
          template: 'private_booking_thank_you',
          event_date: eventDateReadable
        }
      })
      captureSmsSideEffect('booking_completed', 'private_booking_thank_you', result)
    }
  }

  // Calendar Sync
  if (isCalendarConfigured()) {
    try {
      const isDateTbdBooking = Boolean(internalNotes?.includes(DATE_TBD_NOTE))
      const shouldRemoveCalendarEvent = updatedBooking.status === 'cancelled' || isDateTbdBooking

      if (shouldRemoveCalendarEvent) {
        if (updatedBooking.calendar_event_id) {
          const deleted = await deleteCalendarEvent(updatedBooking.calendar_event_id)
          if (deleted) {
            const { data: clearedCalendarRow, error: clearCalendarError } = await supabase
              .from('private_bookings')
              .update({ calendar_event_id: null })
              .eq('id', id)
              .select('id')
              .maybeSingle()

            if (clearCalendarError) {
              logger.error('Failed to clear private booking calendar event id after removal:', { error: clearCalendarError instanceof Error ? clearCalendarError : new Error(String(clearCalendarError)) })
            } else if (!clearedCalendarRow) {
              logger.error('Failed to clear private booking calendar event id after removal: booking row not found', { error: new Error('Failed to clear private booking calendar event id after removal: booking row not found') })
            }
            updatedBooking.calendar_event_id = null
          }
        }
        if (smsSideEffects.length > 0) {
           
          ;(updatedBooking as any).smsSideEffects = smsSideEffects
        }
        return updatedBooking
      }

      const eventId = await syncCalendarEvent(updatedBooking);
      if (eventId && eventId !== updatedBooking.calendar_event_id) {
        const { data: updatedCalendarRow, error: calendarUpdateError } = await supabase
          .from('private_bookings')
          .update({ calendar_event_id: eventId })
          .eq('id', id)
          .select('id')
          .maybeSingle();

        if (calendarUpdateError) {
          logger.error('Failed to persist private booking calendar event id during update:', { error: calendarUpdateError instanceof Error ? calendarUpdateError : new Error(String(calendarUpdateError)) });
        } else if (!updatedCalendarRow) {
          logger.error('Failed to persist private booking calendar event id during update: booking row not found', { error: new Error('Failed to persist private booking calendar event id during update: booking row not found') });
        }
        updatedBooking.calendar_event_id = eventId
      }
    } catch (error) {
      logger.error('Calendar sync exception:', { error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  if (smsSideEffects.length > 0) {
     
    ;(updatedBooking as any).smsSideEffects = smsSideEffects
  }
  return updatedBooking;
}

// ---------------------------------------------------------------------------
// Update booking status (with transition validation)
// ---------------------------------------------------------------------------

 
export async function updateBookingStatus(id: string, status: BookingStatus, performedByUserId?: string): Promise<any> {
  const supabase = await createClient()
  const { data: current, error } = await supabase
    .from('private_bookings')
    .select('status')
    .eq('id', id)
    .single()

  if (error || !current) throw new Error('Booking not found')

  const currentStatus = current.status as BookingStatus
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? []
  if (!allowed.includes(status)) {
    throw new Error(
      `Cannot transition booking from '${currentStatus}' to '${status}'`
    )
  }

  return updateBooking(id, { status }, performedByUserId)
}

// ---------------------------------------------------------------------------
// Apply discount
// ---------------------------------------------------------------------------

export async function applyBookingDiscount(
  bookingId: string,
  data: {
    discount_type: 'percent' | 'fixed';
    discount_amount: number;
    discount_reason: string;
  }
): Promise<{ success: true }> {
  // Server-side discount validation
  if (data.discount_type !== 'percent' && data.discount_type !== 'fixed') {
    throw new Error('Invalid discount type -- must be "percent" or "fixed"');
  }
  if (typeof data.discount_amount !== 'number' || !Number.isFinite(data.discount_amount) || data.discount_amount <= 0) {
    throw new Error('Invalid discount value -- must be a positive number');
  }
  if (data.discount_type === 'percent' && data.discount_amount > 100) {
    throw new Error('Percentage discount cannot exceed 100%');
  }

  const supabase = await createClient();

  // For fixed discounts, validate against booking total
  if (data.discount_type === 'fixed') {
    const { data: booking, error: fetchError } = await supabase
      .from('private_bookings')
      .select('total_amount')
      .eq('id', bookingId)
      .maybeSingle();

    if (fetchError || !booking) {
      throw new Error('Booking not found');
    }

    const totalAmount = toNumber(booking.total_amount, 0);
    if (totalAmount > 0 && data.discount_amount > totalAmount) {
      throw new Error('Fixed discount cannot exceed the booking total');
    }
  }

  const { data: updatedBooking, error } = await supabase
    .from('private_bookings')
    .update({
      discount_type: data.discount_type,
      discount_amount: data.discount_amount,
      discount_reason: data.discount_reason,
      updated_at: new Date().toISOString()
    })
    .eq('id', bookingId)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('Error applying booking discount:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to apply booking discount');
  }

  if (!updatedBooking) {
    throw new Error('Booking not found');
  }

  // Reconcile payment status — discount changes can affect whether booking is still fully paid
  try {
    const admin = createAdminClient();
    await admin.rpc('apply_balance_payment_status', { p_booking_id: bookingId });
  } catch (reconcileError) {
    logger.error('Failed to reconcile payment status after discount change:', { error: reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)) });
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Cancel booking
// ---------------------------------------------------------------------------

export async function cancelBooking(
  id: string,
  reason: string,
  performedByUserId?: string,
  options?: {
    retentionDecision?: CancellationRetentionDecision | null
    capture?: CancellationCaptureDetails | null
  }
): Promise<{ success: true; smsSideEffects?: PrivateBookingSmsSideEffectSummary[] }> {
  const supabase = await createClient();

  // 1. Get Booking
  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    .select('id, status, event_date, event_type, customer_first_name, customer_last_name, customer_name, contact_phone, contact_email, calendar_event_id, customer_id, date_tbd, internal_notes')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    throw new Error('Booking not found');
  }

  if (booking.status === 'cancelled' || booking.status === 'completed') {
    throw new Error('Booking cannot be cancelled');
  }

  // 1b. Validate any retention decision before the booking is touched.
  // SOP §14: for sub-30-day cancellations with a paid deposit, retention up
  // to the full deposit is a manager decision with a recorded reason.
  const retentionDecision = options?.retentionDecision ?? null
  if (retentionDecision) {
    const outcome = await getPrivateBookingCancellationOutcome(id)
    if (outcome.outcome !== 'gm_review_required') {
      throw new Error('A retention decision only applies to cancellations within 30 days of the event with a paid deposit')
    }
    if (retentionDecision.retainedAmount < 0 || retentionDecision.retainedAmount > outcome.max_retainable) {
      throw new Error(`Retained amount must be between £0 and £${outcome.max_retainable}`)
    }
    if (retentionDecision.retainedAmount > 0 && !retentionDecision.reason.trim()) {
      throw new Error('Please record the reason for retaining part or all of the deposit')
    }
  }

  // 2. Update Status
  const nowIso = new Date().toISOString();
  // SOP §14: capture how and when the cancellation arrived and who processed it.
  const capture = options?.capture ?? null;
  const cancellationReceivedAt = capture?.receivedAt || nowIso;
  let { data: updatedBookingRow, error: updateError } = await supabase
    .from('private_bookings')
    .update({
      status: 'cancelled',
      cancellation_reason: reason || 'Cancelled by staff',
      cancelled_at: nowIso,
      cancellation_channel: capture?.channel ?? null,
      cancellation_received_at: cancellationReceivedAt,
      cancelled_by: performedByUserId ?? null,
      updated_at: nowIso
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  // Fallback for legacy schema
  if (updateError && (updateError.code === 'PGRST204' || (updateError.message || '').includes('cancellation_reason'))) {
    const fallback = await supabase
      .from('private_bookings')
      .update({
        status: 'cancelled',
        updated_at: nowIso
      })
      .eq('id', id)
      .select('id')
      .maybeSingle();
    updateError = fallback.error || null;
    updatedBookingRow = fallback.data || null;
  }

  if (updateError) {
    throw new Error('Failed to cancel booking');
  }

  if (!updatedBookingRow) {
    throw new Error('Booking not found');
  }

  // 3. Calendar Cleanup
  if (booking.calendar_event_id && isCalendarConfigured()) {
    try {
      const deleted = await deleteCalendarEvent(booking.calendar_event_id);
      if (deleted) {
        const { data: clearedCalendarRow, error: clearCalendarError } = await supabase
          .from('private_bookings')
          .update({ calendar_event_id: null })
          .eq('id', id)
          .select('id')
          .maybeSingle();

        if (clearCalendarError) {
          logger.error('Failed to clear calendar event id after cancellation:', { error: clearCalendarError instanceof Error ? clearCalendarError : new Error(String(clearCalendarError)) });
        } else if (!clearedCalendarRow) {
          logger.error('Failed to clear calendar event id after cancellation: booking row not found', { error: new Error('Failed to clear calendar event id after cancellation: booking row not found') });
        }
      }
    } catch (error) {
      logger.error('Failed to delete calendar event:', { error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  // 3b. Cancel pending SMS queue entries — must happen before sending
  // the cancellation SMS to avoid racing with a scheduled send.
  try {
    const admin = createAdminClient();
    await admin
      .from('private_booking_sms_queue')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('booking_id', id)
      .in('status', ['pending', 'approved']);
  } catch (smsCleanupError) {
    logger.error('Failed to cancel pending SMS during booking cancellation:', {
      error: smsCleanupError instanceof Error ? smsCleanupError : new Error(String(smsCleanupError)),
      metadata: { bookingId: id },
    });
  }

  const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

  const bookingIsTbd = isBookingDateTbd(booking);
  const eventDate = bookingIsTbd
    ? 'Date to be confirmed'
    : formatPrivateBookingDate(booking.event_date);
  const firstName = booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there';

  // Pick the cancellation variant based on paid totals + dispute state and
  // any manager retention decision (SOP §14 — retention is never automatic).
  // Shared by the SMS and the cancellation email (SOP §14.9).
  const variant = await resolveCancellationSmsVariant({
    bookingId: id,
    customerFirstName: firstName,
    eventDate: eventDate,
    retentionDecision,
  })

  // 4. SMS Notification
  if (booking.contact_phone || booking.customer_id) {
    let smsResult: any
    try {
      smsResult = await SmsQueueService.queueAndSend({
        booking_id: id,
        trigger_type: variant.triggerType,
        template_key: variant.templateKey,
        message_body: variant.messageBody,
        customer_phone: booking.contact_phone,
        customer_name: booking.customer_name || `${booking.customer_first_name} ${booking.customer_last_name || ''}`.trim(),
        customer_id: booking.customer_id,
        created_by: performedByUserId,
        priority: 2,
        metadata: {
          template: variant.templateKey,
          event_date: eventDate,
          reason: reason || 'staff_cancelled',
          financial_outcome: variant.outcome,
          refund_amount: variant.refundAmount,
          retained_amount: variant.retainedAmount,
        }
      });
    } catch (smsError) {
      smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
    }

    const smsSafety = normalizeSmsSafetyMeta(smsResult)
    const smsSummary: PrivateBookingSmsSideEffectSummary = {
      triggerType: variant.triggerType,
      templateKey: variant.templateKey,
      queueId: typeof smsResult?.queueId === 'string' ? smsResult.queueId : undefined,
      sent: smsResult?.sent === true,
      suppressed: smsResult?.suppressed === true,
      requiresApproval: smsResult?.requiresApproval === true,
      code: smsSafety.code,
      logFailure: smsSafety.logFailure,
      error: typeof smsResult?.error === 'string' ? smsResult.error : undefined
    }

    smsSideEffects.push(smsSummary)

    if (smsSummary.logFailure) {
      logger.error('Private booking SMS logging failed', {
        metadata: {
          bookingId: id,
          triggerType: smsSummary.triggerType,
          templateKey: smsSummary.templateKey,
          code: smsSummary.code ?? null
        }
      })
    }

    if (smsSummary.error) {
      logger.error('Private booking SMS queue/send failed', {
        metadata: {
          bookingId: id,
          triggerType: smsSummary.triggerType,
          templateKey: smsSummary.templateKey,
          error: smsSummary.error
        }
      })
    }
  }

  // 4b. Cancellation confirmation email (SOP §14.9) — fire-and-forget so an
  // email failure never blocks the cancellation itself.
  if (booking.contact_email) {
    void sendBookingCancelledEmail({
      id,
      customer_id: booking.customer_id,
      contact_email: booking.contact_email,
      customer_first_name: booking.customer_first_name,
      customer_name: booking.customer_name,
      event_date: booking.event_date,
      event_type: booking.event_type,
      refund_amount: variant.refundAmount,
      retained_amount: variant.retainedAmount,
      retention_reason: retentionDecision?.reason ?? null,
      outcome: variant.outcome,
    }).catch((emailError) => {
      logger.error('Private booking cancellation email background task failed', {
        error: emailError instanceof Error ? emailError : new Error(String(emailError)),
        metadata: { bookingId: id },
      })
    })
  }

  await logAuditEvent({
    user_id: performedByUserId,
    operation_type: 'update',
    resource_type: 'private_booking',
    resource_id: id,
    operation_status: 'success',
    additional_info: {
      action: 'cancellation',
      reason: reason || 'staff_cancelled',
      ...(capture?.channel ? { cancellation_channel: capture.channel } : {}),
      cancellation_received_at: cancellationReceivedAt,
      ...(retentionDecision
        ? {
            retention_retained_amount: retentionDecision.retainedAmount,
            retention_reason: retentionDecision.reason,
          }
        : {}),
    },
  })

  return smsSideEffects.length > 0 ? { success: true, smsSideEffects } : { success: true };
}

// ---------------------------------------------------------------------------
// Expire booking
// ---------------------------------------------------------------------------

export async function expireBooking(
  id: string,
  options?: { sendNotification?: boolean; asSystem?: boolean }
): Promise<{ success: true; smsSent: boolean; smsCode: string | null; smsLogFailure: boolean }> {
  const supabase = options?.asSystem ? createAdminClient() : await createClient();
  const nowIso = new Date().toISOString();

  // 1. Get Booking
  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    .select('id, status, event_date, customer_first_name, customer_name, contact_phone, calendar_event_id, customer_id, date_tbd, internal_notes')
    .eq('id', id)
    .single();

  if (fetchError || !booking) throw new Error('Booking not found');
  if (booking.status !== 'draft') throw new Error('Only draft bookings can be expired');

  // 2. Update Status
  const { data: updatedBookingRow, error: updateError } = await supabase
    .from('private_bookings')
    .update({
      status: 'cancelled',
      cancellation_reason: 'Hold period expired (14 days)',
      cancelled_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (updateError) throw new Error('Failed to expire booking');
  if (!updatedBookingRow) throw new Error('Booking not found');

  // 3. Calendar Cleanup
  if (booking.calendar_event_id && isCalendarConfigured()) {
    try {
      const deleted = await deleteCalendarEvent(booking.calendar_event_id);
      if (deleted) {
        const { data: clearedCalendarRow, error: clearCalendarError } = await supabase
          .from('private_bookings')
          .update({ calendar_event_id: null })
          .eq('id', id)
          .select('id')
          .maybeSingle();

        if (clearCalendarError) {
          logger.error('Failed to clear calendar event id after expiry:', { error: clearCalendarError instanceof Error ? clearCalendarError : new Error(String(clearCalendarError)) });
        } else if (!clearedCalendarRow) {
          logger.error('Failed to clear calendar event id after expiry: booking row not found', { error: new Error('Failed to clear calendar event id after expiry: booking row not found') });
        }
      }
    } catch (error) {
      logger.error('Failed to delete calendar event:', { error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  // 3b. Cancel pending SMS queue entries before sending the expiry notification
  try {
    const adminForCleanup = options?.asSystem ? supabase : createAdminClient();
    await adminForCleanup
      .from('private_booking_sms_queue')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('booking_id', id)
      .in('status', ['pending', 'approved']);
  } catch (smsCleanupError) {
    logger.error('Failed to cancel pending SMS during booking expiry:', {
      error: smsCleanupError instanceof Error ? smsCleanupError : new Error(String(smsCleanupError)),
      metadata: { bookingId: id },
    });
  }

  // 4. SMS Notification
  let smsSent = false
  let smsCode: string | null = null
  let smsLogFailure = false
  if (options?.sendNotification !== false && (booking.contact_phone || booking.customer_id)) {
    const expiryIsTbd = isBookingDateTbd(booking);
    const eventDate = expiryIsTbd
      ? 'Date to be confirmed'
      : formatPrivateBookingDate(booking.event_date);

    const smsMessage = bookingExpiredMessage({
      customerFirstName: booking.customer_first_name,
      eventDate: eventDate,
    });

     
    let smsResult: any
    try {
      smsResult = await SmsQueueService.queueAndSend({
        booking_id: id,
        trigger_type: 'booking_expired',
        template_key: 'private_booking_expired',
        message_body: smsMessage,
        customer_phone: booking.contact_phone,
        customer_name: booking.customer_name,
        customer_id: booking.customer_id,
        created_by: undefined,
        priority: 2,
        metadata: {
          template: 'private_booking_expired',
          event_date: eventDate
        }
      });
    } catch (error) {
      logger.error('Failed to queue expiry SMS notification:', { error: error instanceof Error ? error : new Error(String(error)) })
      smsResult = { error: 'Failed to queue SMS notification' }
    }

    const smsSafety = normalizeSmsSafetyMeta(smsResult)
    smsCode = smsSafety.code
    smsLogFailure = smsSafety.logFailure
    smsSent = Boolean(!smsResult.error && 'sent' in smsResult && smsResult.sent)
  }

  return { success: true, smsSent, smsCode, smsLogFailure };
}

// ---------------------------------------------------------------------------
// Extend hold
// ---------------------------------------------------------------------------

export async function extendHold(
  id: string,
  days: 7 | 14 | 30,
  extendedBy?: string,
  reason?: string
): Promise<{ success: true; newExpiry: string; smsSent: boolean }> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  // SOP §10: hold extensions require a recorded reason.
  if (!(reason || '').trim()) {
    throw new Error('Please record a reason for extending the hold');
  }

  // 1. Fetch booking
  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    .select('id, status, event_date, hold_expiry, customer_first_name, customer_name, contact_phone, customer_id')
    .eq('id', id)
    .single();

  if (fetchError || !booking) throw new Error('Booking not found');
  if (booking.status !== 'draft') throw new Error('Only draft bookings can have their hold extended');

  // 2. Calculate new hold_expiry: extend from current expiry (or now if already expired)
  const baseDate = booking.hold_expiry && new Date(booking.hold_expiry) > new Date()
    ? new Date(booking.hold_expiry)
    : new Date();
  const newExpiry = new Date(baseDate);
  newExpiry.setDate(newExpiry.getDate() + days);

  // Cap at the balance & final-details due date — a hold must never run past
  // it (SOP §10). Extensions inside the 14-day window cap at the event start.
  if (booking.event_date) {
    const eventDate = new Date(booking.event_date);
    const dueMoment = balanceDueMoment(eventDate);
    const cap = new Date() > dueMoment ? eventDate : dueMoment;
    if (newExpiry > cap) {
      newExpiry.setTime(cap.getTime());
    }
  }

  const newExpiryIso = newExpiry.toISOString();

  // 3. Update hold_expiry
  const { error: updateError } = await supabase
    .from('private_bookings')
    .update({ hold_expiry: newExpiryIso, updated_at: nowIso })
    .eq('id', id);

  if (updateError) throw new Error('Failed to extend booking hold');

  // 4. Send SMS
  let smsSent = false;
  if (booking.contact_phone || booking.customer_id) {
    const expiryReadable = formatPrivateBookingDate(newExpiry, {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const eventDateReadable = booking.event_date
      ? formatPrivateBookingDate(booking.event_date)
      : 'your event';

    const smsMessage = holdExtendedMessage({
      customerFirstName: booking.customer_first_name,
      eventDate: eventDateReadable,
      newExpiryDate: expiryReadable,
    });

     
    let smsResult: any;
    try {
      smsResult = await SmsQueueService.queueAndSend({
        booking_id: id,
        trigger_type: 'hold_extended',
        template_key: 'private_booking_hold_extended',
        message_body: smsMessage,
        customer_phone: booking.contact_phone,
        customer_name: booking.customer_name,
        customer_id: booking.customer_id,
        created_by: extendedBy,
        priority: 2,
        metadata: {
          template: 'private_booking_hold_extended',
          event_date: eventDateReadable,
          new_expiry: expiryReadable,
          extended_days: days,
          extension_reason: reason,
        }
      });
    } catch (error) {
      logger.error('Failed to queue hold extension SMS:', { error: error instanceof Error ? error : new Error(String(error)) });
      smsResult = { error: 'Failed to queue SMS' };
    }

    if (smsResult?.error) {
      logger.error('Hold extension SMS failed:', {
        error: new Error(String(smsResult.error)),
        metadata: { bookingId: id, code: smsResult.code }
      });
    }

    const smsSafety = normalizeSmsSafetyMeta(smsResult);
    smsSent = Boolean(!smsResult?.error && 'sent' in smsResult && smsResult.sent);
  }

  return { success: true, newExpiry: newExpiryIso, smsSent };
}

// ---------------------------------------------------------------------------
// Delete booking
// ---------------------------------------------------------------------------

 
export async function deletePrivateBooking(id: string): Promise<{ deletedBooking: any }> {
  const supabase = await createClient();

  // GATE (SOP §8): a booking may be hard-deleted only when no payment has been
  // made, no contract/document has been generated, and no customer SMS or
  // email has been sent or queued. Cancelled bookings are NOT exempt —
  // cancellation records must be retained. The DB trigger is the last-line
  // defence; this action-layer check surfaces a friendly error for the UI.
  const { data: bookingRow, error: bookingCheckError } = await supabase
    .from('private_bookings')
    .select('status, deposit_paid_date, contract_version')
    .eq('id', id)
    .single();

  if (bookingCheckError) {
    throw new Error('Booking not found or inaccessible.');
  }

  if (bookingRow.deposit_paid_date) {
    throw new Error('Cannot delete booking: a deposit has been paid. Use Cancel instead.');
  }
  if ((bookingRow.contract_version ?? 0) > 0) {
    throw new Error('Cannot delete booking: a contract has been generated. Use Cancel instead.');
  }

  const admin = createAdminClient();

  const [paymentsCheck, documentsCheck, emailsCheck, smsCheck] = await Promise.all([
    admin.from('private_booking_payments').select('id', { count: 'exact', head: true }).eq('booking_id', id),
    admin.from('private_booking_documents').select('id', { count: 'exact', head: true }).eq('booking_id', id),
    admin.from('email_messages').select('id', { count: 'exact', head: true }).eq('private_booking_id', id).neq('direction', 'inbound'),
    admin.from('private_booking_sms_queue').select('id', { count: 'exact', head: true }).eq('booking_id', id)
      .or('status.eq.sent,and(status.eq.approved,scheduled_for.gt.now())'),
  ]);

  const gateError = paymentsCheck.error || documentsCheck.error || emailsCheck.error || smsCheck.error;
  if (gateError) {
    logger.error('deletePrivateBooking: failed to check delete gate', {
      error: new Error((gateError as { message?: string }).message ?? String(gateError)),
      metadata: { bookingId: id },
    });
    throw new Error('Failed to verify delete eligibility; please try again.');
  }

  if ((paymentsCheck.count ?? 0) > 0) {
    throw new Error('Cannot delete booking: payments have been recorded. Use Cancel instead.');
  }
  if ((documentsCheck.count ?? 0) > 0) {
    throw new Error('Cannot delete booking: a contract or document has been generated. Use Cancel instead.');
  }
  if ((emailsCheck.count ?? 0) > 0) {
    throw new Error('Cannot delete booking: the customer has been emailed. Use Cancel instead.');
  }
  if ((smsCheck.count ?? 0) > 0) {
    throw new Error("Cannot delete booking: the customer has received SMS message(s). Use Cancel instead so they're notified.");
  }

  // D16: DB delete first, then calendar cleanup (reverse order for safety)
  const { data: bookingBeforeDelete } = await supabase
    .from('private_bookings')
    .select('calendar_event_id')
    .eq('id', id)
    .single();

  const { data, error } = await supabase
    .from('private_bookings')
    .delete()
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('Error deleting private booking:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to delete private booking');
  }

  // Calendar cleanup is non-blocking — DB record is already gone
  if (data && bookingBeforeDelete?.calendar_event_id && isCalendarConfigured()) {
    try {
      await deleteCalendarEvent(bookingBeforeDelete.calendar_event_id);
    } catch (calendarError) {
      logger.error('Failed to delete calendar event after booking deletion (non-blocking):', {
        error: calendarError instanceof Error ? calendarError : new Error(String(calendarError)),
        metadata: { bookingId: id, calendarEventId: bookingBeforeDelete.calendar_event_id }
      });
    }
  }

  return { deletedBooking: data };
}

// ---------------------------------------------------------------------------
// Add note — userId required, caller handles auth
// ---------------------------------------------------------------------------

export async function addNote(bookingId: string, note: string, userId: string, userEmail?: string): Promise<{ success: true }> {
  const admin = createAdminClient();

  const { error } = await admin.from('private_booking_audit').insert({
    booking_id: bookingId,
    action: 'note_added',
    field_name: 'notes',
    new_value: note,
    metadata: {
      note_text: note
    },
    performed_by: userId
  });

  if (error) throw new Error(`Failed to save note: ${error.message} (code: ${error.code})`);

  await logAuditEvent({
    user_id: userId,
    user_email: userEmail,
    operation_type: 'add_note',
    resource_type: 'private_booking',
    resource_id: bookingId,
    operation_status: 'success',
    additional_info: {
      note_preview: note.substring(0, 120)
    }
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Booking items
// ---------------------------------------------------------------------------

export async function addBookingItem(data: {
  booking_id: string;
  item_type: 'space' | 'catering' | 'vendor' | 'other';
  space_id?: string | null;
  package_id?: string | null;
  vendor_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_value?: number;
  discount_type?: 'percent' | 'fixed';
  notes?: string | null;
  vat_rate?: number;
}): Promise<{ success: true }> {
  // D9: Server-side discount bounds validation
  if (data.discount_value !== undefined && data.discount_value !== null) {
    if (data.discount_value < 0) {
      throw new Error('Discount value cannot be negative');
    }
    if (data.discount_type === 'percent' && data.discount_value > 100) {
      throw new Error('Percentage discount cannot exceed 100%');
    }
    if (data.discount_type === 'fixed' && data.discount_value > (data.quantity * data.unit_price)) {
      throw new Error('Fixed discount cannot exceed the line item value');
    }
  }

  // SOP §6: adding a space must not clash with other holds/confirmed bookings.
  if (data.item_type === 'space' && data.space_id) {
    const adminForConflicts = createAdminClient();
    const { data: bookingRow, error: bookingLookupError } = await adminForConflicts
      .from('private_bookings')
      .select('event_date, start_time, end_time, setup_date, setup_time, cleardown_time, date_tbd, internal_notes')
      .eq('id', data.booking_id)
      .maybeSingle();
    if (bookingLookupError) {
      // Fail open: a broken lookup must not block the item flow.
      logger.error('Space conflict pre-check skipped: booking lookup failed', {
        error: new Error(bookingLookupError.message),
        metadata: { bookingId: data.booking_id },
      });
    } else if (bookingRow?.event_date && !isBookingDateTbd(bookingRow)) {
      const conflicts = await findBookingConflicts({
        eventDate: bookingRow.event_date as string,
        startTime: (bookingRow.start_time as string | null) ?? null,
        endTime: (bookingRow.end_time as string | null) ?? null,
        setupDate: (bookingRow.setup_date as string | null) ?? null,
        setupTime: (bookingRow.setup_time as string | null) ?? null,
        cleardownTime: ((bookingRow as any).cleardown_time as string | null) ?? null,
        spaceIds: [data.space_id],
        excludeBookingId: data.booking_id,
      });
      if (conflicts.length > 0) {
        throw new Error(formatConflictError(conflicts[0]));
      }
    }
  }

  const supabase = await createClient();

  // Snapshot the VAT rate from the source package/space (stored prices are
  // net; the rate is frozen on the line at the time it is added).
  let vatRate = data.vat_rate;
  if (vatRate === undefined || vatRate === null) {
    try {
      if (data.package_id) {
        const { data: pkg } = await supabase
          .from('catering_packages').select('vat_rate').eq('id', data.package_id).maybeSingle();
        vatRate = toNumber(pkg?.vat_rate, 20);
      } else if (data.space_id) {
        const { data: space } = await supabase
          .from('venue_spaces').select('vat_rate').eq('id', data.space_id).maybeSingle();
        vatRate = toNumber(space?.vat_rate, 20);
      }
    } catch {
      vatRate = undefined;
    }
    vatRate = vatRate ?? 20;
  }

  const { data: lastItem, error: orderError } = await supabase
    .from('private_booking_items')
    .select('display_order')
    .eq('booking_id', data.booking_id)
    .order('display_order', { ascending: false })
    .limit(1);

  if (orderError) {
    logger.error('Error determining next item order:', { error: orderError instanceof Error ? orderError : new Error(String(orderError)) });
    throw new Error(orderError.message || 'Failed to determine item order');
  }

  const nextDisplayOrder = lastItem && lastItem.length > 0 && lastItem[0]?.display_order !== null && lastItem[0]?.display_order !== undefined
    ? Number(lastItem[0].display_order) + 1
    : 0;

  const { error } = await supabase
    .from('private_booking_items')
    .insert({
      booking_id: data.booking_id,
      item_type: data.item_type,
      space_id: data.space_id,
      package_id: data.package_id,
      vendor_id: data.vendor_id,
      description: data.description,
      quantity: data.quantity,
      unit_price: data.unit_price,
      vat_rate: vatRate,
      discount_value: data.discount_value,
      discount_type: data.discount_type,
      notes: data.notes,
      display_order: nextDisplayOrder
    });

  if (error) {
    logger.error('Error adding booking item:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to add booking item');
  }

  // Reconcile payment status — item changes can affect whether booking is still fully paid
  try {
    const admin = createAdminClient();
    await admin.rpc('apply_balance_payment_status', { p_booking_id: data.booking_id });
  } catch (reconcileError) {
    logger.error('Failed to reconcile payment status after item add:', { error: reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)) });
  }

  // SOP §21: catering changes can flip the waiver requirement.
  if (data.item_type === 'catering') {
    try {
      await reconcileWaiverStatus(data.booking_id);
    } catch (waiverError) {
      logger.error('Failed to reconcile waiver status after item add (non-blocking)', {
        error: waiverError instanceof Error ? waiverError : new Error(String(waiverError)),
        metadata: { bookingId: data.booking_id },
      });
    }
  }

  return { success: true };
}

export async function updateBookingItem(itemId: string, data: {
  quantity?: number;
  unit_price?: number;
  discount_value?: number;
  discount_type?: 'percent' | 'fixed';
  notes?: string | null;
}): Promise<{ success: true; bookingId: string }> {
  const supabase = await createClient();

  const { data: currentItem, error: fetchError } = await supabase
    .from('private_booking_items')
    .select('booking_id, quantity, unit_price, discount_type, discount_value')
    .eq('id', itemId)
    .single();

  if (fetchError || !currentItem) {
    throw new Error('Item not found');
  }

  // D9: Merge incoming partial data with current values for validation
  const effectiveQuantity = data.quantity ?? currentItem.quantity;
  const effectiveUnitPrice = data.unit_price ?? currentItem.unit_price;
  const effectiveDiscountType = data.discount_type ?? currentItem.discount_type;
  const effectiveDiscountValue = data.discount_value ?? currentItem.discount_value;

  if (effectiveDiscountValue !== undefined && effectiveDiscountValue !== null) {
    if (effectiveDiscountValue < 0) {
      throw new Error('Discount value cannot be negative');
    }
    if (effectiveDiscountType === 'percent' && effectiveDiscountValue > 100) {
      throw new Error('Percentage discount cannot exceed 100%');
    }
    if (effectiveDiscountType === 'fixed' && effectiveDiscountValue > (effectiveQuantity * effectiveUnitPrice)) {
      throw new Error('Fixed discount cannot exceed the line item value');
    }
  }

  const updateData: any = {};

  if (data.quantity !== undefined) updateData.quantity = data.quantity;
  if (data.unit_price !== undefined) updateData.unit_price = data.unit_price;
  if (data.discount_value !== undefined) updateData.discount_value = data.discount_value;
  if (data.discount_type !== undefined) updateData.discount_type = data.discount_type;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const { data: updatedItem, error } = await supabase
    .from('private_booking_items')
    .update(updateData)
    .eq('id', itemId)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('Error updating booking item:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to update booking item');
  }

  if (!updatedItem) {
    throw new Error('Item not found');
  }

  // Reconcile payment status — item changes can affect whether booking is still fully paid
  try {
    const admin = createAdminClient();
    await admin.rpc('apply_balance_payment_status', { p_booking_id: currentItem.booking_id });
  } catch (reconcileError) {
    logger.error('Failed to reconcile payment status after item update:', { error: reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)) });
  }

  return { success: true, bookingId: currentItem.booking_id };
}

export async function deleteBookingItem(itemId: string): Promise<{ success: true; bookingId: string }> {
  const supabase = await createClient();

  const { data: item, error: fetchError } = await supabase
    .from('private_booking_items')
    .select('booking_id, item_type')
    .eq('id', itemId)
    .single();

  if (fetchError || !item) {
    throw new Error('Item not found');
  }

  const { data: deletedItem, error } = await supabase
    .from('private_booking_items')
    .delete()
    .eq('id', itemId)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('Error deleting booking item:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to delete booking item');
  }

  if (!deletedItem) {
    throw new Error('Item not found');
  }

  // Reconcile payment status — item changes can affect whether booking is still fully paid
  try {
    const admin = createAdminClient();
    await admin.rpc('apply_balance_payment_status', { p_booking_id: item.booking_id });
  } catch (reconcileError) {
    logger.error('Failed to reconcile payment status after item delete:', { error: reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)) });
  }

  // SOP §21: removing the last waiver package drops 'required' back to
  // 'not_required' (never downgrades 'sent'/'signed').
  if (item.item_type === 'catering') {
    try {
      await reconcileWaiverStatus(item.booking_id);
    } catch (waiverError) {
      logger.error('Failed to reconcile waiver status after item delete (non-blocking)', {
        error: waiverError instanceof Error ? waiverError : new Error(String(waiverError)),
        metadata: { bookingId: item.booking_id },
      });
    }
  }

  return { success: true, bookingId: item.booking_id };
}

export async function reorderBookingItems(bookingId: string, orderedIds: string[]): Promise<{ success: true }> {
  const supabase = await createClient();

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error('No booking items supplied for reordering');
  }

  const { data: existingItems, error: fetchError } = await supabase
    .from('private_booking_items')
    .select('id, display_order')
    .eq('booking_id', bookingId);

  if (fetchError) {
    logger.error('Error fetching booking items for reorder:', { error: fetchError instanceof Error ? fetchError : new Error(String(fetchError)) });
    throw new Error(fetchError.message || 'Failed to fetch booking items');
  }

  const existingIds = new Set((existingItems || []).map((item) => item.id));

  const hasInvalidId = orderedIds.some((id) => !existingIds.has(id));
  if (hasInvalidId || existingIds.size !== orderedIds.length) {
    throw new Error('Booking items list must include all existing items');
  }

  const previousOrder = new Map((existingItems || []).map((item) => [item.id, item.display_order ?? 0]));

  try {
    for (const [index, id] of orderedIds.entries()) {
      const { data: updatedRows, error: updateError } = await supabase
        .from('private_booking_items')
        .update({ display_order: index })
        .eq('id', id)
        .eq('booking_id', bookingId)
        .select('id')
        .limit(1);

      if (updateError || !updatedRows || updatedRows.length === 0) {
        throw updateError || new Error(`Failed to update display order for item ${id}`);
      }
    }
  } catch (updateFailure) {
    // Best-effort rollback to avoid leaving partially reordered items.
    await Promise.allSettled(
      Array.from(previousOrder.entries()).map(async ([id, displayOrder]) => {
        const { data: restoredRow, error: restoreError } = await supabase
          .from('private_booking_items')
          .update({ display_order: displayOrder })
          .eq('id', id)
          .eq('booking_id', bookingId)
          .select('id')
          .maybeSingle()

        if (restoreError) {
          logger.error('Failed to restore booking item order during rollback:', { error: restoreError instanceof Error ? restoreError : new Error(String(restoreError)) })
          return
        }

        if (!restoredRow) {
          logger.error('Failed to restore booking item order during rollback: item no longer exists', { error: new Error('item no longer exists'), metadata: { id, bookingId } })
        }
      })
    );

    logger.error('Error updating booking item order:', { error: updateFailure instanceof Error ? updateFailure : new Error(String(updateFailure)) });
    throw new Error(
      updateFailure instanceof Error
        ? updateFailure.message
        : 'Failed to update booking item order'
    );
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Venue Space Management — userId required, caller handles auth
// ---------------------------------------------------------------------------

 
export async function createVenueSpace(data: {
  name: string;
  capacity: number;
  capacity_standing: number;
  hire_cost: number;
  description?: string | null;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
  const admin = createAdminClient();

  const dbData = {
    name: data.name,
    capacity_seated: data.capacity,
    capacity_standing: data.capacity_standing,
    rate_per_hour: data.hire_cost,
    description: data.description,
    active: data.is_active,
    minimum_hours: 1,
    setup_fee: 0,
    display_order: 0
  };

  const { data: inserted, error } = await admin
    .from('venue_spaces')
    .insert(dbData)
    .select()
    .single();

  if (error) {
    logger.error('Error creating venue space:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to create venue space');
  }

  if (inserted) {
    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'create',
      resource_type: 'venue_space',
      resource_id: inserted.id,
      operation_status: 'success',
      new_values: {
        name: inserted.name,
        capacity_seated: inserted.capacity_seated,
        capacity_standing: inserted.capacity_standing,
        rate_per_hour: inserted.rate_per_hour,
        description: inserted.description,
        active: inserted.active
      }
    });
  }

  return inserted;
}

 
export async function updateVenueSpace(id: string, data: {
  name: string;
  capacity: number;
  capacity_standing: number;
  hire_cost: number;
  description?: string | null;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from('venue_spaces')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error('Venue space not found');
  }

  const dbData = {
    name: data.name,
    capacity_seated: data.capacity,
    capacity_standing: data.capacity_standing,
    rate_per_hour: data.hire_cost,
    description: data.description,
    active: data.is_active
  };

  const { data: updated, error } = await admin
    .from('venue_spaces')
    .update(dbData)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('Error updating venue space:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to update venue space');
  }

  if (!updated) {
    throw new Error('Venue space not found');
  }

  if (updated) {
    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'update',
      resource_type: 'venue_space',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        name: existing.name,
        capacity_seated: existing.capacity_seated,
        capacity_standing: existing.capacity_standing,
        rate_per_hour: existing.rate_per_hour,
        description: existing.description,
        active: existing.active
      },
      new_values: {
        name: updated.name,
        capacity_seated: updated.capacity_seated,
        capacity_standing: updated.capacity_standing,
        rate_per_hour: updated.rate_per_hour,
        description: updated.description,
        active: updated.active
      }
    });
  }

  return updated;
}

export async function deleteVenueSpace(id: string, userId: string, userEmail?: string): Promise<{ success: true }> {
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from('venue_spaces')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error('Venue space not found');
  }

  const { data: deletedVenueSpace, error } = await admin
    .from('venue_spaces')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('Error deleting venue space:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to delete venue space');
  }

  if (!deletedVenueSpace) {
    throw new Error('Venue space not found');
  }

  await logAuditEvent({
    user_id: userId,
    user_email: userEmail,
    operation_type: 'delete',
    resource_type: 'venue_space',
    resource_id: id,
    operation_status: 'success',
    old_values: {
      name: existing.name,
      capacity_seated: existing.capacity_seated,
      capacity_standing: existing.capacity_standing,
      rate_per_hour: existing.rate_per_hour,
      description: existing.description,
      active: existing.active
    }
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Catering Package Management — userId required, caller handles auth
// ---------------------------------------------------------------------------

 
export async function createCateringPackage(data: {
  name: string;
  serving_style: string;
  category: 'food' | 'drink' | 'addon' | 'self_catering' | 'other';
  per_head_cost: number;
  pricing_model?: 'per_head' | 'total_value';
  minimum_order?: number | null;
  summary?: string | null;
  includes?: string | null;
  served?: string | null;
  good_to_know?: string | null;
  guest_description?: string | null;
  dietary_notes?: string | null;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
  const admin = createAdminClient();

  const dbData = {
    name: data.name,
    serving_style: data.serving_style,
    category: data.category,
    cost_per_head: data.per_head_cost,
    pricing_model: data.pricing_model || 'per_head',
    minimum_guests: data.minimum_order,
    summary: data.summary,
    includes: data.includes,
    served: data.served,
    good_to_know: data.good_to_know,
    guest_description: data.guest_description,
    dietary_notes: data.dietary_notes,
    active: data.is_active,
    display_order: 0
  };

  const { data: inserted, error } = await admin
    .from('catering_packages')
    .insert(dbData)
    .select()
    .single();

  if (error) {
    logger.error('Error creating catering package:', { error: error instanceof Error ? error : new Error(String(error)) });
    if (error.code === '23505') {
      throw new Error('A catering package with this name already exists. Please choose a different name.');
    }
    throw new Error(error.message || 'Failed to create catering package');
  }

  if (inserted) {
    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'create',
      resource_type: 'catering_package',
      resource_id: inserted.id,
      operation_status: 'success',
      new_values: {
        name: inserted.name,
        serving_style: inserted.serving_style,
        category: inserted.category,
        cost_per_head: inserted.cost_per_head,
        pricing_model: inserted.pricing_model,
        minimum_guests: inserted.minimum_guests,
        summary: inserted.summary,
        includes: inserted.includes,
        served: inserted.served,
        good_to_know: inserted.good_to_know,
        guest_description: inserted.guest_description,
        dietary_notes: inserted.dietary_notes,
        active: inserted.active
      }
    });
  }

  return inserted;
}

 
export async function updateCateringPackage(id: string, data: {
  name: string;
  serving_style: string;
  category: 'food' | 'drink' | 'addon' | 'self_catering' | 'other';
  per_head_cost: number;
  pricing_model?: 'per_head' | 'total_value';
  minimum_order?: number | null;
  summary?: string | null;
  includes?: string | null;
  served?: string | null;
  good_to_know?: string | null;
  guest_description?: string | null;
  dietary_notes?: string | null;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from('catering_packages')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error('Catering package not found');
  }

  const dbData = {
    name: data.name,
    serving_style: data.serving_style,
    category: data.category,
    cost_per_head: data.per_head_cost,
    pricing_model: data.pricing_model || 'per_head',
    minimum_guests: data.minimum_order,
    summary: data.summary,
    includes: data.includes,
    served: data.served,
    good_to_know: data.good_to_know,
    guest_description: data.guest_description,
    dietary_notes: data.dietary_notes,
    active: data.is_active
  };

  const { data: updated, error } = await admin
    .from('catering_packages')
    .update(dbData)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('Error updating catering package:', { error: error instanceof Error ? error : new Error(String(error)) });
    if (error.code === '23505') {
      throw new Error('A catering package with this name already exists. Please choose a different name.');
    }
    throw new Error(error.message || 'Failed to update catering package');
  }

  if (!updated) {
    throw new Error('Catering package not found');
  }

  if (updated) {
    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'update',
      resource_type: 'catering_package',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        name: existing.name,
        cost_per_head: existing.cost_per_head,
        pricing_model: existing.pricing_model,
        minimum_guests: existing.minimum_guests,
        summary: existing.summary,
        includes: existing.includes,
        served: existing.served,
        good_to_know: existing.good_to_know,
        guest_description: existing.guest_description,
        dietary_notes: existing.dietary_notes,
        active: existing.active
      },
      new_values: {
        name: updated.name,
        cost_per_head: updated.cost_per_head,
        pricing_model: updated.pricing_model,
        minimum_guests: updated.minimum_guests,
        summary: updated.summary,
        includes: updated.includes,
        served: updated.served,
        good_to_know: updated.good_to_know,
        guest_description: updated.guest_description,
        dietary_notes: updated.dietary_notes,
        active: updated.active
      }
    });
  }

  return updated;
}

export async function deleteCateringPackage(id: string, userId: string, userEmail?: string): Promise<{ success: true }> {
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from('catering_packages')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error('Catering package not found');
  }

  const { data: deletedPackage, error } = await admin
    .from('catering_packages')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('Error deleting catering package:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to delete catering package');
  }

  if (!deletedPackage) {
    throw new Error('Catering package not found');
  }

  await logAuditEvent({
    user_id: userId,
    user_email: userEmail,
    operation_type: 'delete',
    resource_type: 'catering_package',
    resource_id: id,
    operation_status: 'success',
    old_values: {
      name: existing.name,
      package_type: existing.package_type,
      cost_per_head: existing.cost_per_head,
      pricing_model: existing.pricing_model,
      minimum_guests: existing.minimum_guests,
      description: existing.description,
      dietary_notes: existing.dietary_notes,
      active: existing.active
    }
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Vendor Management — userId required, caller handles auth
// ---------------------------------------------------------------------------

 
export async function createVendor(data: {
  name: string;
  vendor_type: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  typical_rate?: number | null;
  notes?: string | null;
  is_preferred: boolean;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
  const admin = createAdminClient();

  const formattedPhone = data.phone ? formatPhoneForStorage(data.phone) : null;

  const dbData = {
    name: data.name,
    service_type: data.vendor_type,
    contact_name: data.contact_name,
    contact_phone: formattedPhone,
    contact_email: data.email,
    website: data.website,
    notes: data.notes,
    preferred: data.is_preferred,
    active: data.is_active
  };

  const { data: inserted, error } = await admin
    .from('vendors')
    .insert({
      ...dbData,
      typical_rate: data.typical_rate?.toString() ?? null
    })
    .select()
    .single();

  if (error) {
    logger.error('Error creating vendor:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to create vendor');
  }

  if (inserted) {
    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'create',
      resource_type: 'vendor',
      resource_id: inserted.id,
      operation_status: 'success',
      new_values: {
        name: inserted.name,
        service_type: inserted.service_type,
        contact_name: inserted.contact_name,
        contact_phone: inserted.contact_phone,
        contact_email: inserted.contact_email,
        website: inserted.website,
        typical_rate: inserted.typical_rate,
        preferred: inserted.preferred,
        active: inserted.active
      }
    });
  }

  return inserted;
}

 
export async function updateVendor(id: string, data: {
  name: string;
  vendor_type: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  typical_rate?: number | null;
  notes?: string | null;
  is_preferred: boolean;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from('vendors')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error('Vendor not found');
  }

  const formattedPhone = data.phone ? formatPhoneForStorage(data.phone) : null;

  const dbData = {
    name: data.name,
    service_type: data.vendor_type,
    contact_name: data.contact_name,
    contact_phone: formattedPhone,
    contact_email: data.email,
    website: data.website,
    typical_rate: data.typical_rate?.toString() ?? null,
    notes: data.notes,
    preferred: data.is_preferred,
    active: data.is_active
  };

  const { data: updated, error } = await admin
    .from('vendors')
    .update(dbData)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('Error updating vendor:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to update vendor');
  }

  if (!updated) {
    throw new Error('Vendor not found');
  }

  if (updated) {
    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'update',
      resource_type: 'vendor',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        name: existing.name,
        service_type: existing.service_type,
        contact_name: existing.contact_name,
        contact_phone: existing.contact_phone,
        contact_email: existing.contact_email,
        website: existing.website,
        typical_rate: existing.typical_rate,
        preferred: existing.preferred,
        active: existing.active
      },
      new_values: {
        name: updated.name,
        service_type: updated.service_type,
        contact_name: updated.contact_name,
        contact_phone: updated.contact_phone,
        contact_email: updated.contact_email,
        website: updated.website,
        typical_rate: updated.typical_rate,
        preferred: updated.preferred,
        active: updated.active
      }
    });
  }

  return updated;
}

export async function deleteVendor(id: string, userId: string, userEmail?: string): Promise<{ success: true }> {
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from('vendors')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error('Vendor not found');
  }

  const { data: deletedVendor, error } = await admin
    .from('vendors')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('Error deleting vendor:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to delete vendor');
  }

  if (!deletedVendor) {
    throw new Error('Vendor not found');
  }

  await logAuditEvent({
    user_id: userId,
    user_email: userEmail,
    operation_type: 'delete',
    resource_type: 'vendor',
    resource_id: id,
    operation_status: 'success',
    old_values: {
      name: existing.name,
      service_type: existing.service_type,
      contact_name: existing.contact_name,
      contact_phone: existing.contact_phone,
      contact_email: existing.contact_email,
      website: existing.website,
      typical_rate: existing.typical_rate,
      preferred: existing.preferred,
      active: existing.active
    }
  });

  return { success: true };
}
