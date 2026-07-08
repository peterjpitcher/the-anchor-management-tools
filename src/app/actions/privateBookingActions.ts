'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PAYPAL_DEFAULT_CURRENCY, createSimplePayPalOrder, capturePayPalPayment, getPayPalOrder } from '@/lib/paypal'
import { logger } from '@/lib/logger'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateBookingToken } from '@/lib/private-bookings/booking-token'
import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import { getErrorMessage } from '@/lib/errors'
import type {
  PrivateBookingWithDetails,
  BookingStatus,
} from '@/types/private-bookings'
import type { ActionType } from '@/types/rbac'
import type { User as SupabaseUser } from '@supabase/supabase-js'

// General Manager override permission (SOP pack §5) — seeded by migration
// 20260705100003_pb_workflow_model.sql. The ActionType union in
// src/types/rbac.ts has not been extended yet, so the action name is asserted
// here; remove the assertion once 'gm_override' joins the union.
const GM_OVERRIDE_ACTION = 'gm_override' as ActionType

import { formatDateInLondon, toLocalIsoDate } from '@/lib/dateUtils'
import { sanitizeMoneyString } from '@/lib/utils'
import { logAuditEvent } from './audit'
import {
  PrivateBookingService,
  privateBookingSchema,
  bookingNoteSchema,
  formatTimeToHHMM,
  ALLOWED_VENDOR_TYPES,
  CreatePrivateBookingInput,
  UpdatePrivateBookingInput,
  updateBalancePayment,
  deleteBalancePayment,
  updateDeposit,
  updateDepositAmount,
  finalizeDepositPayment,
  deleteDeposit,
} from '@/services/private-bookings'
import { SmsQueueService } from '@/services/sms-queue' // Still needed for SMS actions
import { sendBookingCalendarInvite, sendDepositPaymentLinkEmail } from '@/lib/email/private-booking-emails'

// Helper function to extract string values from FormData
const getString = (formData: FormData, key: string): string | undefined => {
  const value = formData.get(key)
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }
  return undefined
}

function getPayPalOrderAmount(order: any): number | null {
  const raw = order?.purchase_units?.[0]?.amount?.value
  const amount = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isFinite(amount) ? amount : null
}

function getPayPalOrderCurrency(order: any): string | null {
  const raw = order?.purchase_units?.[0]?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null
}

function amountsMatch(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 0.01
}

function normalizeActionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function logPrivateBookingActionError(
  message: string,
  error: unknown,
  metadata?: Record<string, unknown>
): void {
  logger.error(message, {
    error: normalizeActionError(error),
    metadata
  })
}

// Helper function that preserves empty strings (used to allow clearing optional fields)
const getStringAllowEmpty = (formData: FormData, key: string): string | undefined => {
  const value = formData.get(key)
  if (typeof value !== 'string') {
    return undefined
  }
  return value.trim()
}

const editBalancePaymentSchema = z.object({
  paymentId: z.string().uuid(),
  bookingId: z.string().uuid(),
  type: z.literal('balance'),
  amount: z.string().refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
    message: 'Amount must be greater than £0',
  }),
  method: z.enum(['cash', 'card', 'invoice']),
  notes: z.string().max(500).optional(),
})

const editDepositSchema = z.object({
  bookingId: z.string().uuid(),
  type: z.literal('deposit'),
  amount: z.string().refine(v => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
    message: 'Amount must be £0 or greater',
  }),
  method: z.enum(['cash', 'card', 'invoice']),
})

const deletePaymentSchema = z.object({
  // DELIBERATE: paymentId can be 'deposit' (not a UUID) so z.string() not z.string().uuid()
  paymentId: z.string(),
  type: z.enum(['deposit', 'balance']),
  bookingId: z.string().uuid(),
})

type PrivateBookingsManageAction =
  | 'manage_catering'
  | 'manage_spaces'
  | 'manage_vendors'

type PrivateBookingsPermissionResult =
  | { error: string }
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }

// This helper remains in the action, managing permission checks and user context
async function requirePrivateBookingsPermission(
  action: PrivateBookingsManageAction
): Promise<PrivateBookingsPermissionResult> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Use PermissionService here if it were available
  const canManage = await checkUserPermission('private_bookings', action); // Using existing checkUserPermission
  if (!canManage) {
    return { error: 'Insufficient permissions' };
  }
  const admin = createAdminClient();
  return { user, admin };
}


// Get all private bookings with optional filtering (this should use PrivateBookingService.getBookings)
export async function getPrivateBookings(filters?: {
  status?: BookingStatus
  fromDate?: string
  toDate?: string
  customerId?: string
}) {
  try {
    const hasPermission = await checkUserPermission('private_bookings', 'view')
      || await checkUserPermission('private_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to view private bookings' };
    }
    const { data } = await PrivateBookingService.getBookings(filters);
    return { data };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching private bookings:', error);
    return { error: getErrorMessage(error) };
  }
}

// Get single private booking by ID
export async function getPrivateBooking(
  id: string,
  variant: 'detail' | 'edit' | 'items' | 'messages' = 'detail'
) {
  const canView = await checkUserPermission('private_bookings', 'view')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const data =
      variant === 'edit'
        ? await PrivateBookingService.getBookingByIdForEdit(id)
        : variant === 'items'
          ? await PrivateBookingService.getBookingByIdForItems(id)
          : variant === 'messages'
            ? await PrivateBookingService.getBookingByIdForMessages(id)
            : await PrivateBookingService.getBookingById(id)
    return { data };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching private booking:', error);
    return { error: getErrorMessage(error) };
  }
}

// Create a new private booking
export async function createPrivateBooking(formData: FormData) {
  try {
    const supabase = await createClient()
    const isDateTbd = formData.get('date_tbd') === 'true'

    const rawData = {
      customer_first_name: (getString(formData, 'customer_first_name') || '').trim(),
      customer_last_name: getString(formData, 'customer_last_name'),
      customer_id: getString(formData, 'customer_id'),
      default_country_code: getString(formData, 'default_country_code'),
      contact_phone: getString(formData, 'contact_phone'),
      contact_email: getString(formData, 'contact_email'),
      event_date: getString(formData, 'event_date'),
      start_time: getString(formData, 'start_time') ? formatTimeToHHMM(getString(formData, 'start_time')) : undefined,
      setup_date: getString(formData, 'setup_date'),
      setup_time: getString(formData, 'setup_time') ? formatTimeToHHMM(getString(formData, 'setup_time')) : undefined,
      end_time: getString(formData, 'end_time') ? formatTimeToHHMM(getString(formData, 'end_time')) : undefined,
      guest_count: (() => {
        const value = getString(formData, 'guest_count')
        return value ? parseInt(value, 10) : undefined
      })(),
      event_type: getString(formData, 'event_type'),
      internal_notes: getString(formData, 'internal_notes'),
      contract_note: getString(formData, 'contract_note'),
      customer_requests: getString(formData, 'customer_requests'),
      special_requirements: getString(formData, 'special_requirements'),
      accessibility_needs: getString(formData, 'accessibility_needs'),
      source: getString(formData, 'source'),
      deposit_amount: (() => {
        const value = getString(formData, 'deposit_amount')
        return value ? parseFloat(value) : undefined
      })(),
      deposit_reduction_reason: getString(formData, 'deposit_reduction_reason'),
      deposit_waived: getString(formData, 'deposit_waived') === 'true',
      deposit_waived_reason: getString(formData, 'deposit_waived_reason'),
      balance_due_date: getString(formData, 'balance_due_date'),
      hold_expiry: getString(formData, 'deposit_due_date'),
      // Enquiry intake fields (SOP pack §9)
      layout: getString(formData, 'layout') as 'seated' | 'standing' | 'mixed' | undefined,
      guest_count_adults: (() => {
        const value = getString(formData, 'guest_count_adults')
        return value ? parseInt(value, 10) : undefined
      })(),
      guest_count_under_18: (() => {
        const value = getString(formData, 'guest_count_under_18')
        return value ? parseInt(value, 10) : undefined
      })(),
      bar_tab_required: getString(formData, 'bar_tab_required') === 'true',
      bar_tab_limit: (() => {
        const value = getString(formData, 'bar_tab_limit')
        return value ? parseFloat(value) : undefined
      })(),
      bar_tab_prepaid_amount: (() => {
        const value = getString(formData, 'bar_tab_prepaid_amount')
        return value ? parseFloat(value) : undefined
      })(),
      bar_tab_preauth_reference: getString(formData, 'bar_tab_preauth_reference'),
      outside_food: getString(formData, 'outside_food') === 'true',
      high_power_equipment: getString(formData, 'high_power_equipment') === 'true',
      decorations_plan: getString(formData, 'decorations_plan'),
      dogs_expected: getString(formData, 'dogs_expected') === 'true',
      special_risk_notes: getString(formData, 'special_risk_notes'),
      communication_preference: getString(formData, 'communication_preference'),
      cleardown_time: getString(formData, 'cleardown_time') ? formatTimeToHHMM(getString(formData, 'cleardown_time')) : undefined,
    }

    // Validate data and fetch auth/permission in parallel
    const validationResult = privateBookingSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const bookingData = validationResult.data

    const [{ data: { user } }, canCreate, canManage] = await Promise.all([
      supabase.auth.getUser(),
      checkUserPermission('private_bookings', 'create'),
      checkUserPermission('private_bookings', 'manage'),
    ])

    if (!canCreate && !canManage) {
      return { error: 'You do not have permission to create private bookings' }
    }

    // SOP §12: reducing the deposit below the £250 default needs the General
    // Manager override permission, not just a recorded reason.
    if (bookingData.deposit_amount !== undefined && bookingData.deposit_amount < 250) {
      const canOverride = await checkUserPermission('private_bookings', GM_OVERRIDE_ACTION)
      if (!canOverride) {
        return { error: 'Deposit reductions need General Manager override permission' }
      }
    }

    // Call Service
    const booking = await PrivateBookingService.createBooking({
      ...bookingData,
      customer_last_name: bookingData.customer_last_name || undefined,
      customer_id: bookingData.customer_id || undefined,
      default_country_code: bookingData.default_country_code || undefined,
      contact_phone: bookingData.contact_phone || undefined,
      contact_email: bookingData.contact_email || undefined,
      event_date: bookingData.event_date || undefined,
      start_time: bookingData.start_time || undefined,
      end_time: bookingData.end_time || undefined,
      setup_date: bookingData.setup_date || undefined,
      setup_time: bookingData.setup_time || undefined,
      guest_count: bookingData.guest_count,
      event_type: bookingData.event_type || undefined,
      internal_notes: bookingData.internal_notes || undefined,
      contract_note: bookingData.contract_note || undefined,
      customer_requests: bookingData.customer_requests || undefined,
      special_requirements: bookingData.special_requirements || undefined,
      accessibility_needs: bookingData.accessibility_needs || undefined,
      source: bookingData.source || undefined,
      deposit_amount: bookingData.deposit_amount,
      deposit_reduction_reason: bookingData.deposit_reduction_reason || undefined,
      deposit_waived: bookingData.deposit_waived,
      deposit_waived_reason: bookingData.deposit_waived_reason || undefined,
      balance_due_date: bookingData.balance_due_date || undefined,
      hold_expiry: bookingData.hold_expiry || undefined,
      layout: bookingData.layout,
      guest_count_adults: bookingData.guest_count_adults,
      guest_count_under_18: bookingData.guest_count_under_18,
      bar_tab_required: bookingData.bar_tab_required,
      bar_tab_limit: bookingData.bar_tab_limit,
      bar_tab_prepaid_amount: bookingData.bar_tab_prepaid_amount,
      bar_tab_preauth_reference: bookingData.bar_tab_preauth_reference || undefined,
      outside_food: bookingData.outside_food,
      high_power_equipment: bookingData.high_power_equipment,
      decorations_plan: bookingData.decorations_plan || undefined,
      dogs_expected: bookingData.dogs_expected,
      special_risk_notes: bookingData.special_risk_notes || undefined,
      communication_preference: bookingData.communication_preference || undefined,
      cleardown_time: bookingData.cleardown_time || undefined,
      created_by: user?.id,
      date_tbd: isDateTbd
    } as CreatePrivateBookingInput);

    await logAuditEvent({
      user_id: user?.id,
      operation_type: 'create',
      resource_type: 'private_booking',
      resource_id: booking.id,
      operation_status: 'success',
      additional_info: {
        ...(bookingData.deposit_amount !== undefined && bookingData.deposit_amount > 0 && bookingData.deposit_amount < 250
          ? { deposit_reduced_to: bookingData.deposit_amount, deposit_reduction_reason: bookingData.deposit_reduction_reason }
          : {}),
        ...(bookingData.deposit_waived
          ? { deposit_waived: true, deposit_waived_reason: bookingData.deposit_waived_reason }
          : {}),
      },
    })

    revalidatePath('/private-bookings')
    revalidatePath('/events')
    revalidateTag('dashboard')
    return { success: true, data: booking }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error creating private booking:', error)
    return { error: getErrorMessage(error) }
  }
}

