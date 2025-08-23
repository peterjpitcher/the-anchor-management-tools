#!/usr/bin/env tsx
/**
 * Test script to verify employee creation saves to all required tables
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testEmployeeCreation() {
  console.log('🧪 Testing Employee Creation Flow\n');

  // Test employee data
  const testEmployee = {
    first_name: 'Test',
    last_name: 'Employee',
    email_address: `test.employee.${Date.now()}@example.com`,
    job_title: 'Test Position',
    employment_start_date: '2024-01-01',
    status: 'Active'
  };

  const testFinancials = {
    ni_number: 'AA123456A',
    bank_name: 'Test Bank',
    bank_sort_code: '12-34-56',
    bank_account_number: '12345678'
  };

  const testHealth = {
    doctor_name: 'Dr. Test',
    doctor_address: '123 Test Street',
    allergies: 'Test allergies',
    has_diabetes: true,
    has_epilepsy: false,
    is_registered_disabled: true,
    disability_reg_number: 'TEST123'
  };

  try {
    // 1. Create employee
    console.log('1️⃣ Creating employee...');
    const { data: employee, error: empError } = await supabase
      .from('employees')
      .insert(testEmployee)
      .select()
      .single();

    if (empError) {
      console.error('❌ Failed to create employee:', empError);
      return;
    }
    console.log('✅ Employee created:', employee.employee_id);

    // 2. Create financial details
    console.log('\n2️⃣ Creating financial details...');
    const { error: finError } = await supabase
      .from('employee_financial_details')
      .insert({ employee_id: employee.employee_id, ...testFinancials });

    if (finError) {
      console.error('❌ Failed to create financial details:', finError);
    } else {
      console.log('✅ Financial details created');
    }

    // 3. Create health record
    console.log('\n3️⃣ Creating health record...');
    const { error: healthError } = await supabase
      .from('employee_health_records')
      .insert({ employee_id: employee.employee_id, ...testHealth });

    if (healthError) {
      console.error('❌ Failed to create health record:', healthError);
    } else {
      console.log('✅ Health record created');
    }

    // 4. Verify all data was saved
    console.log('\n4️⃣ Verifying saved data...');
    
    const { data: savedFinancials } = await supabase
      .from('employee_financial_details')
      .select('*')
      .eq('employee_id', employee.employee_id)
      .single();

    const { data: savedHealth } = await supabase
      .from('employee_health_records')
      .select('*')
      .eq('employee_id', employee.employee_id)
      .single();

    console.log('\n✅ Verification Results:');
    console.log('- Employee:', employee.first_name, employee.last_name);
    console.log('- Financial NI:', savedFinancials?.ni_number);
    console.log('- Health Doctor:', savedHealth?.doctor_name);
    console.log('- Has Diabetes:', savedHealth?.has_diabetes);
    console.log('- Is Disabled:', savedHealth?.is_registered_disabled);

    // 5. Cleanup
    console.log('\n5️⃣ Cleaning up test data...');
    await supabase.from('employees').delete().eq('employee_id', employee.employee_id);
    console.log('✅ Test data cleaned up');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testEmployeeCreation().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
});