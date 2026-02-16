'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { checkUserPermission } from '@/app/actions/rbac'
import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import type {
  PrivateBookingWithDetails,
  BookingStatus,
} from '@/types/private-bookings'
import type { User as SupabaseUser } from '@supabase/supabase-js'

import { toLocalIsoDate } from '@/lib/dateUtils'
import { sanitizeMoneyString } from '@/lib/utils'
import { logAuditEvent } from './audit'
import {
  PrivateBookingService,
  privateBookingSchema,
  bookingNoteSchema,
  formatTimeToHHMM,
  ALLOWED_VENDOR_TYPES,
  CreatePrivateBookingInput,
  UpdatePrivateBookingInput
} from '@/services/private-bookings'
import { SmsQueueService } from '@/services/sms-queue' // Still needed for SMS actions

// Helper function to extract string values from FormData
const getString = (formData: FormData, key: string): string | undefined => {
  const value = formData.get(key)
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }
  return undefined
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
    const hasPermission = await checkUserPermission('private_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view private bookings' };
    }
    const { data } = await PrivateBookingService.getBookings(filters);
    return { data };
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching private bookings:', error);
    return { error: error.message || 'An error occurred' };
  }
}

// Get single private booking by ID
export async function getPrivateBooking(
  id: string,
  variant: 'detail' | 'edit' | 'items' | 'messages' = 'detail'
) {
  const canView = await checkUserPermission('private_bookings', 'view')
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
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching private booking:', error);
    return { error: error.message || 'An error occurred' };
  }
}

// Create a new private booking
export async function createPrivateBooking(formData: FormData) {
  try {
    const supabase = await createClient()
    const isDateTbd = formData.get('date_tbd') === 'true'

    const canCreate = await checkUserPermission('private_bookings', 'create')
    if (!canCreate) {
      return { error: 'You do not have permission to create private bookings' }
    }

    const rawData = {
      customer_first_name: (getString(formData, 'customer_first_name') || '').trim(),
      customer_last_name: getString(formData, 'customer_last_name'),
      customer_id: getString(formData, 'customer_id'),
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
      balance_due_date: getString(formData, 'balance_due_date'),
      hold_expiry: getString(formData, 'deposit_due_date'),
    }

    // Validate data
    const validationResult = privateBookingSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const bookingData = validationResult.data

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()

    // Call Service
    const booking = await PrivateBookingService.createBooking({
      ...bookingData,
      customer_last_name: bookingData.customer_last_name || undefined,
      customer_id: bookingData.customer_id || undefined,
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
      balance_due_date: bookingData.balance_due_date || undefined,
      hold_expiry: bookingData.hold_expiry || undefined,
      created_by: user?.id,
      date_tbd: isDateTbd
    } as CreatePrivateBookingInput);

    revalidatePath('/private-bookings')
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true, data: booking }
  } catch (error: any) {
    logPrivateBookingActionError('Error creating private booking:', error)
    return { error: error.message || 'An error occurred' }
  }
}

// Update private booking
export async function updatePrivateBooking(id: string, formData: FormData) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
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
    status: getString(formData, 'status') as BookingStatus | undefined,
  }

  // Validate data
  const validationResult = privateBookingSchema.safeParse(rawData)
  if (!validationResult.success) {
    return { error: validationResult.error.errors[0].message }
  }

  const bookingData = validationResult.data

  try {
    // Call Service
    const booking = await PrivateBookingService.updateBooking(id, {
      ...bookingData,
      date_tbd: isDateTbd
    } as UpdatePrivateBookingInput, user.id);

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${id}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true, data: booking }
  } catch (error: any) {
    logPrivateBookingActionError('Error updating private booking:', error)
    return { error: error.message || 'An error occurred' }
  }
}

// Update booking status
export async function updateBookingStatus(id: string, status: BookingStatus) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error updating booking status:', error)
    return { error: error.message || 'An error occurred' }
  }
}

export async function addPrivateBookingNote(bookingId: string, note: string) {
  const validation = bookingNoteSchema.safeParse({ note })
  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Note validation failed.' }
  }

  const supabase = await createClient()

  const canEdit = await checkUserPermission('private_bookings', 'edit')
  if (!canEdit) {
    return { error: 'You do not have permission to add notes to private bookings' }
  }

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'You must be signed in to add a note' }
  }

  const trimmedNote = validation.data.note

  try {
    await PrivateBookingService.addNote(bookingId, trimmedNote, user.id, user.email || undefined)
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error recording booking note:', error)
    return { error: error.message || 'Failed to save note' }
  }
}

// Delete private booking
export async function deletePrivateBooking(id: string) {
  const supabase = await createClient()

  const canDelete = await checkUserPermission('private_bookings', 'delete')
  if (!canDelete) {
    return { error: 'You do not have permission to delete private bookings' }
  }

  try {
    const { deletedBooking } = await PrivateBookingService.deletePrivateBooking(id);

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${id}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error deleting private booking:', error)
    return { error: error.message || 'An error occurred' }
  }
}

// Get venue spaces
export async function getVenueSpaces(activeOnly = true) {
  const canView = await checkUserPermission('private_bookings', 'view')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const data = await PrivateBookingService.getVenueSpaces(activeOnly);
    return { data };
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching venue spaces:', error);
    return { error: error.message || 'An error occurred' };
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
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching venue spaces for management:', error)
    return { error: error.message || 'An error occurred' }
  }
}

// Get catering packages
export async function getCateringPackages(activeOnly = true) {
  const canView = await checkUserPermission('private_bookings', 'view')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const data = await PrivateBookingService.getCateringPackages(activeOnly);
    return { data };
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching catering packages:', error);
    return { error: error.message || 'An error occurred' };
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
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching catering packages for management:', error)
    return { error: error.message || 'An error occurred' }
  }
}

// Get vendors
export async function getVendors(serviceType?: string, activeOnly = true) {
  const canView = await checkUserPermission('private_bookings', 'view')
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
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching vendors:', error);
    return { error: error.message || 'An error occurred' };
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
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching vendors for management:', error)
    return { error: error.message || 'An error occurred' }
  }
}

export async function getVendorRate(vendorId: string) {
  const canView = await checkUserPermission('private_bookings', 'view')
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
  } catch (error: any) {
    logPrivateBookingActionError('Error fetching vendor rate:', error)
    return { error: error.message || 'Vendor not found' }
  }
}

// Record deposit payment
export async function recordDepositPayment(bookingId: string, formData: FormData) {
  const supabase = await createClient()

  const canManageDeposits = await checkUserPermission('private_bookings', 'manage_deposits')
  if (!canManageDeposits) {
    return { error: 'You do not have permission to record deposits' }
  }

  const paymentMethod = getString(formData, 'payment_method') as string
  const amount = parseFloat(getString(formData, 'amount') as string)

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()

  try {
    const result = await PrivateBookingService.recordDeposit(
      bookingId,
      amount,
      paymentMethod,
      user?.id || undefined
    )

    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return result
  } catch (error: any) {
    logger.error('Error recording deposit payment', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId }
    })
    return { success: false, error: error.message || 'An error occurred' }
  }
}

// Record final payment
export async function recordFinalPayment(bookingId: string, formData: FormData) {
  const supabase = await createClient()

  const canManageDeposits = await checkUserPermission('private_bookings', 'manage_deposits')
  if (!canManageDeposits) {
    return { error: 'You do not have permission to record payments' }
  }

  const paymentMethod = getString(formData, 'payment_method') as string

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()

  try {
    const result = await PrivateBookingService.recordFinalPayment(
      bookingId,
      paymentMethod,
      user?.id || undefined
    )

    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return result
  } catch (error: any) {
    logger.error('Error recording final payment', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId }
    })
    return { success: false, error: error.message || 'An error occurred' }
  }
}

