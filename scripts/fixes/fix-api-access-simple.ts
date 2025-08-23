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

async function testAPIKeyAccess() {
  console.log('Testing API key access with service role...\n');

  // Test with service role (should always work)
  const { data: serviceData, error: serviceError } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_hash', '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5');

  if (serviceError) {
    console.error('❌ Service role query failed:', serviceError);
    return;
  }

  console.log('✅ Service role can access API keys');
  console.log('Found', serviceData?.length || 0, 'matching keys');
  
  if (serviceData && serviceData.length > 0) {
    console.log('\nAPI Key Details:');
    console.log('- Name:', serviceData[0].name);
    console.log('- Active:', serviceData[0].is_active);
    console.log('- Permissions:', serviceData[0].permissions);
    console.log('- Rate Limit:', serviceData[0].rate_limit);
  }

  // Now test with anon key to see if that's the issue
  console.log('\nTesting with anon key...');
  const anonClient = createClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: anonData, error: anonError } = await anonClient
    .from('api_keys')
    .select('*')
    .eq('key_hash', '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5');

  if (anonError) {
    console.error('❌ Anon role query failed:', anonError.message);
    console.log('\nThis confirms RLS is blocking access. Please run this SQL in Supabase:');
    console.log(`
-- Option 1: Create a policy to allow reading active API keys
CREATE POLICY "Allow reading active API keys" ON api_keys
FOR SELECT USING (is_active = true);

-- Option 2: Or temporarily disable RLS (less secure)
-- ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;
    `);
  } else {
    console.log('✅ Anon role can access API keys - no RLS issue');
  }
}

testAPIKeyAccess().catch(console.error);