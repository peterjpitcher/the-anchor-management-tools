import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCustomerSchema() {
  try {
    // Try to query with email field
    const { data, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, email')
      .limit(1);
    
    if (error) {
      if (error.message.includes('column "email" does not exist')) {
        console.log('Email column does NOT exist in customers table');
      } else {
        console.log('Query error:', error.message);
      }
    } else {
      console.log('Email column EXISTS in customers table');
      console.log('Sample data:', data);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

checkCustomerSchema();