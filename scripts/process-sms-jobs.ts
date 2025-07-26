// Simple script to process SMS jobs manually
// This bypasses the cron authentication issue

import dotenv from 'dotenv'
import path from 'path'

// Load environment variables first
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Now import the modules that need env vars
import { createAdminClient } from '@/lib/supabase/server'
import { jobQueue } from '@/lib/background-jobs'

async function processSMSJobs() {
  console.log('📱 Processing SMS Jobs Manually\n')
  
  try {
    const supabase = await createAdminClient()
    
    // Check for pending jobs
    const { data: pendingJobs, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(50)
    
    if (error) {
      console.error('❌ Error fetching jobs:', error)
      return
    }
    
    if (!pendingJobs || pendingJobs.length === 0) {
      console.log('✅ No pending jobs to process')
      return
    }
    
    console.log(`Found ${pendingJobs.length} pending jobs:`)
    
    // Group by type
    const jobsByType = pendingJobs.reduce((acc, job) => {
      acc[job.type] = (acc[job.type] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    Object.entries(jobsByType).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} jobs`)
    })
    
    console.log('\nProcessing...')
    
    // Process the jobs
    await jobQueue.processJobs(pendingJobs.length)
    
    // Check results
    const { data: processedJobs } = await supabase
      .from('jobs')
      .select('id, type, status, error_message')
      .in('id', pendingJobs.map(j => j.id))
    
    // Count results
    const results = processedJobs?.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    console.log('\n📊 Results:')
    Object.entries(results || {}).forEach(([status, count]) => {
      console.log(`   ${status}: ${count} jobs`)
    })
    
    // Show any errors
    const failedJobs = processedJobs?.filter(j => j.status === 'failed')
    if (failedJobs && failedJobs.length > 0) {
      console.log('\n❌ Failed jobs:')
      failedJobs.forEach(job => {
        console.log(`   Job ${job.id} (${job.type}): ${job.error_message}`)
      })
    }
    
    console.log('\n✅ Job processing complete')
    
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

// Run the processor
processSMSJobs()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })