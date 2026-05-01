'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refundPayPalPayment } from '@/lib/paypal'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'

type SourceType = 'private_booking' | 'table_booking' | 'parking'
type RefundMethod = 'paypal' | 'cash' | 'bank_transfer' | 'other'

const SOURCE_MODULE_MAP: Record<SourceType, string> = {
  private_booking: 'private_bookings',
  table_booking: 'table_bookings',
  parking: 'parking',
}

const REVALIDATE_PATHS: Record<SourceType, string> = {
  private_booking: '/private-bookings',
  table_booking: '/table-bookings',
  parking: '/parking',
}

const PAYPAL_REFUND_WINDOW_DAYS = 180

interface SourceBookingData {
  id: string
  captureId: string | null
  captureDate: string | null
  originalAmount: number
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
}

async function getAuthenticatedUser(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  return { userId: user.id }
}

async function checkRefundPermission(sourceType: SourceType, userId: string): Promise<boolean> {
  const permModule = SOURCE_MODULE_MAP[sourceType]
  return checkUserPermission(permModule as any, 'refund', userId)
}

async function loadSourceBooking(
  db: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  sourceId: string
): Promise<SourceBookingData | null> {
  if (sourceType === 'private_booking') {
    const { data } = await db
      .from('private_bookings')
      .select('id, paypal_deposit_capture_id, deposit_paid_date, deposit_amount, customer_name, contact_email, contact_phone')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    return {
      id: data.id,
      captureId: data.paypal_deposit_capture_id,
      captureDate: data.deposit_paid_date,
      originalAmount: Number(data.deposit_amount) || 0,
      customerName: data.customer_name,
      customerEmail: data.contact_email,
      customerPhone: data.contact_phone,
    }
  }

  if (sourceType === 'table_booking') {
    const { data } = await db
      .from('table_bookings')
      .select('id, paypal_deposit_capture_id, card_capture_completed_at, deposit_amount, deposit_amount_locked, customer_id, customers(first_name, last_name, email, mobile_e164)')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    const customer = (data as any).customers
    return {
      id: data.id,
      captureId: data.paypal_deposit_capture_id,
      captureDate: data.card_capture_completed_at,
      originalAmount: Number(data.deposit_amount_locked ?? data.deposit_amount) || 0,
      customerName: customer ? `${customer.first_name} ${customer.last_name}`.trim() : null,
      customerEmail: customer?.email ?? null,
      customerPhone: customer?.mobile_e164 ?? null,
    }
  }

  if (sourceType === 'parking') {
    const { data } = await db
      .from('parking_booking_payments')
      .select('id, transaction_id, paid_at, amount, booking_id, parking_bookings(guest_name, email, phone)')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    const booking = (data as any).parking_bookings
    return {
      id: data.id,
      captureId: data.transaction_id,
      captureDate: data.paid_at,
      originalAmount: Number(data.amount) || 0,
      customerName: booking?.guest_name ?? null,
      customerEmail: booking?.email ?? null,
      customerPhone: booking?.phone ?? null,
    }
  }

  return null
}

function isCaptureExpired(captureDate: string | null): boolean {
  if (!captureDate) return false
  const capture = new Date(captureDate)
  const now = new Date()
  const diffDays = (now.getTime() - capture.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays > PAYPAL_REFUND_WINDOW_DAYS
}

async function updateRefundStatus(
  db: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  sourceId: string,
  originalAmount: number
): Promise<void> {
  // Sum all completed refunds
  const { data: refunds } = await db
    .from('payment_refunds')
    .select('amount')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('status', 'completed')

  const totalRefunded = (refunds || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)
  const status = totalRefunded >= originalAmount ? 'refunded' : 'partially_refunded'

  if (sourceType === 'private_booking') {
    await db.from('private_bookings').update({ deposit_refund_status: status }).eq('id', sourceId)
  } else if (sourceType === 'table_booking') {
    await db.from('table_bookings').update({ deposit_refund_status: status }).eq('id', sourceId)
  } else if (sourceType === 'parking') {
    await db.from('parking_booking_payments').update({ refund_status: status }).eq('id', sourceId)

    // Also update the parent parking_bookings.payment_status when fully refunded
    if (status === 'refunded') {
      const { data: paymentRow } = await db
        .from('parking_booking_payments')
        .select('booking_id')
        .eq('id', sourceId)
        .maybeSingle()

      if (paymentRow?.booking_id) {
        await db.from('parking_bookings').update({ payment_status: 'refunded' }).eq('id', paymentRow.booking_id)
      }
    }
  }
}

export async function processPayPalRefund(
  sourceType: SourceType,
  sourceId: string,
  amount: number,
  reason: string
): Promise<{ success?: boolean; refundId?: string; pending?: boolean; message?: string; warning?: string; error?: string }> {
  // 1. Auth
  const auth = await getAuthenticatedUser()
  if ('error' in auth) return { error: auth.error }
  const { userId } = auth

  // 2. Permission
  const hasPermission = await checkRefundPermission(sourceType, userId)
  if (!hasPermission) return { error: 'Insufficient permission to process refunds' }

  const db = createAdminClient()

  // 3. Load booking
  const booking = await loadSourceBooking(db, sourceType, sourceId)
  if (!booking) return { error: 'Booking not found' }

  // 4. Validate capture exists
  if (!booking.captureId) return { error: 'No PayPal payment to refund. Use manual refund instead.' }

  // 5. Validate capture date within 180-day window
  if (isCaptureExpired(booking.captureDate)) {
    return { error: 'PayPal refund window expired (180 days). Use manual refund instead.' }
  }

  // 6. Check for existing pending PayPal refund row (stable idempotency key across retries)
  let refundRowId: string
  let paypalRequestId: string

  const { data: existingPending } = await db
    .from('payment_refunds')
    .select('id, paypal_request_id')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('status', 'pending')
    .eq('refund_method', 'paypal')
    .maybeSingle()

  if (existingPending) {
    // Reuse the existing pending row and its PayPal-Request-Id for idempotent retries
    refundRowId = existingPending.id
    paypalRequestId = existingPending.paypal_request_id
  } else {
    // 7. Atomic balance check + row insertion via RPC (advisory lock held for entire transaction)
    paypalRequestId = randomUUID()
    const { data: reserveResult, error: reserveError } = await db.rpc('reserve_refund_balance', {
      p_source_type: sourceType,
      p_source_id: sourceId,
      p_original_amount: booking.originalAmount,
      p_amount: amount,
      p_refund_method: 'paypal',
      p_reason: reason,
      p_initiated_by: userId,
      p_paypal_capture_id: booking.captureId,
      p_paypal_request_id: paypalRequestId,
    })

    if (reserveError) {
      // The RPC raises an exception if amount exceeds balance
      if (reserveError.message.includes('exceeds refundable balance')) {
        return { error: `Amount exceeds refundable balance` }
      }
      return { error: `Balance reservation failed: ${reserveError.message}` }
    }

    const row = Array.isArray(reserveResult) ? reserveResult[0] : reserveResult
    if (!row?.refund_id) return { error: 'Failed to create refund record' }
    refundRowId = row.refund_id
  }

  const refundRow = { id: refundRowId }

  // 8. Call PayPal — separate the API call from post-processing so a parsing
  //    error after a successful refund doesn't mark the row as "failed" while
  //    money has already left the account.
  let result: Awaited<ReturnType<typeof refundPayPalPayment>>
  try {
    result = await refundPayPalPayment(booking.captureId, amount, paypalRequestId)
  } catch (err) {
    // PayPal API actually rejected the refund — safe to mark as failed
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    await db.from('payment_refunds').update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_message: errorMessage,
    }).eq('id', refundRow.id)

    await logAuditEvent({
      user_id: userId,
      operation_type: 'refund',
      resource_type: sourceType,
      resource_id: sourceId,
      operation_status: 'failure',
      error_message: errorMessage,
      additional_info: { refund_id: refundRow.id, amount, method: 'paypal' },
    })

    return { error: `PayPal refund failed: ${errorMessage}. You can try again or use manual refund.` }
  }

  // PayPal returned a response (2xx) — money may have moved. From here,
  // any error is a local bookkeeping issue, NOT a reason to mark as failed.
  try {
    if (result.status === 'COMPLETED') {
      const { error: completedUpdateError } = await db.from('payment_refunds').update({
        status: 'completed',
        paypal_refund_id: result.refundId,
        paypal_status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      }).eq('id', refundRow.id)

      if (completedUpdateError) {
        console.error('Refund processed at PayPal but local status update failed:', completedUpdateError.message)
        return { success: true, refundId: refundRow.id, warning: 'Refund processed at PayPal but local status update failed. Please refresh.' }
      }

      await updateRefundStatus(db, sourceType, sourceId, booking.originalAmount)

      let notificationStatus: string | null = null
      if (booking.customerName) {
        notificationStatus = await sendRefundNotification({
          customerName: booking.customerName,
          email: booking.customerEmail,
          phone: booking.customerPhone,
          amount,
        })
      } else {
        notificationStatus = 'skipped'
      }
      await db.from('payment_refunds').update({ notification_status: notificationStatus }).eq('id', refundRow.id)

      await logAuditEvent({
        user_id: userId,
        operation_type: 'refund',
        resource_type: sourceType,
        resource_id: sourceId,
        operation_status: 'success',
        additional_info: {
          refund_id: refundRow.id,
          paypal_refund_id: result.refundId,
          amount,
          method: 'paypal',
          notification_status: notificationStatus,
        },
      })

      revalidatePath(REVALIDATE_PATHS[sourceType])
      return { success: true, refundId: refundRow.id }
    }

    if (result.status === 'PENDING') {
      const { error: pendingUpdateError } = await db.from('payment_refunds').update({
        paypal_refund_id: result.refundId,
        paypal_status: 'PENDING',
        paypal_status_details: result.statusDetails || null,
      }).eq('id', refundRow.id)

      if (pendingUpdateError) {
        console.error('Refund pending at PayPal but local status update failed:', pendingUpdateError.message)
      }

      await logAuditEvent({
        user_id: userId,
        operation_type: 'refund',
        resource_type: sourceType,
        resource_id: sourceId,
        operation_status: 'success',
        additional_info: {
          refund_id: refundRow.id,
          paypal_refund_id: result.refundId,
          amount,
          method: 'paypal',
          paypal_status: 'PENDING',
          status_details: result.statusDetails,
        },
      })

      revalidatePath(REVALIDATE_PATHS[sourceType])
      return {
        success: true,
        refundId: refundRow.id,
        pending: true,
        message: 'Refund initiated but pending at PayPal — status will update automatically.',
      }
    }

    // FAILED or CANCELLED status from PayPal
    await db.from('payment_refunds').update({
      status: 'failed',
      paypal_refund_id: result.refundId,
      paypal_status: result.status,
      failed_at: new Date().toISOString(),
      failure_message: `PayPal returned status: ${result.status}`,
    }).eq('id', refundRow.id)

    return { error: `PayPal refund returned status: ${result.status}. You can try again or use manual refund.` }
  } catch (postProcessErr) {
    // PayPal succeeded but local bookkeeping failed — DO NOT mark as failed
    const errorMessage = postProcessErr instanceof Error ? postProcessErr.message : 'Unknown error'
    console.error('PayPal refund succeeded but post-processing failed:', errorMessage)

    // Best-effort: mark as completed even if we lost some details
    await db.from('payment_refunds').update({
      status: 'completed',
      paypal_status: result.status,
      completed_at: new Date().toISOString(),
      failure_message: `Post-processing error: ${errorMessage}`,
    }).eq('id', refundRow.id)

    await logAuditEvent({
      user_id: userId,
      operation_type: 'refund',
      resource_type: sourceType,
      resource_id: sourceId,
      operation_status: 'success',
      additional_info: {
        refund_id: refundRow.id,
        amount,
        method: 'paypal',
        warning: `Post-processing failed: ${errorMessage}`,
      },
    })

    revalidatePath(REVALIDATE_PATHS[sourceType])
    return { success: true, refundId: refundRow.id, warning: 'Refund processed at PayPal but some local updates may have failed. Please refresh.' }
  }
}

