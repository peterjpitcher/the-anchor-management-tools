#!/usr/bin/env tsx
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function fixPendingPayment(bookingReference: string) {
  console.log(`🔧 Fixing Payment for Booking: ${bookingReference}\n`);
  console.log('=' .repeat(60));
  
  try {
    // Get the booking
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*)
      `)
      .eq('booking_reference', bookingReference)
      .single();

    if (bookingError || !booking) {
      console.error('❌ Booking not found:', bookingReference);
      return;
    }

    console.log('📌 Booking Details:');
    console.log(`   Reference: ${booking.booking_reference}`);
    console.log(`   Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
    console.log(`   Current Status: ${booking.status}`);
    console.log(`   Date: ${booking.booking_date} at ${booking.booking_time}`);

    // Get payment record
    const { data: payment } = await supabase
      .from('table_booking_payments')
      .select('*')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!payment) {
      console.error('❌ No payment record found for this booking');
      return;
    }

    console.log('\n💳 Payment Record:');
    console.log(`   Status: ${payment.status}`);
    console.log(`   Amount: £${payment.amount}`);
    console.log(`   PayPal Order ID: ${payment.payment_metadata?.paypal_order_id || payment.transaction_id}`);

    if (booking.status === 'confirmed' && payment.status === 'completed') {
      console.log('\n✅ Booking is already confirmed and payment is completed');
      return;
    }

    console.log('\n🔄 Fixing booking and payment status...');

    // Update payment to completed
    const { error: paymentUpdateError } = await supabase
      .from('table_booking_payments')
      .update({
        status: 'completed',
        paid_at: new Date().toISOString(),
        payment_metadata: {
          ...payment.payment_metadata,
          manually_confirmed: true,
          confirmed_at: new Date().toISOString(),
          confirmed_reason: 'Manual fix - payment completed on PayPal'
        }
      })
      .eq('id', payment.id);

    if (paymentUpdateError) {
      console.error('❌ Failed to update payment:', paymentUpdateError);
      return;
    }

    console.log('   ✅ Payment marked as completed');

    // Update booking to confirmed
    const { error: bookingUpdateError } = await supabase
      .from('table_bookings')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString()
      })
      .eq('id', booking.id);

    if (bookingUpdateError) {
      console.error('❌ Failed to update booking:', bookingUpdateError);
      return;
    }

    console.log('   ✅ Booking marked as confirmed');

    // Add audit log
    const { error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        action: 'payment_confirmed',
        entity_type: 'table_booking',
        entity_id: booking.id,
        metadata: {
          booking_reference: booking.booking_reference,
          transaction_id: payment.transaction_id,
          amount: payment.amount,
          source: 'manual_fix',
          reason: 'Payment completed on PayPal but return handler failed'
        }
      });

    if (!auditError) {
      console.log('   ✅ Audit log created');
    }

    console.log('\n✅ Successfully fixed booking and payment!');
    console.log('   The customer should receive confirmation shortly.');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Check if booking reference was provided as argument
const bookingRef = process.argv[2];

if (!bookingRef) {
  console.log('Usage: tsx scripts/fix-pending-payment.ts <booking-reference>');
  console.log('Example: tsx scripts/fix-pending-payment.ts TB-2025-0634');
} else {
  fixPendingPayment(bookingRef);
}