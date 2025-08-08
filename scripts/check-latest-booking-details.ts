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

async function checkLatestBookingDetails() {
  console.log('🔍 Checking Latest Sunday Lunch Booking Details...\n');

  try {
    // Get the most recent Sunday lunch booking
    const { data: latestBooking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        status,
        booking_type,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number
        )
      `)
      .eq('booking_type', 'sunday_lunch')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (bookingError || !latestBooking) {
      console.error('❌ No Sunday lunch bookings found:', bookingError);
      return;
    }

    console.log('📋 Latest Sunday Lunch Booking:');
    console.log(`   Reference: ${latestBooking.booking_reference}`);
    console.log(`   Created: ${new Date(latestBooking.created_at).toLocaleString()}`);
    console.log(`   Customer: ${latestBooking.customer?.first_name} ${latestBooking.customer?.last_name}`);
    console.log(`   Date: ${latestBooking.booking_date} at ${latestBooking.booking_time}`);
    console.log(`   Party Size: ${latestBooking.party_size}`);
    console.log(`   Status: ${latestBooking.status}`);

    console.log('\n📦 Order Details (from table_booking_items table):');
    console.log('==================================================');

    // Get menu items for this booking
    const { data: items, error: itemsError } = await supabase
      .from('table_booking_items')
      .select('*')
      .eq('booking_id', latestBooking.id)
      .order('created_at');

    if (itemsError) {
      console.error('❌ Error fetching items:', itemsError);
      return;
    }

    if (!items || items.length === 0) {
      console.log('❌ NO MENU ITEMS FOUND IN DATABASE');
      console.log('\n⚠️  This means the order details were not saved properly.');
      return;
    }

    console.log(`\n✅ Found ${items.length} items in the order:\n`);

    let totalAmount = 0;
    items.forEach((item, index) => {
      const itemTotal = item.price_at_booking * item.quantity;
      totalAmount += itemTotal;
      
      console.log(`Item ${index + 1}:`);
      console.log(`   Database ID: ${item.id}`);
      console.log(`   Menu Item ID: ${item.menu_item_id || 'NULL'}`);
      console.log(`   Custom Item Name: ${item.custom_item_name || 'NULL'} ${!item.custom_item_name ? '⚠️' : '✅'}`);
      console.log(`   Item Type: ${item.item_type}`);
      console.log(`   Quantity: ${item.quantity}`);
      console.log(`   Price: £${item.price_at_booking} each`);
      console.log(`   Subtotal: £${itemTotal.toFixed(2)}`);
      console.log(`   Guest Name: ${item.guest_name || 'Not specified'}`);
      console.log(`   Special Requests: ${item.special_requests || 'None'}`);
      console.log(`   Created: ${new Date(item.created_at).toLocaleString()}`);
      console.log('');
    });

    console.log(`💷 Total Order Value: £${totalAmount.toFixed(2)}`);
    console.log(`💰 Deposit Required: £${(latestBooking.party_size * 5).toFixed(2)}`);

    // If menu_item_id exists, look up the actual menu item
    const menuItemIds = items.map(i => i.menu_item_id).filter(Boolean);
    if (menuItemIds.length > 0) {
      console.log('\n🍽️  Looking up menu items from sunday_lunch_menu_items:');
      const { data: menuItems } = await supabase
        .from('sunday_lunch_menu_items')
        .select('id, name, category, price')
        .in('id', menuItemIds);

      if (menuItems) {
        menuItems.forEach(item => {
          console.log(`   - ${item.name} (${item.category}) - £${item.price}`);
        });
      }
    }

    // Check if this booking has a payment record
    const { data: payments } = await supabase
      .from('table_booking_payments')
      .select('*')
      .eq('booking_id', latestBooking.id);

    if (payments && payments.length > 0) {
      console.log('\n💳 Payment Records:');
      payments.forEach(payment => {
        console.log(`   - Amount: £${payment.amount}`);
        console.log(`     Status: ${payment.status}`);
        console.log(`     Method: ${payment.payment_method}`);
        if (payment.transaction_id) {
          console.log(`     Transaction ID: ${payment.transaction_id}`);
        }
      });
    }

    console.log('\n📍 Database Location Summary:');
    console.log('   Main booking record: table_bookings');
    console.log('   Order details: table_booking_items');
    console.log('   Payment info: table_booking_payments');
    console.log('   Customer info: customers');
    
    console.log('\n🔍 To view in Supabase Dashboard:');
    console.log('   1. Go to Table Editor');
    console.log('   2. Select "table_booking_items" table');
    console.log(`   3. Filter by booking_id = '${latestBooking.id}'`);

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the check
checkLatestBookingDetails();