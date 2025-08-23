import { createAdminClient } from '../src/lib/supabase/server';

async function checkJobTables() {
  const supabase = await createAdminClient();
  
  console.log('=== JOB TABLES ANALYSIS ===\n');
  
  // Check if job_queue table exists
  const { data: jobQueueData, error: jobQueueError } = await supabase
    .from('job_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (jobQueueError) {
    console.log('❌ job_queue table: NOT FOUND or ERROR');
    console.log('   Error:', jobQueueError.message);
  } else {
    console.log('✅ job_queue table exists');
    console.log(`   Recent records: ${jobQueueData?.length || 0}`);
    if (jobQueueData && jobQueueData.length > 0) {
      console.log('   Sample record:', JSON.stringify(jobQueueData[0], null, 2));
    }
  }
  
  console.log('\n');
  
  // Check if background_jobs table exists
  const { data: bgJobsData, error: bgJobsError } = await supabase
    .from('background_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (bgJobsError) {
    console.log('❌ background_jobs table: NOT FOUND or ERROR');
    console.log('   Error:', bgJobsError.message);
  } else {
    console.log('✅ background_jobs table exists');
    console.log(`   Recent records: ${bgJobsData?.length || 0}`);
    if (bgJobsData && bgJobsData.length > 0) {
      console.log('   Sample record:', JSON.stringify(bgJobsData[0], null, 2));
    }
  }
  
  console.log('\n');
  
  // Check if jobs table exists (mentioned in CLAUDE.md)
  const { data: jobsData, error: jobsError } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (jobsError) {
    console.log('❌ jobs table: NOT FOUND or ERROR');
    console.log('   Error:', jobsError.message);
  } else {
    console.log('✅ jobs table exists');
    console.log(`   Recent records: ${jobsData?.length || 0}`);
    if (jobsData && jobsData.length > 0) {
      console.log('   Sample record:', JSON.stringify(jobsData[0], null, 2));
    }
  }
  
  // Check for any pending bulk SMS jobs
  console.log('\n=== CHECKING FOR BULK SMS JOBS ===\n');
  
  // Check job_queue
  const { data: pendingJobQueue } = await supabase
    .from('job_queue')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
    
  if (pendingJobQueue && pendingJobQueue.length > 0) {
    console.log(`Found ${pendingJobQueue.length} pending bulk SMS jobs in job_queue`);
  }
  
  // Check background_jobs
  const { data: pendingBgJobs } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
    
  if (pendingBgJobs && pendingBgJobs.length > 0) {
    console.log(`Found ${pendingBgJobs.length} pending bulk SMS jobs in background_jobs`);
  }
  
  // Check jobs
  const { data: pendingJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
    
  if (pendingJobs && pendingJobs.length > 0) {
    console.log(`Found ${pendingJobs.length} pending bulk SMS jobs in jobs`);
  }
  
  process.exit(0);
}

checkJobTables().catch(console.error);