export async function processManualRefund(
  sourceType: SourceType,
  sourceId: string,
  amount: number,
  reason: string,
  refundMethod: 'cash' | 'bank_transfer' | 'other'
): Promise<{ success?: boolean; refundId?: string; error?: string }> {
  // 0. Validate method — PayPal refunds must use processPayPalRefund (runtime guard against API misuse)
  if ((refundMethod as string) === 'paypal') return { error: 'Use PayPal refund for PayPal payments' }

  // 1. Auth
  const auth = await getAuthenticatedUser()
  if ('error' in auth) return { error: auth.error }
  const { userId } = auth

  // 2. Permission
  const hasPermission = await checkRefundPermission(sourceType, userId)
  if (!hasPermission) return { error: 'Insufficient permission to process refunds' }

  const db = createAdminClient()

  // 3. Load booking
  const booking = await loadSourceBooking(db, sourceType, sourceId)
  if (!booking) return { error: 'Booking not found' }

  // 4. Atomic balance check + row insertion via RPC
  const { data: reserveResult, error: reserveError } = await db.rpc('reserve_refund_balance', {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_original_amount: booking.originalAmount,
    p_amount: amount,
    p_refund_method: refundMethod,
    p_reason: reason,
    p_initiated_by: userId,
  })

  if (reserveError) {
    if (reserveError.message.includes('exceeds refundable balance')) {
      return { error: `Amount exceeds refundable balance` }
    }
    return { error: `Balance reservation failed: ${reserveError.message}` }
  }

  const row = Array.isArray(reserveResult) ? reserveResult[0] : reserveResult
  if (!row?.refund_id) return { error: 'Failed to create refund record' }

  // 5. Mark as completed immediately (manual refunds are instant)
  const { error: completeError } = await db
    .from('payment_refunds')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', row.refund_id)

  if (completeError) return { error: `Failed to complete refund record: ${completeError.message}` }

  const refundRow = { id: row.refund_id }

  // 6. Update booking refund status
  await updateRefundStatus(db, sourceType, sourceId, booking.originalAmount)

  // 7. Audit
  await logAuditEvent({
    user_id: userId,
    operation_type: 'refund',
    resource_type: sourceType,
    resource_id: sourceId,
    operation_status: 'success',
    additional_info: {
      refund_id: refundRow.id,
      amount,
      method: refundMethod,
    },
  })

  revalidatePath(REVALIDATE_PATHS[sourceType])
  return { success: true, refundId: refundRow.id }
}

