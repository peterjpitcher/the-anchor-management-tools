#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function checkTables() {
  console.log('🔍 Checking database tables...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Check if background_jobs table exists
  const { data: bgJobs } = await supabase
    .from('background_jobs')
    .select('count')
    .limit(1);
    
  if (bgJobs) {
    console.log('✅ background_jobs table exists');
    
    // Count pending jobs
    const { count } = await supabase
      .from('background_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
      
    console.log(`   Pending jobs: ${count || 0}`);
  } else {
    console.log('❌ background_jobs table NOT found');
  }
  
  // Check if loyalty_notifications table exists
  const { data: loyaltyNotif } = await supabase
    .from('loyalty_notifications')
    .select('count')
    .limit(1);
    
  if (loyaltyNotif) {
    console.log('\n✅ loyalty_notifications table exists');
  } else {
    console.log('\n❌ loyalty_notifications table NOT found (this is expected if migration not run)');
  }
  
  // Check messages table
  const { data: messages } = await supabase
    .from('messages')
    .select('count')
    .limit(1);
    
  if (messages) {
    console.log('\n✅ messages table exists');
    
    // Count recent messages
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      
    console.log(`   Messages in last 24h: ${count || 0}`);
  } else {
    console.log('\n❌ messages table NOT found');
  }
}

checkTables()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });