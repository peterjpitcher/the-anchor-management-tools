#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import path from 'path';
import { createAdminClient } from '../src/lib/supabase/server';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function findCustomerByPartialPhone() {
  const partialPhone = process.argv[2] || '7990587315';
  
  console.log(`🔍 Searching for customers with phone containing: ${partialPhone}\n`);
  
  const supabase = createAdminClient();
  
  // Search with LIKE pattern
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .ilike('mobile_number', `%${partialPhone}%`)
    .limit(10);
    
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log(`Found ${customers?.length || 0} customers:\n`);
  customers?.forEach(c => {
    console.log(`Name: ${c.first_name} ${c.last_name}`);
    console.log(`Phone: ${c.mobile_number}`);
    console.log(`ID: ${c.id}`);
    console.log('---');
  });
  
  if (customers && customers.length > 0) {
    console.log('\n📝 Phone number formats found:');
    const formats = [...new Set(customers.map(c => {
      const phone = c.mobile_number;
      if (phone.startsWith('+44')) return '+44 format';
      if (phone.startsWith('44')) return '44 format';
      if (phone.startsWith('0')) return '0 format';
      return 'Other format';
    }))];
    formats.forEach(f => console.log(`- ${f}`));
  }
}

findCustomerByPartialPhone().catch(console.error);