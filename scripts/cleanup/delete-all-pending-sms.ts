#!/usr/bin/env tsx

import { createAdminClient } from '../src/lib/supabase/server';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function deleteAllPendingSMS() {
  console.log('🗑️  Deleting all pending SMS messages...\n');
  
  const supabase = await createAdminClient();
  
  // Get count of pending SMS jobs first
  const { count } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'send_sms')
    .eq('status', 'pending');
    
  if (!count || count === 0) {
    console.log('✅ No pending SMS messages to delete');
    return;
  }
  
  console.log(`Found ${count} pending SMS messages to delete`);
  
  // Cancel all pending SMS jobs
  const { error } = await supabase
    .from('jobs')
    .update({ 
      status: 'cancelled',
      error_message: 'Manually cancelled - messages for past event',
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('type', 'send_sms')
    .eq('status', 'pending');
    
  if (error) {
    console.error('❌ Error deleting jobs:', error);
  } else {
    console.log(`✅ Successfully cancelled ${count} pending SMS messages`);
    console.log('   These messages will not be sent.');
  }
}

// Run the deletion
deleteAllPendingSMS().catch(console.error);