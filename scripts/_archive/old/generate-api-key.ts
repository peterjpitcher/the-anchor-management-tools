#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';
import { generateApiKey, hashApiKey } from '../src/lib/api/auth';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Generate a new API key
  const apiKey = await generateApiKey();
  const keyHash = await hashApiKey(apiKey);

  // Insert into database
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      key_hash: keyHash,
      name: 'Development API Key',
      description: 'API key for development and testing',
      permissions: ['read:events', 'read:menu', 'write:bookings'],
      rate_limit: 1000,
      is_active: true,
    })
    .select('id, name')
    .single();

  if (error) {
    console.error('Error creating API key:', error);
    process.exit(1);
  }

  console.log('✅ API Key created successfully!');
  console.log('');
  console.log('Key Details:');
  console.log('============');
  console.log(`ID: ${data.id}`);
  console.log(`Name: ${data.name}`);
  console.log('');
  console.log('🔑 Your API Key (save this, it cannot be retrieved later):');
  console.log('');
  console.log(apiKey);
  console.log('');
  console.log('Usage example:');
  console.log('curl -H "Authorization: Bearer ' + apiKey + '" ' + process.env.NEXT_PUBLIC_APP_URL + '/api/events');
}

main().catch(console.error);