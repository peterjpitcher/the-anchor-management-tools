import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Checking configuration...');
console.log('URL:', supabaseUrl ? 'Set' : 'Missing');
console.log('Anon Key:', supabaseAnonKey ? 'Set' : 'Missing');
console.log('Service Role Key:', supabaseServiceRoleKey ? 'Set' : 'Missing');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase URL or Anon Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testConnection() {
  console.log('\nTesting Database Connection (Anon)...');
  try {
    const { data, error } = await supabase.from('sites').select('count', { count: 'exact', head: true });
    if (error) {
      console.error('❌ DB Connection Failed:', error.message);
    } else {
      console.log('✅ DB Connection Successful');
    }
  } catch (e: any) {
    console.error('❌ DB Exception:', e.message);
  }

  console.log('\nTesting Auth Connection...');
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('❌ Auth Connection Failed:', error.message);
    } else {
      console.log('✅ Auth Connection Successful (Session retrieval)');
    }
  } catch (e: any) {
    console.error('❌ Auth Exception:', e.message);
  }
}

testConnection();
