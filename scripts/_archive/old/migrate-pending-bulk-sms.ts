import { createAdminClient } from '../src/lib/supabase/server';
import { jobQueue } from '../src/lib/background-jobs';

async function migratePendingBulkSms() {
  const supabase = await createAdminClient();
  
  console.log('=== MIGRATING PENDING BULK SMS JOBS ===\n');
  
  // Find pending bulk SMS jobs in job_queue
  const { data: pendingJobs, error } = await supabase
    .from('job_queue')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending');
    
  if (error) {
    console.error('Error fetching pending jobs:', error);
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('No pending bulk SMS jobs to migrate');
    return;
  }
  
  console.log(`Found ${pendingJobs.length} pending bulk SMS jobs to migrate\n`);
  
  for (const job of pendingJobs) {
    console.log(`Migrating job ${job.id}...`);
    console.log(`  Customer count: ${job.payload?.customerIds?.length || 0}`);
    console.log(`  Message preview: ${job.payload?.message?.substring(0, 100)}...`);
    
    try {
      // Queue the job using the correct system
      const newJobId = await jobQueue.enqueue('send_bulk_sms', job.payload);
      console.log(`  ✅ Migrated to new job ID: ${newJobId}`);
      
      // Mark old job as migrated
      await supabase
        .from('job_queue')
        .update({ 
          status: 'completed',
          result: { migrated_to: newJobId },
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
        
      console.log(`  ✅ Marked old job as completed\n`);
    } catch (error) {
      console.error(`  ❌ Failed to migrate job:`, error);
    }
  }
  
  console.log('Migration complete!');
  process.exit(0);
}

migratePendingBulkSms().catch(console.error);