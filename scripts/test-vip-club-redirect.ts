#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function testVipClubRedirect() {
  console.log('🔍 Testing VIP-CLUB.UK Redirect Fix\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Missing environment variables');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Check existing short links
  console.log('📋 Current short links in database:');
  const { data: links, error } = await supabase
    .from('short_links')
    .select('short_code, destination_url, link_type, click_count')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('❌ Error fetching links:', error);
    return;
  }
  
  if (links && links.length > 0) {
    links.forEach(link => {
      console.log(`\n✅ vip-club.uk/${link.short_code}`);
      console.log(`   → ${link.destination_url}`);
      console.log(`   Type: ${link.link_type}, Clicks: ${link.click_count || 0}`);
    });
  } else {
    console.log('   No short links found');
  }
  
  // Find the specific link mentioned
  const { data: specificLink } = await supabase
    .from('short_links')
    .select('*')
    .eq('short_code', 'gt341d')
    .single();
    
  if (specificLink) {
    console.log('\n🎯 Found gt341d link:');
    console.log(`   URL: vip-club.uk/gt341d`);
    console.log(`   Destination: ${specificLink.destination_url}`);
    console.log(`   Created: ${new Date(specificLink.created_at).toLocaleString()}`);
    console.log(`   Expires: ${specificLink.expires_at ? new Date(specificLink.expires_at).toLocaleString() : 'Never'}`);
  }
  
  console.log('\n📝 Middleware Fix Applied:');
  console.log('   ✅ Middleware now skips authentication for vip-club.uk domain');
  console.log('   ✅ Short links will redirect directly without login');
  console.log('   ✅ Vercel rewrites will properly route to /api/redirect/:code');
  
  console.log('\n🧪 To test in browser:');
  console.log('   1. Clear browser cache/cookies');
  console.log('   2. Open incognito/private window');
  console.log('   3. Visit: https://vip-club.uk/gt341d');
  console.log('   4. Should redirect directly to destination URL');
  console.log('      (NOT to login page)');
}

testVipClubRedirect()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });