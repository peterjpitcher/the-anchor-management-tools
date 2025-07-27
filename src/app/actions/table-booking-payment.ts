'use server';

import { createAdminClient } from '@/lib/supabase/server';
import { createPayPalOrder } from '@/lib/paypal';
import { revalidatePath } from 'next/cache';

export async function createTableBookingPayment(bookingId: string) {
  try {
    const supabase = createAdminClient();
    
    // Get booking with items
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        table_booking_items(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (bookingError || !booking) {
      return { error: 'Booking not found' };
    }
    
    // Check if payment is required
    if (booking.status !== 'pending_payment' || booking.booking_type !== 'sunday_lunch') {
      return { error: 'Payment not required for this booking' };
    }
    
    // Check if payment already exists
    const { data: existingPayment } = await supabase
      .from('table_booking_payments')
      .select('*')
      .eq('booking_id', bookingId)
      .eq('payment_status', 'pending')
      .single();
      
    if (existingPayment) {
      return { 
        orderId: existingPayment.provider_transaction_id,
        approveUrl: existingPayment.payment_metadata?.approve_url 
      };
    }
    
    // Calculate amounts
    const totalAmount = booking.table_booking_items?.reduce(
      (sum: number, item: any) => sum + (item.price_at_booking * item.quantity), 
      0
    ) || 0;
    
    const depositAmount = booking.party_size * 5;
    const outstandingAmount = totalAmount - depositAmount;
    
    // Create PayPal order
    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/table-bookings/payment/return?booking_id=${bookingId}`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/${booking.booking_reference}/payment?cancelled=true`;
    
    const paypalOrder = await createPayPalOrder(
      booking,
      returnUrl,
      cancelUrl,
      true // depositOnly
    );
    
    if (!paypalOrder.orderId || !paypalOrder.approveUrl) {
      return { error: 'Failed to create payment order' };
    }
    
    // Create payment record
    const { error: paymentError } = await supabase
      .from('table_booking_payments')
      .insert({
        booking_id: bookingId,
        amount: depositAmount,
        payment_method: 'paypal',
        payment_status: 'pending',
        provider_transaction_id: paypalOrder.orderId,
        payment_metadata: {
          paypal_order_id: paypalOrder.orderId,
          deposit_amount: depositAmount,
          total_amount: totalAmount,
          outstanding_amount: outstandingAmount,
          approve_url: paypalOrder.approveUrl,
        }
      });
      
    if (paymentError) {
      console.error('Payment record error:', paymentError);
      return { error: 'Failed to create payment record' };
    }
    
    revalidatePath(`/table-booking/${booking.booking_reference}/payment`);
    
    return { 
      orderId: paypalOrder.orderId, 
      approveUrl: paypalOrder.approveUrl 
    };
    
  } catch (error) {
    console.error('Create payment error:', error);
    
    // Check if it's a PayPal configuration error
    if (error instanceof Error && error.message.includes('PayPal')) {
      return { error: 'Payment system is not configured. Please contact support.' };
    }
    
    return { error: 'Failed to create payment. Please try again.' };
  }
}

export async function checkPaymentStatus(bookingReference: string) {
  try {
    const supabase = createAdminClient();
    
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`
        id,
        status,
        booking_reference,
        table_booking_payments(
          payment_status,
          provider_transaction_id,
          payment_metadata
        )
      `)
      .eq('booking_reference', bookingReference)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }
    
    const payment = booking.table_booking_payments?.[0];
    
    return {
      bookingStatus: booking.status,
      paymentStatus: payment?.payment_status,
      paymentUrl: payment?.payment_metadata?.approve_url
    };
    
  } catch (error) {
    console.error('Check payment status error:', error);
    return { error: 'Failed to check payment status' };
  }
}