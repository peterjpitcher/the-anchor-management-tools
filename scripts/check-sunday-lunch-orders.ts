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

async function checkSundayLunchOrders() {
  console.log('🔍 Checking Sunday Lunch Orders and Menu Items...\n');

  try {
    // 1. Get all Sunday lunch bookings
    const { data: bookings, error: bookingsError } = await supabase
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
      .order('created_at', { ascending: false })
      .limit(10);

    if (bookingsError) {
      console.error('❌ Error fetching bookings:', bookingsError);
      return;
    }

    console.log(`📋 Found ${bookings?.length || 0} Sunday Lunch bookings\n`);

    // 2. For each booking, check if there are menu items
    for (const booking of bookings || []) {
      console.log(`\n📌 Booking: ${booking.booking_reference}`);
      console.log(`   Date: ${booking.booking_date} at ${booking.booking_time}`);
      console.log(`   Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
      console.log(`   Party Size: ${booking.party_size}`);
      console.log(`   Status: ${booking.status}`);

      // Get menu items for this booking
      const { data: items, error: itemsError } = await supabase
        .from('table_booking_items')
        .select('*')
        .eq('booking_id', booking.id);

      if (itemsError) {
        console.error(`   ❌ Error fetching items:`, itemsError);
        continue;
      }

      if (!items || items.length === 0) {
        console.log(`   ⚠️  NO MENU ITEMS FOUND`);
        continue;
      }

      console.log(`   ✅ Menu Items (${items.length}):`);
      let totalAmount = 0;
      for (const item of items) {
        const itemTotal = item.price_at_booking * item.quantity;
        totalAmount += itemTotal;
        console.log(`      - ${item.quantity}x ${item.custom_item_name || item.menu_item_id || 'Unknown Item'}`);
        console.log(`        Type: ${item.item_type}`);
        console.log(`        Price: £${item.price_at_booking} each (£${itemTotal.toFixed(2)} total)`);
        if (item.guest_name) console.log(`        For: ${item.guest_name}`);
        if (item.special_requests) console.log(`        Note: ${item.special_requests}`);
      }
      console.log(`   💷 Total Order Value: £${totalAmount.toFixed(2)}`);

      // Check for payment
      const { data: payments } = await supabase
        .from('table_booking_payments')
        .select('amount, status, transaction_id')
        .eq('booking_id', booking.id);

      if (payments && payments.length > 0) {
        console.log(`   💳 Payments:`);
        for (const payment of payments) {
          console.log(`      - £${payment.amount} (${payment.status})`);
          if (payment.transaction_id) console.log(`        Transaction: ${payment.transaction_id}`);
        }
      }
    }

    console.log('\n\n📊 Summary of Issues Found:');
    
    // Check for bookings without items
    const { data: bookingsWithoutItems } = await supabase
      .from('table_bookings')
      .select('id, booking_reference')
      .eq('booking_type', 'sunday_lunch')
      .not('id', 'in', `(
        SELECT DISTINCT booking_id 
        FROM table_booking_items
      )`);

    if (bookingsWithoutItems && bookingsWithoutItems.length > 0) {
      console.log(`\n⚠️  ${bookingsWithoutItems.length} Sunday Lunch bookings have NO menu items:`);
      for (const booking of bookingsWithoutItems) {
        console.log(`   - ${booking.booking_reference}`);
      }
    } else {
      console.log('\n✅ All Sunday Lunch bookings have menu items');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the check
checkSundayLunchOrders();