// Update private booking
export async function updatePrivateBooking(id: string, formData: FormData) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to update private bookings' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const isDateTbd = formData.get('date_tbd') === 'true'

  const setupTimeRaw = getStringAllowEmpty(formData, 'setup_time')
  const endTimeRaw = getStringAllowEmpty(formData, 'end_time')

  const rawData = {
    customer_first_name: (getString(formData, 'customer_first_name') || '').trim(),
    customer_last_name: getStringAllowEmpty(formData, 'customer_last_name'),
    customer_id: getString(formData, 'customer_id'),
    default_country_code: getString(formData, 'default_country_code'),
    contact_phone: getStringAllowEmpty(formData, 'contact_phone'),
    contact_email: getStringAllowEmpty(formData, 'contact_email'),
    event_date: getString(formData, 'event_date'),
    start_time: getString(formData, 'start_time') ? formatTimeToHHMM(getString(formData, 'start_time')) : undefined,
    setup_date: getStringAllowEmpty(formData, 'setup_date'),
    setup_time:
      setupTimeRaw === undefined
        ? undefined
        : setupTimeRaw === ''
          ? ''
          : formatTimeToHHMM(setupTimeRaw),
    end_time:
      endTimeRaw === undefined
        ? undefined
        : endTimeRaw === ''
          ? ''
          : formatTimeToHHMM(endTimeRaw),
    guest_count: (() => {
      const value = getString(formData, 'guest_count')
      return value ? parseInt(value, 10) : undefined
    })(),
    event_type: getStringAllowEmpty(formData, 'event_type'),
    internal_notes: getStringAllowEmpty(formData, 'internal_notes'),
    contract_note: getStringAllowEmpty(formData, 'contract_note'),
    customer_requests: getStringAllowEmpty(formData, 'customer_requests'),
    special_requirements: getStringAllowEmpty(formData, 'special_requirements'),
    accessibility_needs: getStringAllowEmpty(formData, 'accessibility_needs'),
    source: getStringAllowEmpty(formData, 'source'),
    deposit_amount: (() => {
      const value = getStringAllowEmpty(formData, 'deposit_amount')
      return value ? parseFloat(value) : undefined
    })(),
    deposit_reduction_reason: getString(formData, 'deposit_reduction_reason'),
    deposit_waived: formData.has('deposit_waived')
      ? formData.getAll('deposit_waived').includes('true')
      : undefined,
    deposit_waived_reason: getString(formData, 'deposit_waived_reason'),
    balance_due_date: getStringAllowEmpty(formData, 'balance_due_date'),
    has_open_dispute: formData.has('has_open_dispute')
      ? formData.getAll('has_open_dispute').includes('true')
      : undefined,
    status: getString(formData, 'status') as BookingStatus | undefined,
    // Enquiry intake fields (SOP pack §9) — undefined when absent so partial
    // edits leave the stored values untouched.
    layout: getString(formData, 'layout') as 'seated' | 'standing' | 'mixed' | undefined,
    guest_count_adults: (() => {
      const value = getStringAllowEmpty(formData, 'guest_count_adults')
      return value ? parseInt(value, 10) : undefined
    })(),
    guest_count_under_18: (() => {
      const value = getStringAllowEmpty(formData, 'guest_count_under_18')
      return value ? parseInt(value, 10) : undefined
    })(),
    bar_tab_required: formData.has('bar_tab_required')
      ? formData.getAll('bar_tab_required').includes('true')
      : undefined,
    bar_tab_limit: (() => {
      const value = getStringAllowEmpty(formData, 'bar_tab_limit')
      return value ? parseFloat(value) : undefined
    })(),
    bar_tab_prepaid_amount: (() => {
      const value = getStringAllowEmpty(formData, 'bar_tab_prepaid_amount')
      return value ? parseFloat(value) : undefined
    })(),
    bar_tab_preauth_reference: getStringAllowEmpty(formData, 'bar_tab_preauth_reference'),
    outside_food: formData.has('outside_food')
      ? formData.getAll('outside_food').includes('true')
      : undefined,
    high_power_equipment: formData.has('high_power_equipment')
      ? formData.getAll('high_power_equipment').includes('true')
      : undefined,
    decorations_plan: getStringAllowEmpty(formData, 'decorations_plan'),
    dogs_expected: formData.has('dogs_expected')
      ? formData.getAll('dogs_expected').includes('true')
      : undefined,
    special_risk_notes: getStringAllowEmpty(formData, 'special_risk_notes'),
    communication_preference: getStringAllowEmpty(formData, 'communication_preference'),
    cleardown_time: (() => {
      const raw = getStringAllowEmpty(formData, 'cleardown_time')
      if (raw === undefined) return undefined
      return raw === '' ? '' : formatTimeToHHMM(raw)
    })(),
  }

  // Validate data
  const validationResult = privateBookingSchema.safeParse(rawData)
  if (!validationResult.success) {
    return { error: validationResult.error.errors[0].message }
  }

  const bookingData = validationResult.data

  // SOP §12: reducing the deposit below the £250 default needs the General
  // Manager override permission, not just a recorded reason.
  if (bookingData.deposit_amount !== undefined && bookingData.deposit_amount < 250) {
    const canOverride = await checkUserPermission('private_bookings', GM_OVERRIDE_ACTION)
    if (!canOverride) {
      return { error: 'Deposit reductions need General Manager override permission' }
    }
  }

  try {
    // Call Service
    const booking = await PrivateBookingService.updateBooking(id, {
      ...bookingData,
      // SOP §15: why the date moved — audited by the service, never stored as a column.
      date_change_reason: getString(formData, 'date_change_reason'),
      date_tbd: isDateTbd
    } as UpdatePrivateBookingInput, user.id);

    try {
      await logAuditEvent({
        user_id: user.id,
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: id,
        operation_status: 'success',
        additional_info: {
          action: 'update_private_booking',
          status: bookingData.status ?? null,
        },
      })
    } catch (auditError) {
      logger.error('Failed to log audit event for updatePrivateBooking', {
        error: auditError instanceof Error ? auditError : new Error(String(auditError)),
        metadata: { bookingId: id },
      })
    }

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${id}`)
    revalidatePath('/events')
    revalidateTag('dashboard')
    return { success: true, data: booking }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error updating private booking:', error)
    return { error: getErrorMessage(error) }
  }
}

// Update booking status
export async function updateBookingStatus(id: string, status: BookingStatus) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to update private bookings' }
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: 'Not authenticated' }
    }

    await PrivateBookingService.updateBookingStatus(id, status, user.id);

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${id}`)
    revalidatePath('/events')
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error updating booking status:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function addPrivateBookingNote(bookingId: string, note: string) {
  const validation = bookingNoteSchema.safeParse({ note })
  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Note validation failed.' }
  }

  const supabase = await createClient()
  const [{ data: { user } }, canEdit, canManageNotes] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'edit'),
    checkUserPermission('private_bookings', 'manage'),
  ])

  if (!user) {
    return { error: 'You must be signed in to add a note' }
  }

  if (!canEdit && !canManageNotes) {
    return { error: 'You do not have permission to add notes to private bookings' }
  }

  const trimmedNote = validation.data.note

  try {
    await PrivateBookingService.addNote(bookingId, trimmedNote, user.id, user.email || undefined)
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error recording booking note:', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * Return whether a private booking can still be hard-deleted.
 *
 * SOP §8: a booking is delete-eligible only when no payment has been made,
 * no contract or document has been generated, and no customer SMS or email
 * has been sent or scheduled. Cancelled bookings are NOT exempt —
 * cancellation records must be retained. This mirrors the DB trigger
 * `private_bookings_delete_gate` so the UI can disable the delete button
 * before the user commits, avoiding a dead-end database error.
 *
 * @param bookingId — the UUID of the booking to check
 */
export async function getBookingDeleteEligibility(bookingId: string): Promise<{
  canDelete: boolean
  sentCount: number
  scheduledCount: number
  reason?: string
}> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      canDelete: false,
      sentCount: 0,
      scheduledCount: 0,
      reason: 'Unauthorized'
    }
  }

  const canDelete = await checkUserPermission('private_bookings', 'delete')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canDelete) {
    return {
      canDelete: false,
      sentCount: 0,
      scheduledCount: 0,
      reason: 'You do not have permission to delete private bookings'
    }
  }

  const admin = createAdminClient()

  const { data: booking, error: bookingError } = await admin
    .from('private_bookings')
    .select('status, deposit_paid_date, contract_version')
    .eq('id', bookingId)
    .single()

  if (bookingError || !booking) {
    return {
      canDelete: false,
      sentCount: 0,
      scheduledCount: 0,
      reason: 'Booking not found'
    }
  }

  if (booking.deposit_paid_date) {
    return {
      canDelete: false,
      sentCount: 0,
      scheduledCount: 0,
      reason: 'A deposit has been paid — cancel instead of delete'
    }
  }

  if ((booking.contract_version ?? 0) > 0) {
    return {
      canDelete: false,
      sentCount: 0,
      scheduledCount: 0,
      reason: 'A contract has been generated — cancel instead of delete'
    }
  }

  const [smsResult, paymentsResult, documentsResult, emailsResult] = await Promise.all([
    admin.from('private_booking_sms_queue').select('status, scheduled_for').eq('booking_id', bookingId),
    admin.from('private_booking_payments').select('id', { count: 'exact', head: true }).eq('booking_id', bookingId),
    admin.from('private_booking_documents').select('id', { count: 'exact', head: true }).eq('booking_id', bookingId),
    admin.from('email_messages').select('id', { count: 'exact', head: true }).eq('private_booking_id', bookingId).neq('direction', 'inbound'),
  ])

  const gateError = smsResult.error || paymentsResult.error || documentsResult.error || emailsResult.error
  if (gateError) {
    logPrivateBookingActionError('Error checking delete eligibility:', gateError, {
      bookingId
    })
    return {
      canDelete: false,
      sentCount: 0,
      scheduledCount: 0,
      reason: 'Unable to verify delete eligibility — please try again'
    }
  }

  const rows = smsResult.data ?? []
  const now = Date.now()

  const sentCount = rows.filter((row) => row.status === 'sent').length
  const scheduledCount = rows.filter((row) => {
    if (row.status !== 'approved') return false
    if (!row.scheduled_for) return false
    const scheduledAt = Date.parse(row.scheduled_for)
    return Number.isFinite(scheduledAt) && scheduledAt > now
  }).length

  if ((paymentsResult.count ?? 0) > 0) {
    return {
      canDelete: false,
      sentCount,
      scheduledCount,
      reason: 'Payments have been recorded — cancel instead of delete'
    }
  }

  if ((documentsResult.count ?? 0) > 0) {
    return {
      canDelete: false,
      sentCount,
      scheduledCount,
      reason: 'A contract or document has been generated — cancel instead of delete'
    }
  }

  if ((emailsResult.count ?? 0) > 0) {
    return {
      canDelete: false,
      sentCount,
      scheduledCount,
      reason: 'The customer has been emailed — cancel instead of delete'
    }
  }

  if (sentCount > 0) {
    return {
      canDelete: false,
      sentCount,
      scheduledCount,
      reason: `${sentCount} SMS already sent to the customer — cancel instead of delete`
    }
  }

  if (scheduledCount > 0) {
    return {
      canDelete: false,
      sentCount,
      scheduledCount,
      reason: `${scheduledCount} SMS scheduled to send — cancel instead of delete`
    }
  }

  return {
    canDelete: true,
    sentCount,
    scheduledCount
  }
}

