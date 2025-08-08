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

async function diagnoseMenuItems() {
  console.log('🔍 Diagnosing Menu Items Storage Issue...\n');

  try {
    // Get a specific booking
    const bookingRef = 'TB-2025-5758';
    console.log(`📋 Checking booking: ${bookingRef}\n`);

    // Get the booking
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select('*')
      .eq('booking_reference', bookingRef)
      .single();

    if (bookingError || !booking) {
      console.error('❌ Booking not found:', bookingError);
      return;
    }

    console.log('✅ Booking found:');
    console.log(`   ID: ${booking.id}`);
    console.log(`   Date: ${booking.booking_date} at ${booking.booking_time}`);
    console.log(`   Party Size: ${booking.party_size}`);
    console.log(`   Status: ${booking.status}`);
    console.log(`   Type: ${booking.booking_type}`);

    // Get raw menu items
    const { data: items, error: itemsError } = await supabase
      .from('table_booking_items')
      .select('*')
      .eq('booking_id', booking.id);

    console.log('\n📦 Raw Menu Items from Database:');
    if (itemsError) {
      console.error('❌ Error fetching items:', itemsError);
      return;
    }

    if (!items || items.length === 0) {
      console.log('❌ No items found');
      return;
    }

    // Display each item's full data
    items.forEach((item, index) => {
      console.log(`\n   Item ${index + 1}:`);
      console.log(`   - ID: ${item.id}`);
      console.log(`   - Menu Item ID: ${item.menu_item_id || 'NULL'}`);
      console.log(`   - Custom Item Name: ${item.custom_item_name || 'NULL'}`);
      console.log(`   - Item Type: ${item.item_type}`);
      console.log(`   - Quantity: ${item.quantity}`);
      console.log(`   - Price at Booking: £${item.price_at_booking}`);
      console.log(`   - Guest Name: ${item.guest_name || 'NULL'}`);
      console.log(`   - Special Requests: ${item.special_requests || 'NULL'}`);
      console.log(`   - Created: ${item.created_at}`);
    });

    // Check if menu_item_ids match any Sunday lunch menu items
    console.log('\n🍽️  Checking Sunday Lunch Menu Items:');
    const menuItemIds = items.map(i => i.menu_item_id).filter(Boolean);
    
    if (menuItemIds.length > 0) {
      const { data: menuItems } = await supabase
        .from('sunday_lunch_menu_items')
        .select('*')
        .in('id', menuItemIds);

      if (menuItems && menuItems.length > 0) {
        console.log('\n✅ Found matching menu items:');
        menuItems.forEach(item => {
          console.log(`   - ${item.name} (${item.id})`);
          console.log(`     Category: ${item.category}`);
          console.log(`     Price: £${item.price}`);
          console.log(`     Active: ${item.is_active}`);
        });
      } else {
        console.log('❌ No matching menu items found in sunday_lunch_menu_items table');
      }
    }

    // Check the table structure
    console.log('\n🔧 Table Structure Check:');
    const { data: columns } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', 'table_booking_items');

    if (columns) {
      console.log('\n   table_booking_items columns:');
      columns.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
    }

    // Check constraints
    console.log('\n📏 Constraints:');
    const { data: constraints } = await supabase
      .from('information_schema.check_constraints')
      .select('constraint_name, check_clause')
      .eq('constraint_schema', 'public')
      .like('constraint_name', '%table_booking_items%');

    if (constraints) {
      constraints.forEach(constraint => {
        console.log(`   - ${constraint.constraint_name}: ${constraint.check_clause}`);
      });
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the diagnosis
diagnoseMenuItems();