import { createAdminClient } from '../src/lib/supabase/server';

async function checkJobs() {
  const supabase = await createAdminClient();
  
  console.log('=== JOB SYSTEM ANALYSIS ===\n');
  
  // Check recent jobs
  const { data: recentJobs, error } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
    
  if (error) {
    console.error('Error fetching jobs:', error);
    return;
  }
  
  const jobCount = recentJobs ? recentJobs.length : 0;
  console.log(`Found ${jobCount} recent jobs`);
  
  // Group by status
  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  
  if (recentJobs) {
    recentJobs.forEach(job => {
      statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
      typeCounts[job.type] = (typeCounts[job.type] || 0) + 1;
    });
  }
  
  console.log('\nJob Status Distribution:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  
  console.log('\nJob Type Distribution:');
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  
  // Check for failed bulk message jobs
  const { data: failedBulkJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (failedBulkJobs && failedBulkJobs.length > 0) {
    console.log('\n⚠️  Failed bulk SMS jobs found:');
    failedBulkJobs.forEach(job => {
      console.log(`  - ID: ${job.id}, Created: ${job.created_at}`);
      if (job.error) console.log(`    Error: ${job.error}`);
    });
  }
  
  // Check pending bulk jobs
  const { data: pendingBulkJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
    
  if (pendingBulkJobs && pendingBulkJobs.length > 0) {
    console.log(`\n⏳ ${pendingBulkJobs.length} pending bulk SMS jobs waiting to be processed`);
  }
  
  // Check messages table for recent bulk messages
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  console.log(`\n📱 Recent messages in database: ${recentMessages?.length || 0}`);
  
  process.exit(0);
}

checkJobs().catch(console.error);