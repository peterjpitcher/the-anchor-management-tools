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
      .select('id, paypal_deposit_capture_id, card_capture_completed_at, deposit_amount, customer_id, customers(first_name, last_name, email, mobile_e164)')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    const customer = (data as any).customers
    return {
      id: data.id,
      captureId: data.paypal_deposit_capture_id,
      captureDate: data.card_capture_completed_at,
      originalAmount: Number(data.deposit_amount) || 0,
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
  }
}

export async function processPayPalRefund(
  sourceType: SourceType,
  sourceId: string,
  amount: number,
  reason: string
): Promise<{ success?: boolean; refundId?: string; pending?: boolean; message?: string; error?: string }> {
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

  // 6. Check remaining balance with advisory lock
  const { data: remaining, error: rpcError } = await db.rpc('calculate_refundable_balance', {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_original_amount: booking.originalAmount,
  })

  if (rpcError) return { error: `Balance check failed: ${rpcError.message}` }
  if (amount > (remaining ?? 0)) return { error: `Amount exceeds refundable balance (£${(remaining ?? 0).toFixed(2)} remaining)` }

  // 7. Insert pending refund row
  const paypalRequestId = randomUUID()
  const { data: refundRow, error: insertError } = await db
    .from('payment_refunds')
    .insert({
      source_type: sourceType,
      source_id: sourceId,
      paypal_capture_id: booking.captureId,
      paypal_request_id: paypalRequestId,
      refund_method: 'paypal',
      amount,
      original_amount: booking.originalAmount,
      reason,
      status: 'pending',
      initiated_by: userId,
      initiated_by_type: 'staff',
    })
    .select('id')
    .single()

  if (insertError || !refundRow) return { error: `Failed to create refund record: ${insertError?.message}` }

  // 8. Call PayPal
  try {
    const result = await refundPayPalPayment(booking.captureId, amount, paypalRequestId)

    if (result.status === 'COMPLETED') {
      // Update refund row
      await db.from('payment_refunds').update({
        status: 'completed',
        paypal_refund_id: result.refundId,
        paypal_status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      }).eq('id', refundRow.id)

      // Update booking refund status
      await updateRefundStatus(db, sourceType, sourceId, booking.originalAmount)

      // Send notification
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

      // Audit
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
      await db.from('payment_refunds').update({
        paypal_refund_id: result.refundId,
        paypal_status: 'PENDING',
        paypal_status_details: result.statusDetails || null,
      }).eq('id', refundRow.id)

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

    // FAILED or CANCELLED
    throw new Error(`PayPal returned status: ${result.status}`)
  } catch (err) {
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
}

export async function processManualRefund(
  sourceType: SourceType,
  sourceId: string,
  amount: number,
  reason: string,
  refundMethod: 'cash' | 'bank_transfer' | 'other'
): Promise<{ success?: boolean; refundId?: string; error?: string }> {
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

  // 4. Check remaining balance with advisory lock
  const { data: remaining, error: rpcError } = await db.rpc('calculate_refundable_balance', {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_original_amount: booking.originalAmount,
  })

  if (rpcError) return { error: `Balance check failed: ${rpcError.message}` }
  if (amount > (remaining ?? 0)) return { error: `Amount exceeds refundable balance (£${(remaining ?? 0).toFixed(2)} remaining)` }

  // 5. Insert completed refund row
  const { data: refundRow, error: insertError } = await db
    .from('payment_refunds')
    .insert({
      source_type: sourceType,
      source_id: sourceId,
      refund_method: refundMethod,
      amount,
      original_amount: booking.originalAmount,
      reason,
      status: 'completed',
      completed_at: new Date().toISOString(),
      initiated_by: userId,
      initiated_by_type: 'staff',
    })
    .select('id')
    .single()

  if (insertError || !refundRow) return { error: `Failed to create refund record: ${insertError?.message}` }

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
    .select('*')
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
