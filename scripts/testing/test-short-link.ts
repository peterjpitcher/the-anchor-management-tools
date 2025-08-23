#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function testShortLink(shortCode: string) {
  console.log(`🔍 Testing short link: ${shortCode}\n`);
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Missing environment variables');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Get the short link
  const { data: link, error } = await supabase
    .from('short_links')
    .select('*')
    .eq('short_code', shortCode)
    .single();
    
  if (error || !link) {
    console.error('❌ Short link not found:', shortCode);
    console.error('Error:', error);
    return;
  }
  
  console.log('✅ Found short link:');
  console.log(`   Code: ${link.short_code}`);
  console.log(`   Type: ${link.link_type}`);
  console.log(`   Destination: ${link.destination_url}`);
  console.log(`   Click count: ${link.click_count || 0}`);
  console.log(`   Created: ${new Date(link.created_at).toLocaleString()}`);
  console.log(`   Expires: ${link.expires_at ? new Date(link.expires_at).toLocaleString() : 'Never'}`);
  
  console.log('\n📱 Short URL: https://vip-club.uk/' + shortCode);
  console.log('🔗 Redirects to:', link.destination_url);
  
  // List all short links
  console.log('\n\n📋 All short links:');
  const { data: allLinks } = await supabase
    .from('short_links')
    .select('short_code, destination_url, click_count, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (allLinks && allLinks.length > 0) {
    allLinks.forEach(l => {
      console.log(`\n   • vip-club.uk/${l.short_code}`);
      console.log(`     → ${l.destination_url.substring(0, 60)}${l.destination_url.length > 60 ? '...' : ''}`);
      console.log(`     Clicks: ${l.click_count || 0}`);
    });
  }
}

// Get short code from command line or use default
const shortCode = process.argv[2] || 'gt341d';

testShortLink(shortCode)
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });