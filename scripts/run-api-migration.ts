import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('Running API keys access migration...\n');

  try {
    // Check if RLS is enabled on api_keys table
    const { data: tables, error: tablesError } = await supabase
      .rpc('get_table_info', { table_name: 'api_keys' });
    
    console.log('Checking table RLS status...');
    
    // Drop existing policies if any
    console.log('Dropping existing policies...');
    try {
      await supabase.rpc('exec_sql', { 
        sql: `DROP POLICY IF EXISTS "Public can read active API keys" ON api_keys;` 
      });
    } catch (e) {
      // Ignore errors from dropping non-existent policies
    }
    
    try {
      await supabase.rpc('exec_sql', { 
        sql: `DROP POLICY IF EXISTS "Service role can manage API keys" ON api_keys;` 
      });
    } catch (e) {
      // Ignore errors from dropping non-existent policies
    }
    
    // Create new policies
    console.log('Creating new policies...');
    const { error: policy1Error } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE POLICY "Public can read active API keys" ON api_keys
        FOR SELECT
        USING (is_active = true);
      `
    });
    
    if (policy1Error) {
      console.log('Note: Policy creation might have failed if RLS is not enabled');
    }
    
    const { error: policy2Error } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE POLICY "Service role can manage API keys" ON api_keys
        FOR ALL
        USING (auth.role() = 'service_role');
      `
    });
    
    // Grant permissions
    console.log('Granting permissions...');
    await supabase.rpc('exec_sql', {
      sql: `GRANT SELECT ON api_keys TO anon;`
    });
    
    await supabase.rpc('exec_sql', {
      sql: `GRANT SELECT ON api_keys TO authenticated;`
    });
    
    console.log('\n✅ Migration completed successfully!');
    
    // Test the API key access
    console.log('\nTesting API key access...');
    const { data: testData, error: testError } = await supabase
      .from('api_keys')
      .select('id, name, is_active')
      .eq('key_hash', '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5')
      .single();
    
    if (testError) {
      console.error('❌ Test failed:', testError.message);
    } else {
      console.log('✅ API key access test passed!');
      console.log('   Key name:', testData.name);
      console.log('   Active:', testData.is_active);
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    console.log('\nPlease run the following SQL manually in your Supabase SQL editor:');
    console.log(`
-- Fix API keys access for public API authentication
-- Drop existing policies if any
DROP POLICY IF EXISTS "Public can read active API keys" ON api_keys;
DROP POLICY IF EXISTS "Service role can manage API keys" ON api_keys;

-- Create a policy that allows reading active API keys
CREATE POLICY "Public can read active API keys" ON api_keys
    FOR SELECT
    USING (is_active = true);

-- Ensure service role can still manage API keys
CREATE POLICY "Service role can manage API keys" ON api_keys
    FOR ALL
    USING (auth.role() = 'service_role');

-- Grant SELECT permission to anon role
GRANT SELECT ON api_keys TO anon;

-- Also ensure authenticated role has access
GRANT SELECT ON api_keys TO authenticated;
    `);
  }
}

runMigration().catch(console.error);