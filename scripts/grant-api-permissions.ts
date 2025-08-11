#!/usr/bin/env tsx
/**
 * Grant write permissions to the API key
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

async function grantPermissions() {
  const apiKeyId = '3cf3f43f-0645-4212-803d-cee1f162309b'; // The key we just created
  
  console.log('🔐 Granting write permissions to API key...\n');
  
  // Grant write permissions for table bookings
  const permissions = [
    'read:table_bookings',
    'write:table_bookings',
    'create:bookings',
    'read:events',
    'read:business'
  ];
  
  for (const permission of permissions) {
    const { error } = await supabase
      .from('api_key_permissions')
      .upsert({
        api_key_id: apiKeyId,
        permission: permission
      }, {
        onConflict: 'api_key_id,permission'
      });
    
    if (error) {
      console.error(`❌ Error granting ${permission}:`, error.message);
    } else {
      console.log(`✅ Granted: ${permission}`);
    }
  }
  
  console.log('\n✅ Permissions granted successfully!');
}

grantPermissions().catch(console.error);