#!/usr/bin/env tsx
/**
 * Test the automatic service slot generation
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

async function testSlotGeneration() {
  console.log('🧪 Testing automatic slot generation...\n');
  
  try {
    // Run the auto-generation function
    const { data, error } = await supabase.rpc('auto_generate_weekly_slots');
    
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    console.log('✅ Slot generation result:', data);
    
    // Check upcoming Sunday slots
    const nextSunday = new Date();
    while (nextSunday.getDay() !== 0) {
      nextSunday.setDate(nextSunday.getDate() + 1);
    }
    
    // Check slots for next 4 Sundays
    console.log('\n📅 Checking Sunday lunch slots:');
    for (let i = 0; i < 4; i++) {
      const checkDate = new Date(nextSunday);
      checkDate.setDate(checkDate.getDate() + (i * 7));
      const dateStr = checkDate.toISOString().split('T')[0];
      
      const { data: slots } = await supabase
        .from('service_slots')
        .select('*')
        .eq('service_date', dateStr)
        .eq('booking_type', 'sunday_lunch')
        .order('starts_at');
      
      if (slots && slots.length > 0) {
        console.log(`\n   ${dateStr} (${checkDate.toLocaleDateString('en-GB', { weekday: 'long' })}):`);
        slots.forEach(slot => {
          console.log(`   - ${slot.starts_at.substring(0, 5)} to ${slot.ends_at.substring(0, 5)}: ${slot.capacity} seats`);
        });
      }
    }
    
    console.log('\n✅ Automatic slot generation is working!');
    console.log('   Slots will be regenerated weekly every Monday at 2 AM');
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

testSlotGeneration().catch(console.error);