export async function getRefundHistory(
  sourceType: SourceType,
  sourceId: string
): Promise<{ data?: any[]; error?: string }> {
  // Auth check — view permission on the domain
  const auth = await getAuthenticatedUser()
  if ('error' in auth) return { error: auth.error }

  const permModule = SOURCE_MODULE_MAP[sourceType]
  const hasPermission = await checkUserPermission(permModule as any, 'view', auth.userId)
  if (!hasPermission) return { error: 'Insufficient permission' }

  const db = createAdminClient()
  const { data, error } = await db
    .from('payment_refunds')
    .select('id, source_type, source_id, refund_method, amount, original_amount, reason, status, paypal_status, paypal_refund_id, notification_status, initiated_by_type, completed_at, failed_at, created_at')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
  return { data: data || [] }
}

export async function getParkingPaymentForRefund(
  bookingId: string
): Promise<{ data?: { paymentId: string; amount: number; hasCapture: boolean; captureDate: string | null }; error?: string }> {
  const auth = await getAuthenticatedUser()
  if ('error' in auth) return { error: auth.error }

  const hasPermission = await checkUserPermission('parking' as any, 'view', auth.userId)
  if (!hasPermission) return { error: 'Insufficient permission' }

  const db = createAdminClient()
  const { data: payment, error } = await db
    .from('parking_booking_payments')
    .select('id, amount, transaction_id, paid_at')
    .eq('booking_id', bookingId)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { error: error.message }
  if (!payment) return { error: 'No paid payment record found for this booking.' }

  return {
    data: {
      paymentId: payment.id,
      amount: Number(payment.amount) || 0,
      hasCapture: !!payment.transaction_id,
      captureDate: payment.paid_at,
    },
  }
}
