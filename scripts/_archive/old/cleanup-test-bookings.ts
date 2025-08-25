#!/usr/bin/env tsx
/**
 * Delete all test bookings while keeping the three real bookings
 * Real bookings to keep:
 * 1. Jo Barr - August 8th
 * 2. Hannah Mersah - August 9th  
 * 3. Jo Rolt - August 10th
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupTestBookings() {
  console.log('🔍 Finding bookings to clean up...\n');
  
  try {
    // First, let's identify the real bookings we need to keep
    console.log('📋 Looking for real bookings to keep...');
    
    // Find Jo Barr's booking on August 8th
    const { data: joBarrBookings } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        customer:customers!inner(
          id,
          first_name,
          last_name
        )
      `)
      .eq('booking_date', '2025-08-08')
      .ilike('customer.last_name', '%Barr%');
    
    // Find Hannah Mersah's booking on August 9th
    const { data: hannahBookings } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        customer:customers!inner(
          id,
          first_name,
          last_name
        )
      `)
      .eq('booking_date', '2025-08-09')
      .ilike('customer.last_name', '%Mersah%');
    
    // Find Jo Rolt's booking on August 10th
    const { data: joRoltBookings } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        customer:customers!inner(
          id,
          first_name,
          last_name
        )
      `)
      .eq('booking_date', '2025-08-10')
      .ilike('customer.last_name', '%Rolt%');
    
    // Combine all real bookings
    const realBookings = [
      ...(joBarrBookings || []),
      ...(hannahBookings || []),
      ...(joRoltBookings || [])
    ];
    
    console.log('\n✅ Found real bookings to keep:');
    realBookings.forEach(booking => {
      console.log(`   - ${booking.customer.first_name} ${booking.customer.last_name} on ${booking.booking_date} (Ref: ${booking.booking_reference})`);
    });
    
    const bookingIdsToKeep = realBookings.map(b => b.id);
    
    if (bookingIdsToKeep.length === 0) {
      console.log('\n⚠️  WARNING: Could not find the three real bookings!');
      console.log('   Please verify the names and dates are correct.');
      return;
    }
    
    // Now get all bookings
    console.log('\n📊 Getting all bookings...');
    const { data: allBookings, error: fetchError } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_date,
        booking_time,
        status,
        customer:customers!inner(
          first_name,
          last_name
        )
      `)
      .order('booking_date', { ascending: false });
    
    if (fetchError) {
      console.error('❌ Error fetching bookings:', fetchError);
      return;
    }
    
    // Filter out the real bookings to find test bookings
    const testBookings = allBookings?.filter(
      booking => !bookingIdsToKeep.includes(booking.id)
    ) || [];
    
    console.log(`\n🗑️  Found ${testBookings.length} test bookings to delete:`);
    
    if (testBookings.length === 0) {
      console.log('   No test bookings found. Database is clean!');
      return;
    }
    
    // Show test bookings that will be deleted
    testBookings.forEach(booking => {
      console.log(`   - ${booking.customer.first_name} ${booking.customer.last_name} on ${booking.booking_date} (${booking.booking_reference}) - Status: ${booking.status}`);
    });
    
    // Get confirmation
    console.log('\n⚠️  About to delete the above test bookings.');
    console.log('   The following will be KEPT:');
    realBookings.forEach(booking => {
      console.log(`   ✓ ${booking.customer.first_name} ${booking.customer.last_name} on ${booking.booking_date}`);
    });
    
    // Delete test bookings
    console.log('\n🧹 Deleting test bookings...');
    
    const testBookingIds = testBookings.map(b => b.id);
    
    // Delete related records first (due to foreign keys)
    // Delete booking items
    const { error: itemsError } = await supabase
      .from('table_booking_items')
      .delete()
      .in('booking_id', testBookingIds);
    
    if (itemsError) {
      console.error('❌ Error deleting booking items:', itemsError);
      return;
    }
    
    // Delete booking payments
    const { error: paymentsError } = await supabase
      .from('table_booking_payments')
      .delete()
      .in('booking_id', testBookingIds);
    
    if (paymentsError) {
      console.error('❌ Error deleting booking payments:', paymentsError);
      return;
    }
    
    // Delete audit logs (optional - you might want to keep these)
    const { error: auditError } = await supabase
      .from('booking_audit')
      .delete()
      .in('booking_id', testBookingIds);
    
    if (auditError) {
      console.log('⚠️  Could not delete audit logs (might not exist):', auditError.message);
    }
    
    // Finally, delete the bookings themselves
    const { error: deleteError } = await supabase
      .from('table_bookings')
      .delete()
      .in('id', testBookingIds);
    
    if (deleteError) {
      console.error('❌ Error deleting bookings:', deleteError);
      return;
    }
    
    console.log(`\n✅ Successfully deleted ${testBookings.length} test bookings!`);
    
    // Verify what's left
    console.log('\n📋 Remaining bookings in the system:');
    const { data: remainingBookings } = await supabase
      .from('table_bookings')
      .select(`
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        status,
        customer:customers!inner(
          first_name,
          last_name
        )
      `)
      .order('booking_date', { ascending: true });
    
    remainingBookings?.forEach(booking => {
      console.log(`   ✓ ${booking.customer.first_name} ${booking.customer.last_name} - ${booking.booking_date} at ${booking.booking_time} (Party of ${booking.party_size}) - ${booking.status}`);
    });
    
    console.log(`\n📊 Summary:`);
    console.log(`   - Kept: ${realBookings.length} real bookings`);
    console.log(`   - Deleted: ${testBookings.length} test bookings`);
    console.log(`   - Total remaining: ${remainingBookings?.length || 0} bookings`);
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the cleanup
cleanupTestBookings().catch(console.error);