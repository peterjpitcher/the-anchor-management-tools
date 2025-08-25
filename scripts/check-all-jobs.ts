import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function checkAllJobs() {
  console.log('🔍 Checking ALL jobs in the queue...\n')
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  // Check all pending jobs
  console.log('1️⃣ All pending jobs:')
  const { data: pendingJobs, error: error1 } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    
  if (pendingJobs && pendingJobs.length > 0) {
    console.log(`Found ${pendingJobs.length} pending jobs:\n`)
    pendingJobs.forEach(job => {
      console.log(`ID: ${job.id}`)
      console.log(`Type: ${job.type}`)
      console.log(`Created: ${job.created_at}`)
      console.log(`Priority: ${job.priority || 'default'}`)
      console.log(`Payload: ${JSON.stringify(job.payload).substring(0, 100)}...`)
      console.log('---')
    })
  } else {
    console.log('✅ No pending jobs found')
  }
  
  // Check processing jobs
  console.log('\n2️⃣ Jobs currently processing:')
  const { data: processingJobs, error: error2 } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'processing')
    .order('started_at', { ascending: false })
    
  if (processingJobs && processingJobs.length > 0) {
    console.log(`Found ${processingJobs.length} processing jobs:\n`)
    processingJobs.forEach(job => {
      const startedAt = new Date(job.started_at)
      const now = new Date()
      const runningFor = Math.floor((now.getTime() - startedAt.getTime()) / 1000)
      
      console.log(`ID: ${job.id}`)
      console.log(`Type: ${job.type}`)
      console.log(`Started: ${job.started_at}`)
      console.log(`Running for: ${runningFor} seconds`)
      if (runningFor > 60) {
        console.log(`⚠️ WARNING: This job has been running for over a minute!`)
      }
      console.log('---')
    })
  } else {
    console.log('✅ No jobs currently processing')
  }
  
  // Check failed jobs from today
  console.log('\n3️⃣ Failed jobs (last 24 hours):')
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  
  const { data: failedJobs, error: error3 } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'failed')
    .gte('created_at', yesterday.toISOString())
    .order('failed_at', { ascending: false })
    .limit(10)
    
  if (failedJobs && failedJobs.length > 0) {
    console.log(`Found ${failedJobs.length} failed jobs:\n`)
    failedJobs.forEach(job => {
      console.log(`ID: ${job.id}`)
      console.log(`Type: ${job.type}`)
      console.log(`Failed at: ${job.failed_at}`)
      console.log(`Error: ${job.error}`)
      console.log('---')
    })
  } else {
    console.log('✅ No failed jobs in the last 24 hours')
  }
  
  // Check job type distribution
  console.log('\n4️⃣ Job type distribution (pending):')
  const jobTypes = new Map()
  if (pendingJobs) {
    pendingJobs.forEach(job => {
      jobTypes.set(job.type, (jobTypes.get(job.type) || 0) + 1)
    })
    
    if (jobTypes.size > 0) {
      Array.from(jobTypes.entries()).forEach(([type, count]) => {
        console.log(`  ${type}: ${count} jobs`)
      })
    }
  }
  
  console.log('\n' + '='.repeat(50))
  console.log('SUMMARY:')
  console.log(`Total pending: ${pendingJobs?.length || 0}`)
  console.log(`Total processing: ${processingJobs?.length || 0}`)
  console.log(`Total failed (24h): ${failedJobs?.length || 0}`)
  
  if ((pendingJobs?.length || 0) > 100) {
    console.log('\n⚠️ WARNING: Large number of pending jobs detected!')
    console.log('This could cause timeouts. Consider clearing old jobs.')
  }
  
  if ((processingJobs?.length || 0) > 0) {
    console.log('\n⚠️ WARNING: Jobs are stuck in processing state!')
    console.log('These should be reset or deleted.')
  }
}

checkAllJobs().catch(console.error)