import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
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

async function debugApiAuth() {
  const apiKey = 'anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg';
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  
  console.log('API Key:', apiKey);
  console.log('Key Hash:', keyHash);
  console.log('Expected Hash: 33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5');
  console.log('Hashes match:', keyHash === '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5');
  
  console.log('\n--- Checking API Keys Table ---');
  
  // First, check all API keys
  const { data: allKeys, error: allError } = await supabase
    .from('api_keys')
    .select('*');
    
  if (allError) {
    console.error('Error fetching all keys:', allError);
  } else {
    console.log('Total API keys in database:', allKeys?.length || 0);
    if (allKeys && allKeys.length > 0) {
      allKeys.forEach((key, index) => {
        console.log(`\nKey ${index + 1}:`);
        console.log('  ID:', key.id);
        console.log('  Name:', key.name);
        console.log('  Hash:', key.key_hash);
        console.log('  Active:', key.is_active);
        console.log('  Permissions:', key.permissions);
      });
    }
  }
  
  console.log('\n--- Checking for our specific key ---');
  
  // Check for our specific key
  const { data: specificKey, error: specificError } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_hash', keyHash)
    .eq('is_active', true);
    
  if (specificError) {
    console.error('Error fetching specific key:', specificError);
  } else {
    console.log('Keys found with our hash:', specificKey?.length || 0);
    if (specificKey && specificKey.length > 0) {
      console.log('Key details:', JSON.stringify(specificKey[0], null, 2));
    }
  }
  
  // Test the auth flow
  console.log('\n--- Testing Auth Flow ---');
  const response = await fetch('http://localhost:3000/api/events', {
    headers: {
      'X-API-Key': apiKey,
    },
  });
  
  console.log('Response status:', response.status);
  const body = await response.text();
  console.log('Response body:', body);
}

debugApiAuth().catch(console.error);