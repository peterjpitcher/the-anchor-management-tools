#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function checkClickTracking() {
  console.log('🔍 Checking Short Link Click Tracking\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Missing environment variables');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // 1. Check short links
  console.log('1️⃣ Current short links:');
  const { data: links, error: linksError } = await supabase
    .from('short_links')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (linksError) {
    console.error('❌ Error fetching links:', linksError);
    return;
  }
  
  if (links && links.length > 0) {
    links.forEach(link => {
      console.log(`\n📎 ${link.short_code}`);
      console.log(`   URL: vip-club.uk/${link.short_code}`);
      console.log(`   Destination: ${link.destination_url}`);
      console.log(`   Click count: ${link.click_count || 0}`);
      console.log(`   Last clicked: ${link.last_clicked_at || 'Never'}`);
      console.log(`   Created: ${new Date(link.created_at).toLocaleString()}`);
    });
  } else {
    console.log('   No short links found');
  }
  
  // 2. Check recent clicks
  console.log('\n\n2️⃣ Recent clicks (last 10):');
  const { data: clicks, error: clicksError } = await supabase
    .from('short_link_clicks')
    .select(`
      *,
      short_links!inner(short_code)
    `)
    .order('clicked_at', { ascending: false })
    .limit(10);
    
  if (clicksError) {
    console.error('❌ Error fetching clicks:', clicksError);
    return;
  }
  
  if (clicks && clicks.length > 0) {
    clicks.forEach(click => {
      console.log(`\n🖱️  Click ID: ${click.id}`);
      console.log(`   Short code: ${click.short_links?.short_code}`);
      console.log(`   Clicked at: ${new Date(click.clicked_at).toLocaleString()}`);
      console.log(`   IP: ${click.ip_address || 'Not captured'}`);
      console.log(`   Country: ${click.country || 'Not captured'}`);
      console.log(`   City: ${click.city || 'Not captured'}`);
      console.log(`   Device: ${click.device_type || 'Not captured'}`);
      console.log(`   Browser: ${click.browser || 'Not captured'}`);
      console.log(`   OS: ${click.os || 'Not captured'}`);
      console.log(`   User Agent: ${click.user_agent ? click.user_agent.substring(0, 50) + '...' : 'Not captured'}`);
    });
  } else {
    console.log('   No clicks recorded');
  }
  
  // 3. Check click counts
  console.log('\n\n3️⃣ Click statistics:');
  const { data: stats } = await supabase
    .from('short_link_clicks')
    .select('short_link_id')
    .not('short_link_id', 'is', null);
    
  console.log(`   Total clicks recorded: ${stats?.length || 0}`);
  
  // 4. Check if demographic columns exist
  console.log('\n\n4️⃣ Checking database schema:');
  const { data: columns } = await supabase
    .from('short_link_clicks')
    .select('*')
    .limit(0); // Just get schema, no data
    
  console.log('   Columns in short_link_clicks table:');
  if (columns) {
    const firstRow = { ...columns[0] } || {};
    Object.keys(firstRow).forEach(col => {
      console.log(`   - ${col}`);
    });
  }
  
  // 5. Test direct insert
  console.log('\n\n5️⃣ Testing direct click insert...');
  const testLinkCode = 'gt341d'; // The link you mentioned
  
  // Find the link
  const { data: testLink } = await supabase
    .from('short_links')
    .select('*')
    .eq('short_code', testLinkCode)
    .single();
    
  if (testLink) {
    const { data: testClick, error: insertError } = await supabase
      .from('short_link_clicks')
      .insert({
        short_link_id: testLink.id,
        user_agent: 'Test User Agent - Script',
        ip_address: '127.0.0.1',
        country: 'GB',
        city: 'London',
        device_type: 'desktop',
        browser: 'Test Browser',
        os: 'Test OS'
      })
      .select()
      .single();
      
    if (insertError) {
      console.error('❌ Failed to insert test click:', insertError);
    } else {
      console.log('✅ Test click inserted successfully');
      console.log(`   Click ID: ${testClick.id}`);
      
      // Update the link's click count
      const { error: updateError } = await supabase
        .from('short_links')
        .update({
          click_count: (testLink.click_count || 0) + 1,
          last_clicked_at: new Date().toISOString()
        })
        .eq('id', testLink.id);
        
      if (updateError) {
        console.error('❌ Failed to update click count:', updateError);
      } else {
        console.log('✅ Click count updated');
      }
    }
  } else {
    console.log(`❌ Link ${testLinkCode} not found`);
  }
}

checkClickTracking()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });