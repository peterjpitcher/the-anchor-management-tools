#!/usr/bin/env tsx
/**
 * Setup service slots for table bookings
 * This is required for the new capacity management system
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

async function setupServiceSlots() {
  console.log('🔧 Setting up service slots for capacity management...\n');
  
  try {
    // First, check if any slots exist
    const { data: existingSlots, error: checkError } = await supabase
      .from('service_slots')
      .select('*')
      .limit(5);
    
    if (checkError) {
      console.error('❌ Error checking existing slots:', checkError);
      return;
    }
    
    if (existingSlots && existingSlots.length > 0) {
      console.log('ℹ️  Service slots already exist:');
      existingSlots.forEach(slot => {
        console.log(`   - ${slot.service_date} ${slot.starts_at}-${slot.ends_at} (${slot.booking_type}): ${slot.capacity} seats`);
      });
      console.log('\n');
    }
    
    // Create service slots for the next 3 months
    const slotsToCreate = [];
    const startDate = new Date('2025-08-01'); // Start from August
    const endDate = new Date('2025-11-30'); // Through November
    
    // For each date in range
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      const dayOfWeek = date.getDay();
      const dateStr = date.toISOString().split('T')[0];
      
      // Sunday lunch slots (Sunday = 0)
      if (dayOfWeek === 0) {
        // Multiple time slots for Sunday lunch
        slotsToCreate.push(
          {
            service_date: dateStr,
            starts_at: '12:00:00',
            ends_at: '14:30:00',
            capacity: 50, // Restaurant capacity
            booking_type: 'sunday_lunch',
            is_active: true
          },
          {
            service_date: dateStr,
            starts_at: '14:30:00',
            ends_at: '17:00:00',
            capacity: 50,
            booking_type: 'sunday_lunch',
            is_active: true
          }
        );
      }
      
      // Regular dinner service (Tuesday to Saturday)
      if (dayOfWeek >= 2 && dayOfWeek <= 6) {
        slotsToCreate.push(
          {
            service_date: dateStr,
            starts_at: '17:00:00',
            ends_at: '21:00:00',
            capacity: 50,
            booking_type: 'regular',
            is_active: true
          }
        );
      }
      
      // Friday and Saturday lunch
      if (dayOfWeek === 5 || dayOfWeek === 6) {
        slotsToCreate.push(
          {
            service_date: dateStr,
            starts_at: '12:00:00',
            ends_at: '14:30:00',
            capacity: 50,
            booking_type: 'regular',
            is_active: true
          }
        );
      }
    }
    
    console.log(`📅 Creating ${slotsToCreate.length} service slots...`);
    
    // Insert in batches to avoid overwhelming the database
    const batchSize = 50;
    for (let i = 0; i < slotsToCreate.length; i += batchSize) {
      const batch = slotsToCreate.slice(i, i + batchSize);
      
      const { error: insertError } = await supabase
        .from('service_slots')
        .upsert(batch, {
          onConflict: 'service_date,starts_at,booking_type',
          ignoreDuplicates: true
        });
      
      if (insertError) {
        console.error('❌ Error inserting batch:', insertError);
        return;
      }
      
      console.log(`   ✓ Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(slotsToCreate.length / batchSize)}`);
    }
    
    // Verify Sunday lunch slots specifically
    console.log('\n🍽️  Verifying Sunday lunch slots...');
    
    const nextSunday = new Date();
    while (nextSunday.getDay() !== 0) {
      nextSunday.setDate(nextSunday.getDate() + 1);
    }
    const nextSundayStr = nextSunday.toISOString().split('T')[0];
    
    const { data: sundaySlots } = await supabase
      .from('service_slots')
      .select('*')
      .eq('service_date', nextSundayStr)
      .eq('booking_type', 'sunday_lunch')
      .order('starts_at');
    
    if (sundaySlots && sundaySlots.length > 0) {
      console.log(`\n✅ Sunday lunch slots for ${nextSundayStr}:`);
      sundaySlots.forEach(slot => {
        console.log(`   - ${slot.starts_at.substring(0, 5)} to ${slot.ends_at.substring(0, 5)}: ${slot.capacity} seats available`);
      });
    } else {
      console.log(`\n⚠️  No Sunday lunch slots found for ${nextSundayStr}`);
    }
    
    // Test the capacity check function
    console.log('\n🧪 Testing capacity check for Sunday lunch...');
    
    const { data: capacityTest, error: capacityError } = await supabase.rpc(
      'check_and_reserve_capacity',
      {
        p_service_date: '2025-08-17',
        p_booking_time: '13:00',
        p_party_size: 2,
        p_booking_type: 'sunday_lunch',
        p_duration_minutes: 120
      }
    );
    
    if (capacityError) {
      console.log('❌ Capacity check error:', capacityError.message);
    } else if (capacityTest && capacityTest[0]) {
      const result = capacityTest[0];
      console.log(`   Available: ${result.available}`);
      console.log(`   Available capacity: ${result.available_capacity} seats`);
      console.log(`   Message: ${result.message}`);
    }
    
    console.log('\n✅ Service slots setup complete!');
    console.log('   The API should now accept bookings with proper capacity management.');
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the setup
setupServiceSlots().catch(console.error);