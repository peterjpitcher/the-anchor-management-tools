#!/usr/bin/env tsx

import { createAdminClient } from '../src/lib/supabase/server';
import dotenv from 'dotenv';
import path from 'path';
import readline from 'readline';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function deletePendingSMS() {
  console.log('🗑️  DELETE PENDING SMS MESSAGES\n');
  
  const supabase = await createAdminClient();
  
  // Get all pending SMS jobs
  const { data: pendingJobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
    
  if (error) {
    console.error('❌ Error fetching pending jobs:', error);
    rl.close();
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('✅ No pending SMS messages to delete');
    rl.close();
    return;
  }
  
  console.log(`Found ${pendingJobs.length} pending SMS message(s)`);
  console.log('\nOptions:');
  console.log('1. Delete ALL pending SMS messages');
  console.log('2. Delete specific messages by job ID');
  console.log('3. Cancel (do nothing)');
  
  const choice = await question('\nYour choice (1-3): ');
  
  if (choice === '1') {
    // Delete all
    const confirm = await question(`\n⚠️  Are you sure you want to delete ALL ${pendingJobs.length} pending messages? (yes/no): `);
    
    if (confirm.toLowerCase() === 'yes') {
      const { error: deleteError } = await supabase
        .from('jobs')
        .update({ 
          status: 'cancelled',
          error_message: 'Manually cancelled by user',
          failed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('type', 'send_sms')
        .eq('status', 'pending');
        
      if (deleteError) {
        console.error('❌ Error deleting jobs:', deleteError);
      } else {
        console.log(`✅ Successfully cancelled ${pendingJobs.length} pending SMS messages`);
      }
    } else {
      console.log('❌ Deletion cancelled');
    }
    
  } else if (choice === '2') {
    // Show jobs and let user select
    console.log('\nPending messages:');
    pendingJobs.forEach((job, index) => {
      const payload = job.payload as any;
      console.log(`${index + 1}. Job ${job.id.substring(0, 8)}... - To: ${payload.to}, Created: ${new Date(job.created_at).toLocaleString()}`);
    });
    
    const selections = await question('\nEnter job numbers to delete (comma-separated, e.g., 1,3,5): ');
    const indices = selections.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < pendingJobs.length);
    
    if (indices.length > 0) {
      const jobsToDelete = indices.map(i => pendingJobs[i].id);
      
      const { error: deleteError } = await supabase
        .from('jobs')
        .update({ 
          status: 'cancelled',
          error_message: 'Manually cancelled by user',
          failed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .in('id', jobsToDelete);
        
      if (deleteError) {
        console.error('❌ Error deleting jobs:', deleteError);
      } else {
        console.log(`✅ Successfully cancelled ${jobsToDelete.length} SMS message(s)`);
      }
    } else {
      console.log('❌ No valid selections made');
    }
    
  } else {
    console.log('❌ Operation cancelled');
  }
  
  rl.close();
}

// Run the deletion tool
deletePendingSMS().catch(error => {
  console.error(error);
  rl.close();
});