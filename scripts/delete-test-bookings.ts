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

async function deleteBooking(bookingReference: string) {
  console.log(`🗑️  Deleting Booking: ${bookingReference}\n`);
  console.log('=' .repeat(60));
  
  try {
    // Get the booking first
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        table_booking_items(*),
        table_booking_payments(*)
      `)
      .eq('booking_reference', bookingReference)
      .single();

    if (bookingError || !booking) {
      console.error('❌ Booking not found:', bookingReference);
      return;
    }

    console.log('📌 Booking Details:');
    console.log(`   Reference: ${booking.booking_reference}`);
    console.log(`   Date: ${booking.booking_date} at ${booking.booking_time}`);
    console.log(`   Status: ${booking.status}`);
    console.log(`   Menu Items: ${booking.table_booking_items?.length || 0}`);
    console.log(`   Payments: ${booking.table_booking_payments?.length || 0}`);
    
    // Safety check
    if (booking.status === 'confirmed' && booking.table_booking_payments?.some(p => p.status === 'completed')) {
      console.log('\n⚠️  WARNING: This is a CONFIRMED booking with COMPLETED payment!');
      console.log('Are you sure you want to delete it? This action cannot be undone.');
      console.log('To force delete, run with --force flag');
      
      if (!process.argv.includes('--force')) {
        console.log('\n❌ Deletion cancelled. Use --force to override.');
        return;
      }
    }

    console.log('\n🔄 Deleting related records...');

    // Delete in correct order due to foreign key constraints
    
    // 1. Delete payment records
    if (booking.table_booking_payments?.length > 0) {
      const { error: paymentError } = await supabase
        .from('table_booking_payments')
        .delete()
        .eq('booking_id', booking.id);
      
      if (paymentError) {
        console.error('❌ Failed to delete payments:', paymentError);
        return;
      }
      console.log(`   ✅ Deleted ${booking.table_booking_payments.length} payment record(s)`);
    }

    // 2. Delete menu items
    if (booking.table_booking_items?.length > 0) {
      const { error: itemsError } = await supabase
        .from('table_booking_items')
        .delete()
        .eq('booking_id', booking.id);
      
      if (itemsError) {
        console.error('❌ Failed to delete menu items:', itemsError);
        return;
      }
      console.log(`   ✅ Deleted ${booking.table_booking_items.length} menu item(s)`);
    }

    // 3. Delete any SMS jobs related to this booking
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id')
      .or(`payload->booking_id.eq.${booking.id},payload->variables->reference.eq.${bookingReference}`);
    
    if (jobs && jobs.length > 0) {
      const { error: jobsError } = await supabase
        .from('jobs')
        .delete()
        .in('id', jobs.map(j => j.id));
      
      if (!jobsError) {
        console.log(`   ✅ Deleted ${jobs.length} SMS job(s)`);
      }
    }

    // 4. Delete the booking itself
    const { error: deleteError } = await supabase
      .from('table_bookings')
      .delete()
      .eq('id', booking.id);
    
    if (deleteError) {
      console.error('❌ Failed to delete booking:', deleteError);
      return;
    }
    
    console.log(`   ✅ Deleted booking ${booking.booking_reference}`);

    // 5. Add audit log
    await supabase
      .from('audit_logs')
      .insert({
        action: 'delete',
        entity_type: 'table_booking',
        entity_id: booking.id,
        metadata: {
          booking_reference: booking.booking_reference,
          reason: 'Manual deletion via script',
          deleted_at: new Date().toISOString()
        }
      });
    
    console.log(`   ✅ Audit log created`);

    console.log('\n✅ Successfully deleted booking and all related records!');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

async function listTestBookings() {
  console.log('📋 Recent Test Bookings:\n');
  
  const { data: bookings } = await supabase
    .from('table_bookings')
    .select(`
      booking_reference,
      booking_date,
      booking_time,
      status,
      created_at,
      source,
      customer:customers(first_name, last_name)
    `)
    .or('source.eq.api_test,source.eq.phone,special_requirements.ilike.%test%')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!bookings || bookings.length === 0) {
    console.log('No test bookings found');
    return;
  }

  for (const booking of bookings) {
    console.log(`${booking.booking_reference} - ${booking.customer?.first_name} ${booking.customer?.last_name}`);
    console.log(`   Date: ${booking.booking_date} at ${booking.booking_time}`);
    console.log(`   Status: ${booking.status}`);
    console.log(`   Source: ${booking.source}`);
    console.log(`   Created: ${new Date(booking.created_at).toLocaleString()}`);
    console.log('');
  }
}

// Main execution
const command = process.argv[2];
const bookingRef = process.argv[3];

if (command === 'list') {
  listTestBookings();
} else if (command === 'delete' && bookingRef) {
  deleteBooking(bookingRef);
} else {
  console.log('Usage:');
  console.log('  List test bookings:    tsx scripts/delete-test-bookings.ts list');
  console.log('  Delete a booking:      tsx scripts/delete-test-bookings.ts delete <booking-reference>');
  console.log('  Force delete:          tsx scripts/delete-test-bookings.ts delete <booking-reference> --force');
  console.log('');
  console.log('Example:');
  console.log('  tsx scripts/delete-test-bookings.ts delete TB-2025-2205');
  console.log('  tsx scripts/delete-test-bookings.ts delete TB-2025-2205 --force');
}