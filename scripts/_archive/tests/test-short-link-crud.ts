#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function testShortLinkCRUD() {
  console.log('🧪 Testing Short Link CRUD Operations\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Missing environment variables');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // 1. Create a test short link
  console.log('1️⃣ Creating test short link...');
  const testCode = 'test-' + Date.now();
  const { data: created, error: createError } = await supabase
    .from('short_links')
    .insert({
      short_code: testCode,
      destination_url: 'https://www.example.com/test',
      link_type: 'custom',
      created_by: '00000000-0000-0000-0000-000000000000' // System user
    })
    .select()
    .single();
    
  if (createError) {
    console.error('❌ Failed to create:', createError);
    return;
  }
  
  console.log('✅ Created:', {
    code: created.short_code,
    url: created.destination_url,
    id: created.id
  });
  
  // 2. Update the short link
  console.log('\n2️⃣ Updating short link...');
  const newUrl = 'https://www.the-anchor.pub/updated';
  const { error: updateError } = await supabase
    .from('short_links')
    .update({
      destination_url: newUrl,
      updated_at: new Date().toISOString()
    })
    .eq('id', created.id);
    
  if (updateError) {
    console.error('❌ Failed to update:', updateError);
  } else {
    console.log('✅ Updated destination URL to:', newUrl);
  }
  
  // 3. Test redirect (simulated)
  console.log('\n3️⃣ Testing redirect handling...');
  const { data: link, error: fetchError } = await supabase
    .from('short_links')
    .select('*')
    .eq('short_code', testCode)
    .single();
    
  if (fetchError || !link) {
    console.log('✅ Deleted link properly returns null (will redirect to the-anchor.pub)');
  } else {
    console.log('✅ Link found, would redirect to:', link.destination_url);
  }
  
  // 4. Delete the short link
  console.log('\n4️⃣ Deleting short link...');
  const { error: deleteError } = await supabase
    .from('short_links')
    .delete()
    .eq('id', created.id);
    
  if (deleteError) {
    console.error('❌ Failed to delete:', deleteError);
  } else {
    console.log('✅ Deleted successfully');
  }
  
  // 5. Verify deletion
  console.log('\n5️⃣ Verifying deletion...');
  const { data: deleted, error: verifyError } = await supabase
    .from('short_links')
    .select('*')
    .eq('short_code', testCode)
    .single();
    
  if (verifyError || !deleted) {
    console.log('✅ Link not found - deletion confirmed');
    console.log('   Would redirect to: https://www.the-anchor.pub');
  } else {
    console.error('❌ Link still exists after deletion!');
  }
  
  // 6. List all short links
  console.log('\n6️⃣ Current short links:');
  const { data: allLinks } = await supabase
    .from('short_links')
    .select('short_code, destination_url, link_type, click_count')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (allLinks && allLinks.length > 0) {
    allLinks.forEach(l => {
      console.log(`   • vip-club.uk/${l.short_code} → ${l.destination_url.substring(0, 50)}...`);
      console.log(`     Type: ${l.link_type}, Clicks: ${l.click_count || 0}`);
    });
  } else {
    console.log('   No short links found');
  }
}

testShortLinkCRUD()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });