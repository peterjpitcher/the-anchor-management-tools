#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function testDemographics() {
  console.log('🔍 Testing Short Link Demographics\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Missing environment variables');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // 1. Create a test link
  console.log('1️⃣ Creating test link for demographics...');
  const testCode = 'demo-' + Date.now();
  const { data: link, error: createError } = await supabase
    .from('short_links')
    .insert({
      short_code: testCode,
      destination_url: 'https://www.example.com/demo',
      link_type: 'custom',
      created_by: '00000000-0000-0000-0000-000000000000'
    })
    .select()
    .single();
    
  if (createError) {
    console.error('❌ Failed to create test link:', createError);
    return;
  }
  
  console.log('✅ Created test link:', testCode);
  
  // 2. Simulate clicks with demographics
  console.log('\n2️⃣ Simulating clicks with demographics...');
  const testClicks = [
    { country: 'GB', city: 'London', device_type: 'mobile', browser: 'Safari', os: 'iOS' },
    { country: 'GB', city: 'Manchester', device_type: 'desktop', browser: 'Chrome', os: 'Windows' },
    { country: 'US', city: 'New York', device_type: 'mobile', browser: 'Chrome', os: 'Android' },
    { country: 'GB', city: 'London', device_type: 'mobile', browser: 'Safari', os: 'iOS' },
    { country: 'FR', city: 'Paris', device_type: 'desktop', browser: 'Firefox', os: 'macOS' }
  ];
  
  for (const click of testClicks) {
    const { error } = await supabase
      .from('short_link_clicks')
      .insert({
        short_link_id: link.id,
        ...click,
        user_agent: 'Test User Agent',
        ip_address: '192.168.1.1'
      });
      
    if (error) {
      console.error('❌ Failed to insert click:', error);
    }
  }
  
  console.log('✅ Inserted', testClicks.length, 'test clicks');
  
  // 3. Test analytics function
  console.log('\n3️⃣ Testing analytics function...');
  const { data: analytics, error: analyticsError } = await supabase
    .rpc('get_short_link_analytics', {
      p_short_code: testCode,
      p_days: 1
    });
    
  if (analyticsError) {
    console.error('❌ Analytics error:', analyticsError);
  } else {
    console.log('✅ Analytics data:', analytics);
  }
  
  // 4. Test volume analytics
  console.log('\n4️⃣ Testing volume analytics...');
  const { data: volumeData, error: volumeError } = await supabase
    .rpc('get_all_links_analytics', {
      p_days: 30
    });
    
  if (volumeError) {
    console.error('❌ Volume analytics error:', volumeError);
  } else {
    console.log('✅ Found', volumeData?.length || 0, 'links with analytics');
  }
  
  // 5. Check click demographics
  console.log('\n5️⃣ Checking click demographics...');
  const { data: clicks, error: clicksError } = await supabase
    .from('short_link_clicks')
    .select('*')
    .eq('short_link_id', link.id);
    
  if (clicksError) {
    console.error('❌ Failed to fetch clicks:', clicksError);
  } else {
    console.log('✅ Click demographics:');
    const demographics = {
      countries: {} as Record<string, number>,
      devices: {} as Record<string, number>,
      browsers: {} as Record<string, number>
    };
    
    clicks?.forEach(click => {
      if (click.country) demographics.countries[click.country] = (demographics.countries[click.country] || 0) + 1;
      if (click.device_type) demographics.devices[click.device_type] = (demographics.devices[click.device_type] || 0) + 1;
      if (click.browser) demographics.browsers[click.browser] = (demographics.browsers[click.browser] || 0) + 1;
    });
    
    console.log('   Countries:', demographics.countries);
    console.log('   Devices:', demographics.devices);
    console.log('   Browsers:', demographics.browsers);
  }
  
  // 6. Cleanup
  console.log('\n6️⃣ Cleaning up test data...');
  await supabase
    .from('short_links')
    .delete()
    .eq('id', link.id);
    
  console.log('✅ Test link deleted');
}

testDemographics()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });