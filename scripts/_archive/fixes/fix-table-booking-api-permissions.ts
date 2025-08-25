#!/usr/bin/env tsx

/**
 * Fix Table Booking API Permissions
 * 
 * This script updates the API key permissions to include table booking access
 * for the Anchor website integration.
 */

import { createAdminClient } from '@/lib/supabase/server';
import crypto from 'crypto';

async function fixTableBookingPermissions() {
  console.log('🔧 Fixing Table Booking API Permissions');
  console.log('=====================================\n');

  const supabase = await createAdminClient();
  
  // The API key being used
  const apiKey = 'bcf9b880cc9fe4615bd68090e88c6407d4ee7506';
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  console.log('📌 API Key (first 8 chars):', apiKey.substring(0, 8) + '...');
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
      return;
    }
    
    if (!currentKey) {
      console.error('❌ API key not found in database');
      console.log('\n💡 The API key might need to be registered first.');
      console.log('Use the generate-api-key.ts script to create a new key.');
      return;
    }
    
    console.log('\n✅ Found API key:', currentKey.name);
    console.log('📋 Current permissions:', JSON.stringify(currentKey.permissions, null, 2));
    console.log('🕐 Last used:', currentKey.last_used_at || 'Never');
    console.log('📊 Usage count:', currentKey.usage_count || 0);
    
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
    
    // Test the permissions
    console.log('\n🧪 Testing permission check...');
    const hasTableBookingRead = updatedKey.permissions.includes('read:table_bookings') || 
                                updatedKey.permissions.includes('*');
    const hasTableBookingWrite = updatedKey.permissions.includes('write:table_bookings') || 
                                 updatedKey.permissions.includes('*');
    
    console.log('✅ Has read:table_bookings permission:', hasTableBookingRead);
    console.log('✅ Has write:table_bookings permission:', hasTableBookingWrite);
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Alternative function to grant all permissions (use with caution)
async function grantAllPermissions() {
  console.log('\n⚠️  Granting ALL permissions to API key...');
  console.log('This should only be used for testing!\n');
  
  const supabase = await createAdminClient();
  const apiKey = 'bcf9b880cc9fe4615bd68090e88c6407d4ee7506';
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  const { error } = await supabase
    .from('api_keys')
    .update({ 
      permissions: ['*'],
      updated_at: new Date().toISOString()
    })
    .eq('key_hash', keyHash);
  
  if (error) {
    console.error('❌ Error granting all permissions:', error);
  } else {
    console.log('✅ All permissions granted successfully!');
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

// Uncomment to grant all permissions instead
// grantAllPermissions();