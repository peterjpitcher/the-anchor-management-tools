#!/usr/bin/env tsx

/**
 * Diagnose Table Booking Database Error
 * 
 * This script checks for common issues that could cause the DATABASE_ERROR
 * when creating table bookings.
 */

import { createAdminClient } from '@/lib/supabase/server';

async function diagnoseTableBookingError() {
  console.log('🔍 Diagnosing Table Booking Database Error');
  console.log('========================================\n');

  try {
    const supabase = await createAdminClient();
    
    // 1. Check if customers table has email column
    console.log('1️⃣ Checking customers table structure...');
    const { data: columns, error: columnsError } = await supabase
      .rpc('get_table_columns', { table_name: 'customers' });
    
    if (columnsError) {
      // Try alternative method
      const { data: customerSample, error: sampleError } = await supabase
        .from('customers')
        .select('*')
        .limit(1);
      
      if (!sampleError && customerSample && customerSample.length > 0) {
        const columnNames = Object.keys(customerSample[0]);
        console.log('✅ Customers table columns:', columnNames);
        console.log(`❓ Has email column: ${columnNames.includes('email') ? 'YES' : 'NO'}`);
      } else {
        console.log('❌ Could not fetch customers table structure');
      }
    } else {
      console.log('✅ Customers table columns:', columns);
    }
    
    // 2. Check if table_bookings table exists
    console.log('\n2️⃣ Checking table_bookings table...');
    const { count: bookingsCount, error: bookingsError } = await supabase
      .from('table_bookings')
      .select('*', { count: 'exact', head: true });
    
    if (bookingsError) {
      console.log('❌ Error accessing table_bookings:', bookingsError.message);
    } else {
      console.log('✅ table_bookings table exists with', bookingsCount, 'records');
    }
    
    // 3. Check if the new capacity function exists
    console.log('\n3️⃣ Checking for capacity-based function...');
    const { data: functions, error: funcError } = await supabase
      .rpc('get_function_info', { function_name: 'check_table_availability' })
      .single();
    
    if (funcError) {
      // Try to check if function exists by calling it
      const testDate = new Date().toISOString().split('T')[0];
      const { error: callError } = await supabase
        .rpc('check_table_availability', {
          p_date: testDate,
          p_time: '18:00',
          p_party_size: 2,
          p_duration: 120
        });
      
      if (callError) {
        console.log('❌ Function check_table_availability not found or error:', callError.message);
      } else {
        console.log('✅ Function check_table_availability exists and is callable');
      }
    } else {
      console.log('✅ Function check_table_availability found');
    }
    
    // 4. Check system_settings table
    console.log('\n4️⃣ Checking system_settings table...');
    const { data: settings, error: settingsError } = await supabase
      .from('system_settings')
      .select('*')
      .eq('key', 'restaurant_capacity')
      .single();
    
    if (settingsError) {
      if (settingsError.code === 'PGRST116') {
        console.log('❌ system_settings table does not exist');
        console.log('   → Migration needs to be applied!');
      } else {
        console.log('❌ Error accessing system_settings:', settingsError.message);
      }
    } else {
      console.log('✅ system_settings table exists');
      if (settings) {
        console.log('   Restaurant capacity:', settings.value);
      }
    }
    
    // 5. Test customer creation
    console.log('\n5️⃣ Testing customer creation...');
    const testCustomer = {
      first_name: 'Test',
      last_name: 'Customer',
      mobile_number: '+447700900999',
      sms_opt_in: false,
      email: 'test@example.com' // This might fail if column doesn't exist
    };
    
    // First try with email
    const { error: customerError1 } = await supabase
      .from('customers')
      .insert(testCustomer)
      .select()
      .single();
    
    if (customerError1) {
      console.log('❌ Customer creation with email failed:', customerError1.message);
      
      // Try without email
      const { email, ...customerWithoutEmail } = testCustomer;
      const { error: customerError2 } = await supabase
        .from('customers')
        .insert(customerWithoutEmail)
        .select()
        .single();
      
      if (customerError2) {
        console.log('❌ Customer creation without email also failed:', customerError2.message);
      } else {
        console.log('⚠️  Customer creation works WITHOUT email field');
        console.log('   → The customers table likely doesn\'t have an email column');
        
        // Clean up test customer
        await supabase
          .from('customers')
          .delete()
          .eq('mobile_number', testCustomer.mobile_number);
      }
    } else {
      console.log('✅ Customer creation with email works');
      // Clean up test customer
      await supabase
        .from('customers')
        .delete()
        .eq('mobile_number', testCustomer.mobile_number);
    }
    
    // 6. Check for table-related tables (old system)
    console.log('\n6️⃣ Checking for old table system...');
    const tableRelatedTables = ['tables', 'table_combinations', 'restaurant_tables'];
    
    for (const tableName of tableRelatedTables) {
      const { error } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`✅ ${tableName} table does not exist (good - using capacity system)`);
        } else {
          console.log(`❓ ${tableName} - Error: ${error.message}`);
        }
      } else {
        console.log(`⚠️  ${tableName} table exists (old system remnant?)`);
      }
    }
    
    // Summary
    console.log('\n📊 DIAGNOSIS SUMMARY');
    console.log('===================');
    console.log('\n🔴 Most likely issue:');
    console.log('The database migration for capacity-based booking has not been applied.');
    console.log('\n💡 Solution:');
    console.log('1. Run: supabase db push');
    console.log('2. This will apply migration: 20250725122348_update_table_booking_capacity_system.sql');
    console.log('\n⚠️  Additional issues:');
    console.log('- The customers table might not have an email column');
    console.log('- Consider removing email from the booking payload or adding the column');
    
  } catch (error) {
    console.error('❌ Unexpected error during diagnosis:', error);
  }
}

// Helper RPC function definitions (in case they don't exist)
const helperFunctions = `
-- Add these functions if they don't exist:

CREATE OR REPLACE FUNCTION get_table_columns(table_name text)
RETURNS TABLE(column_name text, data_type text) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.column_name::text,
    c.data_type::text
  FROM information_schema.columns c
  WHERE c.table_name = $1
    AND c.table_schema = 'public'
  ORDER BY c.ordinal_position;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_function_info(function_name text)
RETURNS TABLE(name text, return_type text) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.proname::text as name,
    pg_get_function_result(p.oid)::text as return_type
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = $1
    AND n.nspname = 'public';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
`;

console.log('\n📝 Note: If some checks fail, you might need to add helper functions:');
console.log(helperFunctions);

// Run the diagnosis
diagnoseTableBookingError()
  .then(() => {
    console.log('\n✅ Diagnosis complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Diagnosis failed:', error);
    process.exit(1);
  });