/**
 * Resolve the financial outcome and the exact SMS body that will be sent
 * when this booking is cancelled now. Used by the Cancel confirmation
 * modal to show the admin what the customer will receive.
 *
 * Returns `null` preview_body on error so callers can still show a
 * confirmation dialog; they just won't be able to preview the SMS.
 */
export async function getCancellationPreview(
  bookingId: string,
  retention?: { retainedAmount: number } | null
): Promise<{
  outcome: import('@/services/private-bookings/financial').CancellationFinancialOutcome | null
  refund_amount: number
  retained_amount: number
  deposit_deduction: number
  max_retainable: number
  preview_body: string | null
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      outcome: null,
      refund_amount: 0,
      retained_amount: 0,
      deposit_deduction: 0,
      max_retainable: 0,
      preview_body: null,
      error: 'Unauthorized',
    }
  }

  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return {
      outcome: null,
      refund_amount: 0,
      retained_amount: 0,
      deposit_deduction: 0,
      max_retainable: 0,
      preview_body: null,
      error: 'You do not have permission to cancel private bookings',
    }
  }

  try {
    const { getPrivateBookingCancellationOutcome } = await import(
      '@/services/private-bookings/financial'
    )
    const [
      {
        bookingCancelledHoldMessage,
        bookingCancelledRefundableMessage,
        bookingCancelledPartialRefundMessage,
        bookingCancelledRetentionMessage,
        bookingCancelledReviewPendingMessage,
        bookingCancelledManualReviewMessage,
      },
      outcome,
      bookingResult,
    ] = await Promise.all([
      import('@/lib/private-bookings/messages'),
      getPrivateBookingCancellationOutcome(bookingId),
      getPrivateBooking(bookingId),
    ])

    const booking = bookingResult?.data ?? null
    const customerFirstName =
      booking?.customer_first_name ?? booking?.customer_name ?? null
    const eventDateReadable = booking?.event_date
      ? formatDateInLondon(booking.event_date, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'your event date'

    let previewBody: string
    let previewRefund = outcome.refund_amount
    let previewRetained = outcome.retained_amount
    switch (outcome.outcome) {
      case 'no_money':
        previewBody = bookingCancelledHoldMessage({
          customerFirstName,
          eventDate: eventDateReadable,
        })
        break
      case 'deposit_partial_refund':
        previewBody = bookingCancelledPartialRefundMessage({
          customerFirstName,
          eventDate: eventDateReadable,
          refundAmount: outcome.refund_amount,
          deductionAmount: outcome.deposit_deduction,
        })
        break
      case 'refundable':
        previewBody = bookingCancelledRefundableMessage({
          customerFirstName,
          eventDate: eventDateReadable,
          refundAmount: outcome.refund_amount,
        })
        break
      case 'gm_review_required': {
        // SOP §14: retention up to the full deposit is a manager decision.
        // Preview reflects the retained amount chosen in the cancel modal.
        if (retention) {
          const retained = Math.min(Math.max(retention.retainedAmount, 0), outcome.max_retainable)
          previewRefund = outcome.refund_amount + (outcome.max_retainable - retained)
          previewRetained = retained
          previewBody = retained > 0
            ? bookingCancelledRetentionMessage({
                customerFirstName,
                eventDate: eventDateReadable,
                retainedAmount: retained,
                refundAmount: previewRefund,
              })
            : bookingCancelledRefundableMessage({
                customerFirstName,
                eventDate: eventDateReadable,
                refundAmount: previewRefund,
              })
        } else {
          previewBody = bookingCancelledReviewPendingMessage({
            customerFirstName,
            eventDate: eventDateReadable,
          })
        }
        break
      }
      case 'manual_review':
      default:
        previewBody = bookingCancelledManualReviewMessage({
          customerFirstName,
          eventDate: eventDateReadable,
        })
        break
    }

    return {
      outcome: outcome.outcome,
      refund_amount: previewRefund,
      retained_amount: previewRetained,
      deposit_deduction: outcome.deposit_deduction,
      max_retainable: outcome.max_retainable,
      preview_body: previewBody,
    }
  } catch (error) {
    logPrivateBookingActionError('Error computing cancellation preview:', error, {
      bookingId,
    })
    return {
      outcome: null,
      refund_amount: 0,
      retained_amount: 0,
      deposit_deduction: 0,
      max_retainable: 0,
      preview_body: null,
      error: 'Failed to compute cancellation preview',
    }
  }
}

