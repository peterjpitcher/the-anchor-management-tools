import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function clearStuckJobs() {
  console.log('🔧 Clearing stuck jobs...\n')
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  // Find stuck processing jobs (running for more than 60 seconds)
  const { data: stuckJobs, error: fetchError } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'processing')
    
  if (fetchError) {
    console.error('Error fetching stuck jobs:', fetchError)
    return
  }
  
  if (!stuckJobs || stuckJobs.length === 0) {
    console.log('✅ No stuck jobs found')
    return
  }
  
  console.log(`Found ${stuckJobs.length} stuck jobs in processing state:\n`)
  
  const now = new Date()
  const stuckJobsToReset = []
  
  stuckJobs.forEach(job => {
    const startedAt = new Date(job.started_at || job.created_at)
    const runningFor = Math.floor((now.getTime() - startedAt.getTime()) / 1000)
    
    console.log(`Job ID: ${job.id}`)
    console.log(`Type: ${job.type}`)
    console.log(`Running for: ${runningFor} seconds`)
    
    if (runningFor > 60) {
      console.log(`⚠️ This job has been running too long and will be reset`)
      stuckJobsToReset.push(job.id)
    }
    console.log('---')
  })
  
  if (stuckJobsToReset.length > 0) {
    console.log(`\nResetting ${stuckJobsToReset.length} stuck jobs to failed state...`)
    
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        status: 'failed',
        error_message: 'Job timed out - stuck in processing for too long',
        completed_at: new Date().toISOString()
      })
      .in('id', stuckJobsToReset)
      
    if (updateError) {
      console.error('❌ Error updating stuck jobs:', updateError)
    } else {
      console.log(`✅ Successfully reset ${stuckJobsToReset.length} stuck jobs`)
    }
  }
  
  // Also check for any orphaned pending SMS jobs that might be problematic
  console.log('\n📱 Checking for problematic SMS jobs...')
  
  const { data: smsJobs, error: smsError } = await supabase
    .from('jobs')
    .select('*')
    .or('type.eq.send_sms,type.eq.send_bulk_sms,type.eq.process_reminder')
    .eq('status', 'pending')
    
  if (smsJobs && smsJobs.length > 0) {
    console.log(`Found ${smsJobs.length} pending SMS jobs`)
    console.log('These will be deleted to prevent further issues...')
    
    const { error: deleteError } = await supabase
      .from('jobs')
      .delete()
      .in('id', smsJobs.map(j => j.id))
      
    if (deleteError) {
      console.error('❌ Error deleting SMS jobs:', deleteError)
    } else {
      console.log(`✅ Successfully deleted ${smsJobs.length} pending SMS jobs`)
    }
  } else {
    console.log('✅ No pending SMS jobs found')
  }
  
  console.log('\n' + '='.repeat(50))
  console.log('✅ CLEANUP COMPLETE!')
  console.log('The job processor should now work normally.')
  console.log('='.repeat(50))
}

clearStuckJobs().catch(console.error)