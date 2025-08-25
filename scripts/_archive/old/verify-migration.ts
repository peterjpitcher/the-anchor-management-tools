#!/usr/bin/env tsx
/**
 * Verify Sunday Lunch API migration was successful
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

async function verifyMigration() {
  console.log('🔍 Verifying Sunday Lunch API migration...\n');
  
  const tests = [
    {
      name: 'Idempotency Keys Table',
      test: async () => {
        const { error } = await supabase
          .from('idempotency_keys')
          .select('*')
          .limit(1);
        return !error;
      }
    },
    {
      name: 'Booking Audit Table',
      test: async () => {
        const { error } = await supabase
          .from('booking_audit')
          .select('*')
          .limit(1);
        return !error;
      }
    },
    {
      name: 'Service Slots Table',
      test: async () => {
        const { error } = await supabase
          .from('service_slots')
          .select('*')
          .limit(1);
        return !error;
      }
    },
    {
      name: 'Capacity Check Function',
      test: async () => {
        const { error } = await supabase.rpc('check_and_reserve_capacity', {
          p_service_date: '2025-08-17',
          p_booking_time: '13:00',
          p_party_size: 2,
          p_booking_type: 'sunday_lunch'
        });
        // Function might return no data but shouldn't error
        return !error || error.message.includes('No service slot');
      }
    },
    {
      name: 'Correlation ID Column',
      test: async () => {
        const { data, error } = await supabase
          .from('table_bookings')
          .select('correlation_id')
          .limit(1);
        return !error;
      }
    },
    {
      name: 'Mobile E164 Column',
      test: async () => {
        const { data, error } = await supabase
          .from('customers')
          .select('mobile_e164')
          .limit(1);
        return !error;
      }
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const { name, test } of tests) {
    try {
      const result = await test();
      if (result) {
        console.log(`✅ ${name}`);
        passed++;
      } else {
        console.log(`❌ ${name}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n📊 Results:');
  console.log(`   Passed: ${passed}/${tests.length}`);
  console.log(`   Failed: ${failed}/${tests.length}`);
  
  if (failed === 0) {
    console.log('\n🎉 Migration verified successfully!');
    console.log('   All tables and functions are accessible.');
  } else {
    console.log('\n⚠️  Some migration components could not be verified.');
    console.log('   This might be normal if the tables are empty.');
  }
}

verifyMigration().catch(console.error);