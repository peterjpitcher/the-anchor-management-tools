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

async function checkRecentPayments() {
  console.log('🔍 Checking Recent Payment Attempts\n');
  console.log('=' .repeat(60));
  
  try {
    // Get recent bookings with pending_payment status
    const { data: pendingBookings, error: bookingsError } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        status,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number
        )
      `)
      .eq('booking_type', 'sunday_lunch')
      .in('status', ['pending_payment', 'confirmed'])
      .order('created_at', { ascending: false })
      .limit(5);

    if (bookingsError) {
      console.error('❌ Error fetching bookings:', bookingsError);
      return;
    }

    console.log(`📋 Recent Sunday Lunch Bookings:\n`);

    for (const booking of pendingBookings || []) {
      console.log(`\n📌 Booking: ${booking.booking_reference}`);
      console.log(`   Created: ${new Date(booking.created_at).toLocaleString()}`);
      console.log(`   Date: ${booking.booking_date} at ${booking.booking_time}`);
      console.log(`   Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
      console.log(`   Status: ${booking.status === 'confirmed' ? '✅' : '⏳'} ${booking.status}`);

      // Check for payments
      const { data: payments, error: paymentsError } = await supabase
        .from('table_booking_payments')
        .select('*')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: false });

      if (payments && payments.length > 0) {
        console.log(`\n   💳 Payment Records:`);
        for (const payment of payments) {
          console.log(`      - Status: ${payment.status}`);
          console.log(`        Amount: £${payment.amount}`);
          console.log(`        Created: ${new Date(payment.created_at).toLocaleString()}`);
          if (payment.transaction_id) {
            console.log(`        Transaction ID: ${payment.transaction_id}`);
          }
          if (payment.paid_at) {
            console.log(`        Paid At: ${new Date(payment.paid_at).toLocaleString()}`);
          }
          if (payment.payment_metadata?.paypal_order_id) {
            console.log(`        PayPal Order: ${payment.payment_metadata.paypal_order_id}`);
          }
          if (payment.payment_metadata?.error) {
            console.log(`        ❌ Error: ${payment.payment_metadata.error}`);
          }
        }
      } else {
        console.log(`   ⚠️  No payment records found`);
      }

      // Check for audit logs
      const { data: auditLogs } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_type', 'table_booking')
        .eq('entity_id', booking.id)
        .eq('action', 'payment_confirmed')
        .limit(1);

      if (auditLogs && auditLogs.length > 0) {
        console.log(`   ✅ Payment confirmed in audit log at ${new Date(auditLogs[0].created_at).toLocaleString()}`);
      }
    }

    // Check for orphaned payments (payments without matching bookings)
    console.log('\n\n🔍 Checking for Orphaned Payment Records:\n');
    
    const { data: recentPayments } = await supabase
      .from('table_booking_payments')
      .select(`
        *,
        table_bookings(
          booking_reference,
          status
        )
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    let orphanedCount = 0;
    for (const payment of recentPayments || []) {
      if (!payment.table_bookings) {
        orphanedCount++;
        console.log(`   ⚠️ Orphaned payment: ${payment.id}`);
        console.log(`      Amount: £${payment.amount}`);
        console.log(`      Status: ${payment.status}`);
        console.log(`      Created: ${new Date(payment.created_at).toLocaleString()}`);
      }
    }

    if (orphanedCount === 0) {
      console.log('   ✅ No orphaned payments found');
    }

    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('\n📊 Summary:');
    const pendingCount = pendingBookings?.filter(b => b.status === 'pending_payment').length || 0;
    const confirmedCount = pendingBookings?.filter(b => b.status === 'confirmed').length || 0;
    
    console.log(`   - ${pendingCount} bookings awaiting payment`);
    console.log(`   - ${confirmedCount} bookings confirmed`);
    console.log(`   - ${orphanedCount} orphaned payment records`);
    
    if (pendingCount > 0) {
      console.log(`\n⚠️  Action Required: ${pendingCount} bookings may have completed payment but not been confirmed`);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the check
checkRecentPayments();