/**
 * Resolve the exact SMS body that will be sent when a booking is marked
 * complete. Used by the Mark-as-Complete confirmation modal.
 */
export async function getCompletionPreview(bookingId: string): Promise<{
  preview_body: string | null
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { preview_body: null, error: 'Unauthorized' }

  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return {
      preview_body: null,
      error: 'You do not have permission to update private bookings',
    }
  }

  try {
    const [{ bookingCompletedThanksMessage }, bookingResult] = await Promise.all([
      import('@/lib/private-bookings/messages'),
      getPrivateBooking(bookingId),
    ])

    const booking = bookingResult?.data ?? null
    const customerFirstName =
      booking?.customer_first_name ?? booking?.customer_name ?? null

    const previewBody = bookingCompletedThanksMessage({ customerFirstName })
    return { preview_body: previewBody }
  } catch (error) {
    logPrivateBookingActionError('Error computing completion preview:', error, {
      bookingId,
    })
    return { preview_body: null, error: 'Failed to compute completion preview' }
  }
}

// Delete private booking
export async function deletePrivateBooking(id: string) {
  const supabase = await createClient()
  const [{ data: { user } }, canDelete, canManageDelete] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'delete'),
    checkUserPermission('private_bookings', 'manage'),
  ])

  if (!canDelete && !canManageDelete) {
    return { error: 'You do not have permission to delete private bookings' }
  }

  try {
    await PrivateBookingService.deletePrivateBooking(id);

    await logAuditEvent({
      user_id: user?.id,
      operation_type: 'delete',
      resource_type: 'private_booking',
      resource_id: id,
      operation_status: 'success',
    })

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${id}`)
    revalidatePath('/events')
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error deleting private booking:', error)
    return { error: getErrorMessage(error) }
  }
}

// Get venue spaces
export async function getVenueSpaces(activeOnly = true) {
  const canView = await checkUserPermission('private_bookings', 'view')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const data = await PrivateBookingService.getVenueSpaces(activeOnly);
    return { data };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching venue spaces:', error);
    return { error: getErrorMessage(error) };
  }
}

export async function getVenueSpacesForManagement() {
  const permission = await requirePrivateBookingsPermission('manage_spaces')
  if ('error' in permission) {
    return { error: permission.error }
  }

  try {
    const data = await PrivateBookingService.getVenueSpacesForManagement();
    return { data };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching venue spaces for management:', error)
    return { error: getErrorMessage(error) }
  }
}

// Get catering packages
export async function getCateringPackages(activeOnly = true) {
  const canView = await checkUserPermission('private_bookings', 'view')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const data = await PrivateBookingService.getCateringPackages(activeOnly);
    return { data };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching catering packages:', error);
    return { error: getErrorMessage(error) };
  }
}

export async function getCateringPackagesForManagement() {
  const permission = await requirePrivateBookingsPermission('manage_catering')
  if ('error' in permission) {
    return { error: permission.error }
  }

  try {
    const data = await PrivateBookingService.getCateringPackagesForManagement();
    return { data };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching catering packages for management:', error)
    return { error: getErrorMessage(error) }
  }
}

// Get vendors
export async function getVendors(serviceType?: string, activeOnly = true) {
  const canView = await checkUserPermission('private_bookings', 'view')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const rawData = await PrivateBookingService.getVendors(serviceType, activeOnly);
    // sanitizeMoneyString applied here
    const normalizedData = (rawData || []).map(vendor => {
      const normalizedRate = sanitizeMoneyString(vendor.typical_rate)
      return {
        ...vendor,
        typical_rate_normalized: normalizedRate,
      }
    })

    return { data: normalizedData };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching vendors:', error);
    return { error: getErrorMessage(error) };
  }
}

export async function getVendorsForManagement() {
  const permission = await requirePrivateBookingsPermission('manage_vendors')
  if ('error' in permission) {
    return { error: permission.error }
  }

  try {
    const data = await PrivateBookingService.getVendorsForManagement();
    const normalizedData = (data || []).map(vendor => ({
      ...vendor,
      typical_rate_normalized: sanitizeMoneyString(vendor.typical_rate)
    }))
    return { data: normalizedData }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching vendors for management:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function getVendorRate(vendorId: string) {
  const canView = await checkUserPermission('private_bookings', 'view')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const data = await PrivateBookingService.getVendorRate(vendorId);
    if (!data) {
      return { error: 'Vendor not found' }
    }
    const normalizedRate = sanitizeMoneyString(data.typical_rate)

    return {
      data: {
        vendor_id: data.id,
        typical_rate: data.typical_rate ?? null,
        typical_rate_normalized: normalizedRate
      }
    }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching vendor rate:', error)
    return { error: getErrorMessage(error) }
  }
}

// Record deposit payment
export async function recordDepositPayment(bookingId: string, formData: FormData) {
  const supabase = await createClient()
  const [{ data: { user } }, canManageDeposits] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'manage_deposits'),
  ])

  if (!canManageDeposits) {
    return { error: 'You do not have permission to record deposits' }
  }

  const paymentMethod = getString(formData, 'payment_method')
  const amountRaw = getString(formData, 'amount')
  const amount = amountRaw ? parseFloat(amountRaw) : NaN
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'Invalid deposit amount' }
  }

  const VALID_PAYMENT_METHODS = ['cash', 'card', 'invoice'] as const
  type ValidPaymentMethod = typeof VALID_PAYMENT_METHODS[number]
  if (!paymentMethod || !(VALID_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return { success: false, error: 'Invalid payment method' }
  }

  try {
    const result = await PrivateBookingService.recordDeposit(
      bookingId,
      amount,
      paymentMethod,
      user?.id || undefined
    )

    try {
      await logAuditEvent({
        user_id: user?.id,
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          action: 'record_deposit_payment',
          amount,
          payment_method: paymentMethod,
        },
      })
    } catch (auditError) {
      logger.error('Failed to log audit event for recordDepositPayment', {
        error: auditError instanceof Error ? auditError : new Error(String(auditError)),
        metadata: { bookingId },
      })
    }

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    return result
  } catch (error: unknown) {
    logger.error('Error recording deposit payment', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId }
    })
    return { success: false, error: getErrorMessage(error) }
  }
}

// Record a balance payment (partial or full)
export async function recordFinalPayment(bookingId: string, formData: FormData) {
  const supabase = await createClient()
  const [{ data: { user } }, canManageDeposits] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'manage_deposits'),
  ])

  if (!canManageDeposits) {
    return { error: 'You do not have permission to record payments' }
  }

  const paymentMethod = getString(formData, 'payment_method')
  if (!paymentMethod || !(['cash', 'card', 'invoice'] as const).includes(paymentMethod as 'cash' | 'card' | 'invoice')) {
    return { success: false, error: 'Invalid payment method' }
  }

  const amountRaw = getString(formData, 'amount')
  const amount = amountRaw ? parseFloat(amountRaw) : NaN

  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'Invalid payment amount' }
  }

  try {
    const result = await PrivateBookingService.recordBalancePayment(
      bookingId,
      amount,
      paymentMethod,
      user?.id || undefined
    )

    try {
      await logAuditEvent({
        user_id: user?.id,
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          action: 'record_final_payment',
          amount,
          payment_method: paymentMethod,
        },
      })
    } catch (auditError) {
      logger.error('Failed to log audit event for recordFinalPayment', {
        error: auditError instanceof Error ? auditError : new Error(String(auditError)),
        metadata: { bookingId },
      })
    }

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    return result
  } catch (error: unknown) {
    logger.error('Error recording balance payment', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId }
    })
    return { success: false, error: getErrorMessage(error) }
  }
}

// Cancel a private booking and notify customer by SMS.
// For sub-30-day cancellations with a paid deposit, SOP §14 requires a
// manager retention decision (0..deposit + reason) — pass it via `retention`.
export async function cancelPrivateBooking(
  bookingId: string,
  reason?: string,
  retention?: { retainedAmount: number; reason: string } | null,
  capture?: {
    channel?: 'email' | 'whatsapp' | 'text' | 'phone' | 'in_person' | 'other'
    receivedAt?: string
  } | null
) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to cancel private bookings' }
  }

  // SOP §14/§25: retaining any part of the deposit is a General Manager
  // decision — require the gm_override permission.
  if (retention && retention.retainedAmount > 0) {
    const canOverride = await checkUserPermission('private_bookings', GM_OVERRIDE_ACTION)
    if (!canOverride) {
      return { error: 'Retaining a deposit requires General Manager override permission' }
    }
  }

  // Get current user
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  try {
    const result = await PrivateBookingService.cancelBooking(
      bookingId,
      reason || '',
      user?.id || undefined,
      (retention || capture)
        ? { retentionDecision: retention ?? null, capture: capture ?? null }
        : undefined
    )

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath('/events')
    revalidateTag('dashboard')
    return result
  } catch (error: unknown) {
    logger.error('Error cancelling private booking', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId }
    })
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function extendBookingHold(bookingId: string, days: 7 | 14 | 30, reason?: string) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to extend booking holds' }
  }

  if (!(reason || '').trim()) {
    return { error: 'Please record a reason for extending the hold' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  try {
    const result = await PrivateBookingService.extendHold(bookingId, days, user?.id, reason)

    try {
      await logAuditEvent({
        user_id: user?.id,
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          action: 'extend_booking_hold',
          days,
          reason,
          granted_expiry: result.newExpiry,
          capped_at_balance_due: result.capped,
        },
      })
    } catch (auditError) {
      logger.error('Failed to log audit event for extendBookingHold', {
        error: auditError instanceof Error ? auditError : new Error(String(auditError)),
        metadata: { bookingId },
      })
    }

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath('/events')
    revalidateTag('dashboard')
    return result
  } catch (error: unknown) {
    logPrivateBookingActionError('Error extending booking hold', error, { bookingId, days })
    return { error: getErrorMessage(error) }
  }
}

// Apply booking-level discount
export async function applyBookingDiscount(bookingId: string, data: {
  discount_type: 'percent' | 'fixed'
  discount_amount: number
  discount_reason: string
}) {
  const supabase = await createClient()
  const [{ data: { user } }, canEdit, canManageDiscount] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'edit'),
    checkUserPermission('private_bookings', 'manage'),
  ])
  if (!canEdit && !canManageDiscount) {
    return { error: 'You do not have permission to update private bookings' }
  }

  try {
    await PrivateBookingService.applyBookingDiscount(bookingId, data)

    try {
      await logAuditEvent({
        user_id: user?.id,
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          action: 'apply_booking_discount',
          discount_type: data.discount_type,
          discount_amount: data.discount_amount,
          discount_reason: data.discount_reason,
        },
      })
    } catch (auditError) {
      logger.error('Failed to log audit event for applyBookingDiscount', {
        error: auditError instanceof Error ? auditError : new Error(String(auditError)),
        metadata: { bookingId },
      })
    }

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error applying discount: ', error)
    return { error: getErrorMessage(error) }
  }
}

// SMS Queue Management (already using SmsQueueService directly, so no change needed here)
async function getPrivateBookingSmsQueue(statusFilter?: string[]) {
  const supabase = await createClient()
  const [{ data: { user } }, canView] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'view_sms_queue'),
  ])

  if (!user) {
    return { error: 'Not authenticated' }
  }

  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  try {
    const queue = await SmsQueueService.getQueue(statusFilter)
    return { success: true, data: queue }
  } catch (error: unknown) {
    logger.error('Error fetching private booking SMS queue', {
      error: error instanceof Error ? error : new Error(String(error))
    })
    return { error: getErrorMessage(error) }
  }
}

export async function approveSms(smsId: string) {
  const supabase = await createClient()
  const [{ data: { user } }, canApprove] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'approve_sms'),
  ])

  if (!user) {
    return { error: 'Not authenticated' }
  }

  if (!canApprove) {
    return { error: 'Insufficient permissions' }
  }

  try {
    await SmsQueueService.approveSms(smsId, user.id)
    revalidatePath('/private-bookings/sms-queue')
    return { success: true }
  } catch (error: unknown) {
    logger.error('Error approving SMS queue item', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { smsId }
    })
    return { error: getErrorMessage(error) }
  }
}

export async function rejectSms(smsId: string) {
  const supabase = await createClient()
  const [{ data: { user } }, canApprove] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'approve_sms'),
  ])

  if (!user) {
    return { error: 'Not authenticated' }
  }

  if (!canApprove) {
    return { error: 'Insufficient permissions' }
  }

  try {
    await SmsQueueService.rejectSms(smsId, user.id)
    revalidatePath('/private-bookings/sms-queue')
    return { success: true }
  } catch (error: unknown) {
    logger.error('Error rejecting SMS queue item', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { smsId }
    })
    return { error: getErrorMessage(error) }
  }
}

export async function sendApprovedSms(smsId: string) {
  const supabase = await createClient()
  const [{ data: { user } }, canSend, canManageSend] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'send'),
    checkUserPermission('private_bookings', 'manage'),
  ])

  if (!user) {
    return { error: 'Not authenticated' }
  }

  if (!canSend && !canManageSend) {
    return { error: 'Insufficient permissions' }
  }

  try {
    const result = await SmsQueueService.sendApprovedSms(smsId)
    revalidatePath('/private-bookings/sms-queue')
    if (result?.logFailure) {
      logger.error('Approved private booking SMS sent but outbound message logging failed', {
        metadata: {
          smsId,
          code: result.code ?? null
        }
      })
    }
    return { ...result, error: null }
  } catch (error: unknown) {
    logger.error('Error sending approved SMS queue item', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { smsId }
    })
    return { success: false, error: getErrorMessage(error) }
  }
}

// Venue Space Management
// SOP + optional pricing columns (VAT, whole-venue flag, minimum hours, setup
// fee, display order) live outside the base service mapping, so persist them
// here in a single follow-up update on the same row. Hire rates are stored net;
// vat_rate is applied on top at display/invoicing time.
type VenueSpaceSopColumns = {
  vat_rate: number
  blocks_all_spaces: boolean
  minimum_hours?: number
  setup_fee?: number
  display_order?: number
}

async function persistVenueSpaceSopColumns(spaceId: string, sop: VenueSpaceSopColumns) {
  const admin = createAdminClient()
  const update: Record<string, number | boolean> = {
    vat_rate: sop.vat_rate,
    blocks_all_spaces: sop.blocks_all_spaces,
  }
  if (sop.minimum_hours !== undefined) update.minimum_hours = sop.minimum_hours
  if (sop.setup_fee !== undefined) update.setup_fee = sop.setup_fee
  if (sop.display_order !== undefined) update.display_order = sop.display_order

  const { error } = await admin
    .from('venue_spaces')
    .update(update)
    .eq('id', spaceId)
  if (error) {
    throw new Error(error.message || 'Failed to save venue space settings')
  }
}

export async function createVenueSpace(data: {
  name: string
  capacity: number
  capacity_standing: number
  hire_cost: number
  description?: string | null
  vat_rate?: number
  blocks_all_spaces?: boolean
  minimum_hours?: number
  setup_fee?: number
  display_order?: number
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_spaces')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    const inserted = await PrivateBookingService.createVenueSpace(
      data,
      user.id,
      user.email || undefined
    )
    if (inserted?.id) {
      await persistVenueSpaceSopColumns(inserted.id, {
        vat_rate: data.vat_rate ?? 20,
        blocks_all_spaces: data.blocks_all_spaces ?? false,
        minimum_hours: data.minimum_hours,
        setup_fee: data.setup_fee,
        display_order: data.display_order,
      })
    }
    revalidatePath('/private-bookings/settings/spaces')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error creating venue space:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function updateVenueSpace(id: string, data: {
  name: string
  capacity: number
  capacity_standing: number
  hire_cost: number
  description?: string | null
  vat_rate?: number
  blocks_all_spaces?: boolean
  minimum_hours?: number
  setup_fee?: number
  display_order?: number
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_spaces')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.updateVenueSpace(id, data, user.id, user.email || undefined)
    await persistVenueSpaceSopColumns(id, {
      vat_rate: data.vat_rate ?? 20,
      blocks_all_spaces: data.blocks_all_spaces ?? false,
      minimum_hours: data.minimum_hours,
      setup_fee: data.setup_fee,
      display_order: data.display_order,
    })
    revalidatePath('/private-bookings/settings/spaces')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error updating venue space:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function deleteVenueSpace(id: string) {
  const permission = await requirePrivateBookingsPermission('manage_spaces')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.deleteVenueSpace(id, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/spaces')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error deleting venue space:', error)
    return { error: getErrorMessage(error) }
  }
}

// Catering Package Management
type CateringPackageCategory = 'food' | 'drink' | 'addon' | 'self_catering' | 'other'

// SOP columns (VAT + waiver/allergy/seasonal flags) live outside the base
// service mapping, so persist them here in a single follow-up update on the
// same row the service just wrote. Prices are stored net; vat_rate is applied
// on top at display/invoicing time.
async function persistCateringSopColumns(
  packageId: string,
  sop: {
    vat_rate: number
    requires_waiver: boolean
    requires_allergy_capture: boolean
    seasonal: boolean
  }
) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('catering_packages')
    .update({
      vat_rate: sop.vat_rate,
      requires_waiver: sop.requires_waiver,
      requires_allergy_capture: sop.requires_allergy_capture,
      seasonal: sop.seasonal,
    })
    .eq('id', packageId)
  if (error) {
    throw new Error(error.message || 'Failed to save catering package settings')
  }
}

export async function createCateringPackage(data: {
  name: string
  serving_style: string
  category: CateringPackageCategory
  per_head_cost: number
  pricing_model?: 'per_head' | 'total_value'
  minimum_order?: number | null
  summary?: string | null
  includes?: string | null
  served?: string | null
  good_to_know?: string | null
  guest_description?: string | null
  dietary_notes?: string | null
  vat_rate?: number
  requires_waiver?: boolean
  requires_allergy_capture?: boolean
  seasonal?: boolean
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_catering')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    const inserted = await PrivateBookingService.createCateringPackage(
      data,
      user.id,
      user.email || undefined
    )
    if (inserted?.id) {
      await persistCateringSopColumns(inserted.id, {
        vat_rate: data.vat_rate ?? 20,
        requires_waiver: data.requires_waiver ?? false,
        requires_allergy_capture: data.requires_allergy_capture ?? false,
        seasonal: data.seasonal ?? false,
      })
    }
    revalidatePath('/private-bookings/settings/catering')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error creating catering package:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function updateCateringPackage(id: string, data: {
  name: string
  serving_style: string
  category: CateringPackageCategory
  per_head_cost: number
  pricing_model?: 'per_head' | 'total_value'
  minimum_order?: number | null
  summary?: string | null
  includes?: string | null
  served?: string | null
  good_to_know?: string | null
  guest_description?: string | null
  dietary_notes?: string | null
  vat_rate?: number
  requires_waiver?: boolean
  requires_allergy_capture?: boolean
  seasonal?: boolean
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_catering')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.updateCateringPackage(
      id,
      data,
      user.id,
      user.email || undefined
    )
    await persistCateringSopColumns(id, {
      vat_rate: data.vat_rate ?? 20,
      requires_waiver: data.requires_waiver ?? false,
      requires_allergy_capture: data.requires_allergy_capture ?? false,
      seasonal: data.seasonal ?? false,
    })
    revalidatePath('/private-bookings/settings/catering')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error updating catering package:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function deleteCateringPackage(id: string) {
  const permission = await requirePrivateBookingsPermission('manage_catering')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.deleteCateringPackage(id, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/catering')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error deleting catering package:', error)
    return { error: getErrorMessage(error) }
  }
}

// Booking Items Management
async function getBookingItems(bookingId: string) {
  const canView = await checkUserPermission('private_bookings', 'view')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('private_booking_items')
    .select(`
      *,
      space:venue_spaces(*),
      package:catering_packages(*),
      vendor:vendors(*)
    `)
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true })

  if (error) {
    logPrivateBookingActionError('Error fetching booking items:', error)
    return { error: getErrorMessage(error) }
  }

  return { data }
}

export async function addBookingItem(data: {
  booking_id: string
  item_type: 'space' | 'catering' | 'vendor' | 'other'
  space_id?: string | null
  package_id?: string | null
  vendor_id?: string | null
  description: string
  quantity: number
  unit_price: number
  discount_value?: number
  discount_type?: 'percent' | 'fixed'
  notes?: string | null
}) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to modify private bookings' }
  }

  try {
    await PrivateBookingService.addBookingItem({
      booking_id: data.booking_id,
      item_type: data.item_type,
      space_id: data.space_id,
      package_id: data.package_id,
      vendor_id: data.vendor_id,
      description: data.description,
      quantity: data.quantity,
      unit_price: data.unit_price,
      discount_value: data.discount_value,
      discount_type: data.discount_type,
      notes: data.notes
    });

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${data.booking_id}`)
    revalidatePath(`/private-bookings/${data.booking_id}/items`)
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error adding booking item:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function updateBookingItem(itemId: string, data: {
  quantity?: number
  unit_price?: number
  discount_value?: number
  discount_type?: 'percent' | 'fixed'
  notes?: string | null
}) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to modify private bookings' }
  }

  try {
    const result = await PrivateBookingService.updateBookingItem(itemId, data);

    // Revalidate the booking pages
    const bookingId = result.bookingId;
    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath(`/private-bookings/${bookingId}/items`)
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error updating booking item:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function deleteBookingItem(itemId: string) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to modify private bookings' }
  }

  try {
    const result = await PrivateBookingService.deleteBookingItem(itemId);

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${result.bookingId}`)
    revalidatePath(`/private-bookings/${result.bookingId}/items`)
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error deleting booking item:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function reorderBookingItems(bookingId: string, orderedIds: string[]) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to modify private bookings' }
  }

  try {
    await PrivateBookingService.reorderBookingItems(bookingId, orderedIds);

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath(`/private-bookings/${bookingId}/items`)
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error updating booking item order:', error)
    return { error: getErrorMessage(error) }
  }
}

// Vendor Management
export async function createVendor(data: {
  name: string
  vendor_type: string
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  typical_rate?: number | null
  notes?: string | null
  is_preferred: boolean
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_vendors')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  if (!ALLOWED_VENDOR_TYPES.includes(data.vendor_type as (typeof ALLOWED_VENDOR_TYPES)[number])) {
    return { error: 'Invalid vendor type provided' }
  }

  try {
    await PrivateBookingService.createVendor(data, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/vendors')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error creating vendor:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function updateVendor(id: string, data: {
  name: string
  vendor_type: string
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  typical_rate?: number | null
  notes?: string | null
  is_preferred: boolean
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_vendors')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  if (!ALLOWED_VENDOR_TYPES.includes(data.vendor_type as (typeof ALLOWED_VENDOR_TYPES)[number])) {
    return { error: 'Invalid vendor type provided' }
  }

  try {
    await PrivateBookingService.updateVendor(id, data, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/vendors')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error updating vendor:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function deleteVendor(id: string) {
  const permission = await requirePrivateBookingsPermission('manage_vendors')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.deleteVendor(id, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/vendors')
    return { success: true }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error deleting vendor:', error)
    return { error: getErrorMessage(error) }
  }
}

// Create a PayPal order for a private booking deposit
export async function createDepositPaymentOrder(
  bookingId: string
): Promise<{ success?: boolean; approveUrl?: string; orderId?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const canManageDeposits = await checkUserPermission('private_bookings', 'manage_deposits')
  if (!canManageDeposits) {
    return { error: 'You do not have permission to manage deposits' }
  }

  // Fetch the booking using admin client (service role) to avoid RLS issues during write
  const admin = createAdminClient()
  const { data: booking, error: fetchError } = await admin
    .from('private_bookings')
    .select('id, deposit_amount, event_date, event_type, customer_name, customer_first_name, contact_email, status, deposit_paid_date, paypal_deposit_order_id')
    .eq('id', bookingId)
    .maybeSingle()

  if (fetchError) {
    logger.error('Error fetching booking for PayPal deposit order', {
      error: fetchError,
      metadata: { bookingId }
    })
    return { error: 'Failed to load booking' }
  }

  if (!booking) {
    return { error: 'Booking not found' }
  }

  if (booking.status === 'cancelled' || booking.status === 'completed') {
    return { error: 'Deposits can only be recorded against draft or confirmed bookings' }
  }

  if (booking.deposit_paid_date) {
    return { error: 'Deposit has already been paid for this booking' }
  }

  const depositAmount = typeof booking.deposit_amount === 'number' ? booking.deposit_amount : 0
  if (depositAmount <= 0) {
    return { error: 'No deposit amount set for this booking' }
  }

  // If an order already exists, attempt to reuse it
  if (booking.paypal_deposit_order_id) {
    try {
      const existingOrder = await getPayPalOrder(booking.paypal_deposit_order_id)
      const existingOrderAmount = getPayPalOrderAmount(existingOrder)
      const existingOrderCurrency = getPayPalOrderCurrency(existingOrder)
      // If order is still CREATED or APPROVED, return its approve URL
      if (
        (existingOrder?.status === 'CREATED' || existingOrder?.status === 'APPROVED') &&
        existingOrderAmount !== null &&
        amountsMatch(existingOrderAmount, depositAmount) &&
        existingOrderCurrency === PAYPAL_DEFAULT_CURRENCY
      ) {
        const approveUrl =
          existingOrder.links?.find((l: { rel: string; href: string }) => l.rel === 'payer-action')?.href ||
          existingOrder.links?.find((l: { rel: string; href: string }) => l.rel === 'approve')?.href
        if (approveUrl) {
          return { success: true, approveUrl, orderId: booking.paypal_deposit_order_id }
        }
      }
      if (
        existingOrderAmount !== null &&
        (!amountsMatch(existingOrderAmount, depositAmount) || existingOrderCurrency !== PAYPAL_DEFAULT_CURRENCY)
      ) {
        await admin
          .from('private_bookings')
          .update({ paypal_deposit_order_id: null, updated_at: new Date().toISOString() })
          .eq('id', bookingId)
      }
      // Order is no longer usable — fall through to create a new one
    } catch (lookupError) {
      logger.error('Failed to look up existing PayPal deposit order; will create a new one', {
        error: lookupError instanceof Error ? lookupError : new Error(String(lookupError)),
        metadata: { bookingId, orderId: booking.paypal_deposit_order_id }
      })
    }
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const result = await createSimplePayPalOrder({
      customId: `pb-deposit-${bookingId}`,
      reference: bookingId,
      description: `Deposit for ${booking.event_type || 'Private Booking'} on ${booking.event_date}`,
      amount: depositAmount,
      returnUrl: `${appUrl}/private-bookings/${bookingId}?paypal_return=deposit`,
      cancelUrl: `${appUrl}/private-bookings/${bookingId}?paypal_cancel=deposit`,
      currency: 'GBP',
      brandName: 'The Anchor',
      requestId: `pb-deposit-${bookingId}`,
    })

    // Persist the order ID so we can re-use or track it
    const { error: updateError } = await admin
      .from('private_bookings')
      .update({ paypal_deposit_order_id: result.orderId })
      .eq('id', bookingId)

    if (updateError) {
      logger.error('Failed to persist paypal_deposit_order_id on booking', {
        error: updateError,
        metadata: { bookingId, orderId: result.orderId }
      })
      // Non-fatal: the payment link is still valid even if we couldn't persist the order ID
    }

    return { success: true, approveUrl: result.approveUrl, orderId: result.orderId }
  } catch (error: unknown) {
    logger.error('Error creating PayPal deposit order', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId }
    })
    return { error: getErrorMessage(error) }
  }
}

// Capture a PayPal deposit payment after the customer approves it
export async function captureDepositPayment(
  bookingId: string,
  orderId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const canManageDeposits = await checkUserPermission('private_bookings', 'manage_deposits')
  if (!canManageDeposits) {
    return { error: 'You do not have permission to manage deposits' }
  }

  const admin = createAdminClient()
  const { data: booking, error: fetchError } = await admin
    .from('private_bookings')
    .select('id, deposit_amount, deposit_paid_date, paypal_deposit_order_id, status, customer_first_name, customer_name, event_date, event_type, contact_email, contact_phone, customer_id, calendar_event_id, balance_due_date, total_amount')
    .eq('id', bookingId)
    .maybeSingle()

  if (fetchError) {
    logger.error('Error fetching booking for PayPal deposit capture', {
      error: fetchError,
      metadata: { bookingId }
    })
    return { error: 'Failed to load booking' }
  }

  if (!booking) {
    return { error: 'Booking not found' }
  }

  if (booking.paypal_deposit_order_id !== orderId) {
    return { error: 'Order ID does not match this booking' }
  }

  if (booking.deposit_paid_date) {
    // Already captured — idempotent success
    return { success: true }
  }

  try {
    const expectedAmount = Number(booking.deposit_amount ?? 0)
    if (expectedAmount <= 0) {
      return { error: 'No deposit is required for this booking' }
    }

    const order = await getPayPalOrder(orderId)
    const orderAmount = getPayPalOrderAmount(order)
    const orderCurrency = getPayPalOrderCurrency(order)
    if (
      orderAmount === null ||
      !amountsMatch(orderAmount, expectedAmount) ||
      orderCurrency !== PAYPAL_DEFAULT_CURRENCY
    ) {
      logger.error('PayPal order amount mismatch before capture', {
        metadata: { bookingId, orderId, orderAmount, orderCurrency, expectedAmount, expectedCurrency: PAYPAL_DEFAULT_CURRENCY }
      })
      return { error: `Payment amount mismatch: PayPal order is not for the expected £${expectedAmount.toFixed(2)} deposit. Please create a fresh payment link.` }
    }

    const captureResult = await capturePayPalPayment(orderId, PAYPAL_DEFAULT_CURRENCY)

    // SEC-3: Validate captured amount matches expected deposit
    const capturedAmount = parseFloat(captureResult.amount)
    if (!amountsMatch(capturedAmount, expectedAmount)) {
      logger.error('PayPal capture amount mismatch', {
        metadata: { bookingId, orderId, capturedAmount, expectedAmount }
      })
      return { error: `Payment amount mismatch: captured £${capturedAmount.toFixed(2)} but expected £${expectedAmount.toFixed(2)}. Please contact support.` }
    }

    // D15: Audit log BEFORE finalization so the capture attempt is recorded
    // even if finalizeDepositPayment throws
    try {
      await logAuditEvent({
        user_id: user.id,
        operation_type: 'paypal_capture',
        resource_type: 'private_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          action: 'paypal_deposit_capture_attempted',
          phase: 'pre_finalization',
          order_id: orderId,
          capture_id: captureResult.transactionId,
          amount: captureResult.amount,
          currency: captureResult.currency,
        },
      })
    } catch (auditError) {
      logger.error('Failed to log pre-finalization audit event for PayPal deposit capture', {
        error: auditError instanceof Error ? auditError : new Error(String(auditError)),
        metadata: { bookingId }
      })
    }

    await finalizeDepositPayment({
      bookingId,
      amount: capturedAmount,
      method: 'paypal',
      paypalCaptureId: captureResult.transactionId,
      performedByUserId: user.id,
    }, admin)

    // Post-finalization audit log
    try {
      await logAuditEvent({
        user_id: user.id,
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          action: 'paypal_deposit_captured',
          order_id: orderId,
          capture_id: captureResult.transactionId,
          amount: captureResult.amount,
        },
      })
    } catch (auditError) {
      logger.error('Failed to log audit event for PayPal deposit capture', {
        error: auditError instanceof Error ? auditError : new Error(String(auditError)),
        metadata: { bookingId }
      })
    }

    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath('/private-bookings')
    revalidatePath('/events')
    revalidateTag('dashboard')
    return { success: true }
  } catch (error: unknown) {
    logger.error('Error capturing PayPal deposit payment', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId, orderId }
    })
    return { error: getErrorMessage(error) }
  }
}

/**
 * Resend a calendar invite (.ics) to the customer for a confirmed/completed booking.
 * Awaited — caller sees success/failure immediately.
 */
export async function resendCalendarInvite(
  bookingId: string
): Promise<{ success?: boolean; error?: string }> {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) {
    return { error: 'You do not have permission to perform this action' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Fetch the booking fields needed for the invite
  const admin = createAdminClient()
  const { data: booking, error: fetchError } = await admin
    .from('private_bookings')
    .select(
      'id, customer_id, contact_email, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, event_type, guest_count, status'
    )
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return { error: 'Booking not found' }
  }

  if (!booking.contact_email) {
    return { error: 'This booking has no contact email address' }
  }

  if (booking.status !== 'confirmed' && booking.status !== 'completed') {
    return { error: 'Calendar invites can only be sent for confirmed or completed bookings' }
  }

  try {
    await sendBookingCalendarInvite(booking)
  } catch (e) {
    logPrivateBookingActionError('Error sending calendar invite', e, { bookingId })
    return { error: 'Failed to send the calendar invite — please try again' }
  }

  try {
    await logAuditEvent({
      user_id: user.id,
      operation_type: 'calendar_invite_resent',
      resource_type: 'private_booking',
      resource_id: bookingId,
      operation_status: 'success',
    })
  } catch (auditError) {
    logger.error('Failed to log audit event for calendar invite resend', {
      error: auditError instanceof Error ? auditError : new Error(String(auditError)),
      metadata: { bookingId },
    })
  }

  revalidatePath(`/private-bookings/${bookingId}`)
  return { success: true }
}

/**
 * Generates a shareable, read-only customer portal link for a private booking.
 * The link embeds an HMAC-signed token — no login required for the customer.
 * Requires the caller to have at least 'view' permission on private_bookings.
 */
export async function getBookingPortalLink(
  bookingId: string
): Promise<{ success?: boolean; url?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Generating a portal link exposes booking data to an external party via a
  // public URL. This is a write-like operation (sharing data outside the app),
  // so it requires edit permission rather than just view.
  const hasPermission = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!hasPermission) {
    return { error: 'Insufficient permissions' }
  }

  const token = generateBookingToken(bookingId)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const url = `${baseUrl}/booking-portal/${token}`

  return { success: true, url }
}

/**
 * Create a PayPal deposit payment order and email the approve link directly to the customer.
 * Staff-initiated, not automated.
 */
export async function sendDepositPaymentLink(
  bookingId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const canManageDeposits = await checkUserPermission('private_bookings', 'manage_deposits')
  if (!canManageDeposits) return { error: 'You do not have permission to manage deposits' }

  const admin = createAdminClient()
  const { data: booking, error: fetchError } = await admin
    .from('private_bookings')
    .select('id, customer_id, deposit_amount, deposit_paid_date, status, event_date, event_type, customer_first_name, customer_name, contact_email')
    .eq('id', bookingId)
    .maybeSingle()

  if (fetchError) return { error: 'Failed to load booking' }
  if (!booking) return { error: 'Booking not found' }
  if (booking.status === 'cancelled' || booking.status === 'completed') return { error: 'Deposit payment links can only be sent for draft or confirmed bookings' }
  if (booking.deposit_paid_date) return { error: 'Deposit has already been paid' }

  const depositAmount = typeof booking.deposit_amount === 'number' ? booking.deposit_amount : 0
  if (depositAmount <= 0) return { error: 'No deposit amount set for this booking' }
  if (!booking.contact_email) return { error: 'No email address on file for this customer' }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const portalToken = generateBookingToken(bookingId)
    const portalUrl = `${appUrl}/booking-portal/${portalToken}`

    const result = await createSimplePayPalOrder({
      customId: `pb-deposit-${bookingId}`,
      reference: bookingId,
      description: `Deposit for ${booking.event_type || 'Private Booking'} on ${booking.event_date}`,
      amount: depositAmount,
      returnUrl: `${portalUrl}?payment_pending=1`,
      cancelUrl: `${portalUrl}`,
      currency: 'GBP',
      brandName: 'The Anchor',
      // Unique per-send so we always get a fresh PayPal link rather than reusing a stale one
      requestId: `pb-deposit-customer-${bookingId}-${Date.now()}`,
    })

    // Persist the latest order ID
    await admin
      .from('private_bookings')
      .update({ paypal_deposit_order_id: result.orderId })
      .eq('id', bookingId)

    await sendDepositPaymentLinkEmail(booking, result.approveUrl, `${portalUrl}?fresh_payment_link=1`)

    logger.info('Deposit payment link sent to customer', { metadata: { bookingId, orderId: result.orderId } })
    return { success: true }
  } catch (error: unknown) {
    logger.error('Error sending deposit payment link', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId }
    })
    return { error: error instanceof Error ? error.message : 'Failed to send payment link' }
  }
}

export async function editPrivateBookingPayment(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const canEdit = await checkUserPermission('private_bookings', 'manage', user.id)
  const type = formData.get('type') as string
  if (!canEdit) {
    // For deposit edits, also accept manage_deposits permission (AI-1)
    if (type !== 'deposit' || !(await checkUserPermission('private_bookings', 'manage_deposits', user.id))) {
      return { error: 'Forbidden' }
    }
  }

  if (type === 'balance') {
    const parsed = editBalancePaymentSchema.safeParse({
      paymentId: formData.get('paymentId'),
      bookingId: formData.get('bookingId'),
      type: formData.get('type'),
      amount: formData.get('amount'),
      method: formData.get('method'),
      notes: formData.get('notes') ?? undefined,
    })
    if (!parsed.success) return { error: parsed.error.errors[0].message }

    const db = createAdminClient()
    const { data: oldPayment } = await db.from('private_booking_payments').select('amount, method').eq('id', parsed.data.paymentId).single()

    try {
      await updateBalancePayment(parsed.data.paymentId, parsed.data.bookingId, {
        amount: parseFloat(parsed.data.amount),
        method: parsed.data.method,
        notes: parsed.data.notes,
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to update payment' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      operation_status: 'success',
      resource_type: 'private_booking_payment',
      additional_info: {
        action: 'edit_private_booking_payment',
        booking_id: parsed.data.bookingId,
        payment_id: parsed.data.paymentId,
        payment_type: 'balance',
        old_amount: oldPayment?.amount,
        new_amount: parseFloat(parsed.data.amount),
        old_method: oldPayment?.method,
        new_method: parsed.data.method,
      },
    })
    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${parsed.data.bookingId}`)
    return { success: true }
  }

  if (type === 'deposit') {
    const parsed = editDepositSchema.safeParse({
      bookingId: formData.get('bookingId'),
      type: formData.get('type'),
      amount: formData.get('amount'),
      method: formData.get('method'),
    })
    if (!parsed.success) return { error: parsed.error.errors[0].message }

    const db = createAdminClient()
    const { data: oldBooking } = await db.from('private_bookings').select('deposit_amount, deposit_payment_method, deposit_paid_date').eq('id', parsed.data.bookingId).single()
    const newAmount = parseFloat(parsed.data.amount)

    if (oldBooking?.deposit_paid_date && newAmount <= 0) {
      return { error: 'Paid deposit amount must be greater than £0' }
    }

    // SOP §12: reducing the deposit below the £250 default needs the General
    // Manager override permission, not just a recorded reason.
    if (newAmount < 250) {
      const canOverride = await checkUserPermission('private_bookings', GM_OVERRIDE_ACTION, user.id)
      if (!canOverride) {
        return { error: 'Deposit reductions need General Manager override permission' }
      }
    }

    // SOP §12: reductions below £250 need a recorded reason; £0 needs an
    // explicit GM waiver. Collected from the deposit edit form.
    const reductionReason = (formData.get('reduction_reason') as string | null)?.trim() || undefined
    const waived = formData.get('waived') === 'true'
    const waivedReason = (formData.get('waived_reason') as string | null)?.trim() || undefined

    try {
      if (oldBooking?.deposit_paid_date) {
        // Paid deposit: update amount + method (existing behaviour)
        await updateDeposit(parsed.data.bookingId, {
          amount: newAmount,
          method: parsed.data.method,
        })
      } else {
        // Unpaid deposit: update amount only, clear PayPal order (CR-1, ID-1)
        await updateDepositAmount(parsed.data.bookingId, newAmount, user.id, {
          reductionReason,
          waived,
          waivedReason,
        })
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to update deposit' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      operation_status: 'success',
      resource_type: 'private_booking',
      additional_info: {
        action: 'edit_private_booking_deposit',
        booking_id: parsed.data.bookingId,
        old_amount: oldBooking?.deposit_amount,
        new_amount: newAmount,
        old_method: oldBooking?.deposit_payment_method,
        new_method: oldBooking?.deposit_paid_date ? parsed.data.method : oldBooking?.deposit_payment_method,
        deposit_paid: !!oldBooking?.deposit_paid_date,
        no_deposit_required: !oldBooking?.deposit_paid_date && newAmount <= 0,
        ...(reductionReason ? { reduction_reason: reductionReason } : {}),
        ...(waived ? { deposit_waived: true, waived_reason: waivedReason } : {}),
      },
    })
    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${parsed.data.bookingId}`)
    return { success: true }
  }

  return { error: 'Invalid payment type' }
}

export async function deletePrivateBookingPayment(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const canDelete = await checkUserPermission('private_bookings', 'manage', user.id)
  if (!canDelete) return { error: 'Forbidden' }

  const parsed = deletePaymentSchema.safeParse({
    paymentId: formData.get('paymentId'),
    type: formData.get('type'),
    bookingId: formData.get('bookingId'),
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const { paymentId, type, bookingId } = parsed.data

  if (type === 'balance') {
    const db = createAdminClient()
    const { data: payment } = await db.from('private_booking_payments').select('amount, method').eq('id', paymentId).single()

    try {
      await deleteBalancePayment(paymentId, bookingId)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to delete payment' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'delete',
      operation_status: 'success',
      resource_type: 'private_booking_payment',
      additional_info: { action: 'delete_private_booking_payment', booking_id: bookingId, payment_id: paymentId, payment_type: 'balance', amount: payment?.amount, method: payment?.method },
    })
  } else {
    const db = createAdminClient()
    const { data: booking } = await db.from('private_bookings').select('deposit_amount, deposit_payment_method, status').eq('id', bookingId).single()

    let statusReverted = false
    try {
      const result = await deleteDeposit(bookingId)
      statusReverted = result.statusReverted
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to delete deposit' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'delete',
      operation_status: 'success',
      resource_type: 'private_booking',
      additional_info: { action: 'delete_private_booking_deposit', booking_id: bookingId, amount: booking?.deposit_amount, method: booking?.deposit_payment_method, status_reverted: statusReverted },
    })
  }

  revalidatePath('/private-bookings')
  revalidatePath(`/private-bookings/${bookingId}`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Send manual SMS for a private booking (uses booking-specific queue)
// ---------------------------------------------------------------------------

export async function sendPrivateBookingSms(
  bookingId: string,
  message: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const [{ data: { user } }, canSend, canManage] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('private_bookings', 'send'),
    checkUserPermission('private_bookings', 'manage'),
  ])

  if (!canSend && !canManage) {
    return { error: 'You do not have permission to send SMS for private bookings' }
  }

  if (!user) {
    return { error: 'You must be signed in to send messages' }
  }

  const trimmedMessage = message?.trim()
  if (!trimmedMessage) {
    return { error: 'Message body is required' }
  }

  try {
    const admin = createAdminClient()
    const { data: booking, error: fetchError } = await admin
      .from('private_bookings')
      .select('id, contact_phone, customer_name, customer_first_name, customer_id, event_date')
      .eq('id', bookingId)
      .maybeSingle()

    if (fetchError || !booking) {
      return { error: 'Booking not found' }
    }

    if (!booking.contact_phone) {
      return { error: 'No phone number on file for this booking' }
    }

    const result = await SmsQueueService.queueAndSend({
      booking_id: bookingId,
      trigger_type: 'manual',
      template_key: 'private_booking_manual',
      message_body: trimmedMessage,
      customer_phone: booking.contact_phone,
      customer_name: booking.customer_name || booking.customer_first_name || undefined,
      customer_id: booking.customer_id,
      created_by: user.id,
      priority: 1,
      metadata: {
        template: 'private_booking_manual',
        sent_by: user.email ?? user.id,
      },
    })

    if (result?.error) {
      logger.error('Manual private booking SMS failed', {
        error: new Error(String(result.error)),
        metadata: { bookingId, userId: user.id },
      })
      return { error: typeof result.error === 'string' ? result.error : 'Failed to send SMS' }
    }

    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath(`/private-bookings/${bookingId}/messages`)
    revalidatePath(`/private-bookings/${bookingId}/communications`)
    return { success: true }
  } catch (error) {
    logPrivateBookingActionError('Error sending private booking SMS:', error, { bookingId })
    return { error: getErrorMessage(error) }
  }
}

// Send the contract + terms to the customer (SOP §11: the contract must be
// provided before the deposit is paid, and the send must be recorded).
// Generates a fresh version, stores the HTML + PDF snapshots, emails the PDF
// and stamps contract_sent_at / contract_sent_to.
export async function sendBookingContract(
  bookingId: string
): Promise<{ success?: boolean; version?: number; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const canSend = await checkUserPermission('private_bookings', 'generate_contracts')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canSend) return { error: 'You do not have permission to send contracts' }

  try {
    const { generateContractDocument, storeContractSnapshot } = await import('@/lib/private-bookings/contract-lifecycle')
    const { generatePDFFromHTML } = await import('@/lib/pdf-generator')
    const { sendContractEmailToCustomer } = await import('@/lib/email/private-booking-emails')

    const { html, version, booking } = await generateContractDocument(bookingId, { performedBy: user.id })

    if (!booking.contact_email) {
      return { error: 'This booking has no contact email address — add one before sending the contract' }
    }

    const pdf = await generatePDFFromHTML(html, {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })

    const admin = createAdminClient()
    await storeContractSnapshot(admin, {
      bookingId,
      version,
      fileName: `contract-v${version}.pdf`,
      content: pdf,
      mimeType: 'application/pdf',
      generatedBy: user.id,
      metadata: { sent_to: booking.contact_email },
    })

    await sendContractEmailToCustomer(booking, { version, pdf })

    const nowIso = new Date().toISOString()
    const { error: updateError } = await admin
      .from('private_bookings')
      .update({ contract_sent_at: nowIso, contract_sent_to: booking.contact_email, updated_at: nowIso })
      .eq('id', bookingId)
    if (updateError) {
      logger.error('Failed to record contract send', {
        error: new Error(updateError.message),
        metadata: { bookingId },
      })
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'private_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        action: 'contract_sent',
        contract_version: version,
        sent_to: booking.contact_email,
        customer_notified: true,
      },
    })

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    return { success: true, version }
  } catch (error: unknown) {
    logPrivateBookingActionError('Error sending booking contract:', error, { bookingId })
    return { error: getErrorMessage(error) }
  }
}
