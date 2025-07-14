#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function testAnalyticsFunction() {
  console.log('🔍 Testing Analytics Functions\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Missing environment variables');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // 1. Test get_short_link_analytics directly
  console.log('1️⃣ Testing get_short_link_analytics function...');
  try {
    const { data, error } = await supabase.rpc('get_short_link_analytics', {
      p_short_code: 'gt341d',
      p_days: 30
    });
    
    if (error) {
      console.error('❌ Function error:', error);
      console.error('   Code:', error.code);
      console.error('   Message:', error.message);
      console.error('   Details:', error.details);
    } else {
      console.log('✅ Function executed successfully');
      console.log('   Returned rows:', data?.length || 0);
      if (data && data.length > 0) {
        console.log('   Sample data:', data[0]);
      }
    }
  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }
  
  // 2. Test get_all_links_analytics
  console.log('\n2️⃣ Testing get_all_links_analytics function...');
  try {
    const { data, error } = await supabase.rpc('get_all_links_analytics', {
      p_days: 30
    });
    
    if (error) {
      console.error('❌ Function error:', error);
      console.error('   Code:', error.code);
      console.error('   Message:', error.message);
      console.error('   Details:', error.details);
    } else {
      console.log('✅ Function executed successfully');
      console.log('   Returned links:', data?.length || 0);
      if (data && data.length > 0) {
        console.log('   First link:', {
          short_code: data[0].short_code,
          total_clicks: data[0].total_clicks,
          dates_count: data[0].click_dates?.length || 0
        });
      }
    }
  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }
  
  // 3. Check function definitions
  console.log('\n3️⃣ Checking function signatures...');
  const { data: functions } = await supabase.rpc('pg_get_functiondef', {
    funcoid: `get_short_link_analytics(character varying, integer)::regprocedure`
  }).single();
  
  if (functions) {
    console.log('Function definition preview:', functions.substring(0, 200) + '...');
  }
  
  // 4. Simple direct query test
  console.log('\n4️⃣ Testing direct query...');
  const { data: directData, error: directError } = await supabase
    .from('short_link_clicks')
    .select('clicked_at, device_type, country')
    .eq('short_link_id', (await supabase.from('short_links').select('id').eq('short_code', 'gt341d').single()).data?.id)
    .order('clicked_at', { ascending: false })
    .limit(5);
    
  if (directError) {
    console.error('❌ Direct query error:', directError);
  } else {
    console.log('✅ Direct query successful');
    console.log('   Recent clicks:', directData);
  }
}

testAnalyticsFunction()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });