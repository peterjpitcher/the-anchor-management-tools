#!/usr/bin/env tsx

/**
 * Fix Table Booking API Permissions - Standalone Version
 * This version loads environment variables from .env.local
 */

import { config } from 'dotenv';
import path from 'path';
import crypto from 'crypto';

// Load environment variables from .env.local
config({ path: path.resolve(process.cwd(), '.env.local') });

// Create Supabase client directly
import { createClient } from '@supabase/supabase-js';

async function fixTableBookingPermissions() {
  console.log('🔧 Fixing Table Booking API Permissions');
  console.log('=====================================\n');

  // Check for required environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing required environment variables');
    console.log('\n📝 Required variables:');
    console.log('- NEXT_PUBLIC_SUPABASE_URL');
    console.log('- SUPABASE_SERVICE_ROLE_KEY');
    console.log('\nMake sure these are set in your .env.local file');
    return;
  }

  console.log('✅ Environment variables loaded');
  console.log('📌 Supabase URL:', supabaseUrl);
  
  // Create admin client
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  // The API key being used
  const apiKey = 'bcf9b880cc9fe4615bd68090e88c6407d4ee7506';
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  console.log('\n📌 API Key (first 8 chars):', apiKey.substring(0, 8) + '...');
  console.log('📌 Key Hash:', keyHash);
  
  try {
    // First, check the current permissions
    console.log('\n🔍 Checking current API key permissions...');
    const { data: currentKey, error: fetchError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .single();
    
    if (fetchError) {
      console.error('❌ Error fetching API key:', fetchError);
      console.log('\n💡 If the key doesn\'t exist, you may need to create it first.');
      return;
    }
    
    if (!currentKey) {
      console.error('❌ API key not found in database');
      console.log('\n💡 The API key might need to be registered first.');
      return;
    }
    
    console.log('\n✅ Found API key:', currentKey.name);
    console.log('📋 Current permissions:', JSON.stringify(currentKey.permissions, null, 2));
    console.log('🕐 Last used:', currentKey.last_used_at || 'Never');
    console.log('✅ Is active:', currentKey.is_active);
    
    // Update permissions to include table booking access
    const newPermissions = [
      'read:events',
      'read:menu',
      'read:business',
      'read:table_bookings',    // Required for availability check
      'write:table_bookings',   // Required for creating bookings
      'create:bookings',        // Alternative permission name
      'read:customers',         // May be needed for customer lookup
      'write:customers'         // May be needed for creating new customers
    ];
    
    console.log('\n🔄 Updating permissions...');
    console.log('📋 New permissions:', JSON.stringify(newPermissions, null, 2));
    
    const { error: updateError } = await supabase
      .from('api_keys')
      .update({ 
        permissions: newPermissions,
        updated_at: new Date().toISOString()
      })
      .eq('key_hash', keyHash);
    
    if (updateError) {
      console.error('❌ Error updating permissions:', updateError);
      return;
    }
    
    console.log('\n✅ Permissions updated successfully!');
    
    // Verify the update
    const { data: updatedKey, error: verifyError } = await supabase
      .from('api_keys')
      .select('permissions')
      .eq('key_hash', keyHash)
      .single();
    
    if (verifyError) {
      console.error('❌ Error verifying update:', verifyError);
      return;
    }
    
    console.log('\n🎉 Verification complete!');
    console.log('📋 Updated permissions:', JSON.stringify(updatedKey.permissions, null, 2));
    
    console.log('\n📝 Next Steps:');
    console.log('1. Test the API endpoint again with the same API key');
    console.log('2. The table booking availability endpoint should now work');
    console.log('3. Use header: X-API-Key: ' + apiKey.substring(0, 8) + '...');
    
    console.log('\n🧪 Test with this curl command:');
    console.log(`curl -X GET "https://management.orangejelly.co.uk/api/table-bookings/availability?date=${new Date().toISOString().split('T')[0]}&party_size=4" \\`);
    console.log(`  -H "X-API-Key: ${apiKey}"`);
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the main function
fixTableBookingPermissions()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });