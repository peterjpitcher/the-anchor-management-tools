'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createPayPalOrder } from '@/lib/paypal';
import { revalidatePath } from 'next/cache';

export async function createTableBookingPayment(bookingId: string) {
  console.log('[Payment Journey] Starting payment creation for booking:', bookingId);
  
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
      console.error('[Payment Journey] Booking not found:', bookingId, bookingError);
      return { error: 'Booking not found' };
    }
    
    console.log('[Payment Journey] Booking found:', {
      reference: booking.booking_reference,
      status: booking.status,
      type: booking.booking_type,
      partySize: booking.party_size
    });
    
    // Check if payment is required
    if (booking.status !== 'pending_payment' || booking.booking_type !== 'sunday_lunch') {
      return { error: 'Payment not required for this booking' };
    }
    
    // Check if payment already exists
    const { data: existingPayment } = await supabase
      .from('table_booking_payments')
      .select('*')
      .eq('booking_id', bookingId)
      .eq('status', 'pending')
      .single();
      
    if (existingPayment) {
      console.log('[Payment Journey] Found existing pending payment:', existingPayment.transaction_id);
      return { 
        orderId: existingPayment.transaction_id,
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
    
    console.log('[Payment Journey] Payment amounts calculated:', {
      total: totalAmount,
      deposit: depositAmount,
      outstanding: outstandingAmount
    });
    
    // Create PayPal order
    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/table-bookings/payment/return?booking_id=${bookingId}`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/${booking.booking_reference}/payment?cancelled=true`;
    
    let paypalOrder;
    try {
      console.log('[Payment Journey] Creating PayPal order...');
      paypalOrder = await createPayPalOrder(
        booking,
        returnUrl,
        cancelUrl,
        true // depositOnly
      );
      console.log('[Payment Journey] PayPal order created:', paypalOrder.orderId);
    } catch (paypalError) {
      console.error('PayPal order creation failed:', paypalError);
      
      // Return specific error for PayPal configuration issues
      if (paypalError instanceof Error && paypalError.message.includes('credentials')) {
        return { error: 'Payment system is not configured. Please contact support.' };
      }
      
      return { error: 'Failed to create payment order. Please try again later.' };
    }
    
    if (!paypalOrder.orderId || !paypalOrder.approveUrl) {
      return { error: 'Invalid payment order response' };
    }
    
    // Create payment record
    const { error: paymentError } = await supabase
      .from('table_booking_payments')
      .insert({
        booking_id: bookingId,
        amount: depositAmount,
        payment_method: 'paypal',
        status: 'pending', // Changed from payment_status to status
        transaction_id: paypalOrder.orderId, // Changed from provider_transaction_id to transaction_id
        payment_metadata: {
          paypal_order_id: paypalOrder.orderId,
          deposit_amount: depositAmount,
          total_amount: totalAmount,
          outstanding_amount: outstandingAmount,
          approve_url: paypalOrder.approveUrl,
        }
      });
      
    if (paymentError) {
      console.error('Payment record error details:', {
        error: paymentError,
        message: paymentError.message,
        code: paymentError.code,
        details: paymentError.details,
        hint: paymentError.hint,
        bookingId,
        transactionId: paypalOrder.orderId,
      });
      
      // More specific error messages based on error code
      if (paymentError.code === '23505') {
        return { error: 'A payment for this booking already exists' };
      }
      
      if (paymentError.code === '23503') {
        return { error: 'Invalid booking reference' };
      }
      
      return { error: 'Failed to create payment record. Please try again.' };
    }
    
    console.log('[Payment Journey] Payment record created successfully');
    
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
          status,
          transaction_id,
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
      paymentStatus: payment?.status,
      paymentUrl: payment?.payment_metadata?.approve_url
    };
    
  } catch (error) {
    console.error('Check payment status error:', error);
    return { error: 'Failed to check payment status' };
  }
}