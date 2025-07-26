import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPayPalOrder } from '@/lib/paypal';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const bookingId = searchParams.get('booking_id');
    
    if (!bookingId) {
      return NextResponse.json(
        { error: 'Booking ID required' },
        { status: 400 }
      );
    }
    
    const supabase = await createClient();
    
    // Get booking with items
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        table_booking_items(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (error || !booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }
    
    // Check if booking requires payment
    if (booking.booking_type !== 'sunday_lunch' || booking.status !== 'pending_payment') {
      return NextResponse.json(
        { error: 'Booking does not require payment' },
        { status: 400 }
      );
    }
    
    // Check if payment already exists
    const { data: existingPayment } = await supabase
      .from('table_booking_payments')
      .select('*')
      .eq('booking_id', bookingId)
      .eq('status', 'completed')
      .single();
      
    if (existingPayment) {
      return NextResponse.json(
        { error: 'Payment already completed' },
        { status: 400 }
      );
    }
    
    // Create PayPal order
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const returnUrl = `${baseUrl}/api/table-bookings/payment/return?booking_id=${bookingId}`;
    const cancelUrl = `${baseUrl}/booking/${booking.booking_reference}?cancelled=true`;
    
    const { orderId, approveUrl } = await createPayPalOrder(
      booking,
      returnUrl,
      cancelUrl,
      true // depositOnly = true for Sunday lunch bookings
    );
    
    // Calculate amounts
    const totalAmount = booking.table_booking_items.reduce(
      (sum: number, item: any) => sum + (item.price_at_booking * item.quantity), 
      0
    );
    const depositAmount = booking.party_size * 5; // £5 per person
    
    // Store PayPal order ID with deposit information
    await supabase
      .from('table_booking_payments')
      .insert({
        booking_id: bookingId,
        payment_method: 'paypal',
        amount: depositAmount, // Only charge deposit
        currency: 'GBP',
        status: 'pending',
        payment_metadata: { 
          paypal_order_id: orderId,
          payment_type: 'deposit',
          total_amount: totalAmount,
          deposit_amount: depositAmount,
          outstanding_amount: totalAmount - depositAmount
        },
      });
    
    // Redirect to PayPal
    return NextResponse.redirect(approveUrl);
  } catch (error) {
    console.error('PayPal order creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create payment' },
      { status: 500 }
    );
  }
}