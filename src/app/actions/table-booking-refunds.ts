'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { refundPayPalPayment } from '@/lib/paypal';
import { queueCancellationSMS } from './table-booking-sms';

export async function processBookingRefund(
  bookingId: string,
  refundAmount?: number,
  reason?: string
) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to process refunds' };
    }
    
    // Get booking with payment
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_payments(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (bookingError || !booking) {
      return { error: 'Booking not found' };
    }
    
    // Find completed payment
    const payment = booking.table_booking_payments?.find(
      (p: any) => p.status === 'completed'
    );
    
    if (!payment) {
      return { error: 'No payment found for this booking' };
    }
    
    // Calculate refund amount if not specified
    let finalRefundAmount = refundAmount;
    if (!finalRefundAmount) {
      const { data: refundCalc } = await supabase.rpc('calculate_refund_amount', {
        p_booking_id: bookingId,
      });
      
      finalRefundAmount = refundCalc?.[0]?.refund_amount || 0;
    }
    
    if (!finalRefundAmount || finalRefundAmount <= 0) {
      return { error: 'No refund due for this booking' };
    }
    
    if (finalRefundAmount > payment.amount) {
      return { error: 'Refund amount exceeds payment amount' };
    }
    
    try {
      // Process PayPal refund
      const refundResult = await refundPayPalPayment(
        payment.transaction_id,
        finalRefundAmount,
        reason || 'Customer requested cancellation'
      );
      
      // Update payment record
      await supabase
        .from('table_booking_payments')
        .update({
          status: finalRefundAmount === payment.amount ? 'refunded' : 'partial_refund',
          refund_amount: finalRefundAmount,
          refund_transaction_id: refundResult.refundId,
          refunded_at: new Date().toISOString(),
          payment_metadata: {
            ...payment.payment_metadata,
            refund_id: refundResult.refundId,
            refund_reason: reason,
          },
        })
        .eq('id', payment.id);
      
      // Update booking status if full refund
      if (finalRefundAmount === payment.amount) {
        await supabase
          .from('table_bookings')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: reason || 'Refund processed',
          })
          .eq('id', bookingId);
      }
      
      // Log audit event
      await logAuditEvent({
        operation_type: 'refund',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          booking_reference: booking.booking_reference,
          refund_amount: finalRefundAmount,
          refund_id: refundResult.refundId,
          reason,
        },
      });
      
      // Send refund notification
      if (booking.customer?.sms_opt_in) {
        const refundMessage = `A refund of £${finalRefundAmount.toFixed(2)} has been processed.`;
        await queueCancellationSMS(bookingId, refundMessage);
      }
      
      // Queue refund email
      await supabase.from('jobs').insert({
        type: 'send_email',
        payload: {
          to: booking.customer.email,
          template: 'table_booking_refund',
          data: {
            booking,
            refund_amount: finalRefundAmount,
            refund_reason: reason,
          },
        },
        scheduled_for: new Date().toISOString(),
      });
      
      return { 
        success: true, 
        data: {
          refund_id: refundResult.refundId,
          refund_amount: finalRefundAmount,
          status: refundResult.status,
        }
      };
    } catch (refundError: any) {
      console.error('PayPal refund error:', refundError);
      
      // Log failed refund attempt
      await logAuditEvent({
        operation_type: 'refund_failed',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'failure',
        additional_info: {
          booking_reference: booking.booking_reference,
          error: refundError.message,
          attempted_amount: finalRefundAmount,
        },
      });
      
      return { error: 'Failed to process refund. Please try again or contact support.' };
    }
  } catch (error) {
    console.error('Process refund error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get refund eligibility
export async function getRefundEligibility(bookingId: string) {
  try {
    const supabase = await createClient();
    
    const { data: refundCalc } = await supabase.rpc('calculate_refund_amount', {
      p_booking_id: bookingId,
    });
    
    if (!refundCalc || refundCalc.length === 0) {
      return { error: 'Unable to calculate refund eligibility' };
    }
    
    return {
      data: {
        refund_percentage: refundCalc[0].refund_percentage,
        refund_amount: refundCalc[0].refund_amount,
        refund_reason: refundCalc[0].refund_reason,
      }
    };
  } catch (error) {
    console.error('Get refund eligibility error:', error);
    return { error: 'An unexpected error occurred' };
  }
}