// Cancel a private booking and notify customer by SMS
export async function cancelPrivateBooking(bookingId: string, reason?: string) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
  if (!canEdit) {
    return { error: 'You do not have permission to cancel private bookings' }
  }

  // Get current user
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  try {
    const result = await PrivateBookingService.cancelBooking(
      bookingId,
      reason || '',
      user?.id || undefined
    )

    revalidatePath('/private-bookings')
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return result
  } catch (error: any) {
    logger.error('Error cancelling private booking', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId }
    })
    return { success: false, error: error.message || 'Failed to cancel booking' }
  }
}

// Apply booking-level discount
export async function applyBookingDiscount(bookingId: string, data: {
  discount_type: 'percent' | 'fixed'
  discount_amount: number
  discount_reason: string
}) {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
  if (!canEdit) {
    return { error: 'You do not have permission to update private bookings' }
  }

  try {
    await PrivateBookingService.applyBookingDiscount(bookingId, data)

    revalidatePath(`/private-bookings/${bookingId}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error applying discount: ', error)
    return { error: error.message || 'Failed to apply discount' }
  }
}

// SMS Queue Management (already using SmsQueueService directly, so no change needed here)
export async function getPrivateBookingSmsQueue(statusFilter?: string[]) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const canView = await checkUserPermission('private_bookings', 'view_sms_queue')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  try {
    const queue = await SmsQueueService.getQueue(statusFilter)
    return { success: true, data: queue }
  } catch (error: any) {
    logger.error('Error fetching private booking SMS queue', {
      error: error instanceof Error ? error : new Error(String(error))
    })
    return { error: error.message || 'Failed to fetch SMS queue' }
  }
}

export async function approveSms(smsId: string) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const canApprove = await checkUserPermission('private_bookings', 'approve_sms')
  if (!canApprove) {
    return { error: 'Insufficient permissions' }
  }

  try {
    await SmsQueueService.approveSms(smsId, user.id)
    revalidatePath('/private-bookings/sms-queue')
    return { success: true }
  } catch (error: any) {
    logger.error('Error approving SMS queue item', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { smsId }
    })
    return { error: error.message || 'Failed to approve SMS' }
  }
}

export async function rejectSms(smsId: string) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const canApprove = await checkUserPermission('private_bookings', 'approve_sms')
  if (!canApprove) {
    return { error: 'Insufficient permissions' }
  }

  try {
    await SmsQueueService.rejectSms(smsId, user.id)
    revalidatePath('/private-bookings/sms-queue')
    return { success: true }
  } catch (error: any) {
    logger.error('Error rejecting SMS queue item', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { smsId }
    })
    return { error: error.message || 'Failed to reject SMS' }
  }
}

export async function sendApprovedSms(smsId: string) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const canSend = await checkUserPermission('private_bookings', 'send')
  if (!canSend) {
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
  } catch (error: any) {
    logger.error('Error sending approved SMS queue item', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { smsId }
    })
    return { success: false, error: error.message || 'Failed to send SMS' }
  }
}

// Venue Space Management
export async function createVenueSpace(data: {
  name: string
  capacity: number
  capacity_standing: number
  hire_cost: number
  description?: string | null
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_spaces')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.createVenueSpace(data, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/spaces')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error creating venue space:', error)
    return { error: error.message || 'Failed to create venue space' }
  }
}

export async function updateVenueSpace(id: string, data: {
  name: string
  capacity: number
  capacity_standing: number
  hire_cost: number
  description?: string | null
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_spaces')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.updateVenueSpace(id, data, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/spaces')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error updating venue space:', error)
    return { error: error.message || 'Failed to update venue space' }
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
  } catch (error: any) {
    logPrivateBookingActionError('Error deleting venue space:', error)
    return { error: error.message || 'Failed to delete venue space' }
  }
}

// Catering Package Management
export async function createCateringPackage(data: {
  name: string
  serving_style: string
  category: 'food' | 'drink' | 'addon'
  per_head_cost: number
  pricing_model?: 'per_head' | 'total_value'
  minimum_order?: number | null
  description?: string | null
  includes?: string | null
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_catering')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.createCateringPackage(data, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/catering')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error creating catering package:', error)
    return { error: error.message || 'An unexpected error occurred' }
  }
}

export async function updateCateringPackage(id: string, data: {
  name: string
  serving_style: string
  category: 'food' | 'drink' | 'addon'
  per_head_cost: number
  pricing_model?: 'per_head' | 'total_value'
  minimum_order?: number | null
  description?: string | null
  includes?: string | null
  is_active: boolean
}) {
  const permission = await requirePrivateBookingsPermission('manage_catering')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user } = permission

  try {
    await PrivateBookingService.updateCateringPackage(id, data, user.id, user.email || undefined)
    revalidatePath('/private-bookings/settings/catering')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error updating catering package:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
  } catch (error: any) {
    logPrivateBookingActionError('Error deleting catering package:', error)
    return { error: error.message || 'An unexpected error occurred' }
  }
}

// Booking Items Management
export async function getBookingItems(bookingId: string) {
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
    return { error: error.message || 'Failed to fetch booking items' }
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
  const supabase = await createClient()

  const canEdit = await checkUserPermission('private_bookings', 'edit')
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

    revalidatePath(`/private-bookings/${data.booking_id}`)
    revalidatePath(`/private-bookings/${data.booking_id}/items`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error adding booking item:', error)
    return { error: error.message || 'An error occurred' }
  }
}

export async function updateBookingItem(itemId: string, data: {
  quantity?: number
  unit_price?: number
  discount_value?: number
  discount_type?: 'percent' | 'fixed'
  notes?: string | null
}) {
  const supabase = await createClient()

  const canEdit = await checkUserPermission('private_bookings', 'edit')
  if (!canEdit) {
    return { error: 'You do not have permission to modify private bookings' }
  }

  try {
    const result = await PrivateBookingService.updateBookingItem(itemId, data);

    // Revalidate the booking pages
    const bookingId = result.bookingId;
    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath(`/private-bookings/${bookingId}/items`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error updating booking item:', error)
    return { error: error.message || 'An error occurred' }
  }
}

export async function deleteBookingItem(itemId: string) {
  const supabase = await createClient()

  const canEdit = await checkUserPermission('private_bookings', 'edit')
  if (!canEdit) {
    return { error: 'You do not have permission to modify private bookings' }
  }

  try {
    const result = await PrivateBookingService.deleteBookingItem(itemId);

    revalidatePath(`/private-bookings/${result.bookingId}`)
    revalidatePath(`/private-bookings/${result.bookingId}/items`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error deleting booking item:', error)
    return { error: error.message || 'Failed to delete booking item' }
  }
}

export async function reorderBookingItems(bookingId: string, orderedIds: string[]) {
  const supabase = await createClient()

  const canEdit = await checkUserPermission('private_bookings', 'edit')
  if (!canEdit) {
    return { error: 'You do not have permission to modify private bookings' }
  }

  try {
    await PrivateBookingService.reorderBookingItems(bookingId, orderedIds);

    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath(`/private-bookings/${bookingId}/items`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error: any) {
    logPrivateBookingActionError('Error updating booking item order:', error)
    return { error: error.message || 'An error occurred' }
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
  } catch (error: any) {
    logPrivateBookingActionError('Error creating vendor:', error)
    return { error: error.message || 'Failed to create vendor' }
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
  } catch (error: any) {
    logPrivateBookingActionError('Error updating vendor:', error)
    return { error: error.message || 'Failed to update vendor' }
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
  } catch (error: any) {
    logPrivateBookingActionError('Error deleting vendor:', error)
    return { error: error.message || 'Failed to delete vendor' }
  }
}
